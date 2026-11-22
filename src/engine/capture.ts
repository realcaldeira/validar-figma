import type { Dimensions, FigmaSpec, ValidationReport } from './types.ts';

interface CaptureOptions {
  server?: string;
  name?: string;
  figmaUrl?: string | null;
  sourceUrl?: string;
  spec?: unknown;
}

interface CaptureResult {
  name: string;
  url: string;
  figmaUrl: string | null;
  spec: unknown;
  viewport: Dimensions;
  elements: number;
  html: string;
}

interface ReportOptions {
  server: string;
  report: ValidationReport;
  name?: string;
  figmaUrl?: string | null;
  figmaImageUrl?: string | null;
  figmaImageData?: string | null;
  figmaFrame?: Dimensions | null;
}

type CaptureWindow = Window & {
  __figmaValidator?: (spec: FigmaSpec) => Promise<ValidationReport>;
  __figmaCapture?: (opts?: CaptureOptions) => Promise<CaptureResult | { ok: true; elements: number; kb: number }>;
  __figmaReport?: (opts: ReportOptions) => Promise<{ id: string; url: string; warning?: string }>;
  __figmaCaptureSession?: (server: string, sessionId: string) => Promise<{ id: string; url: string }>;
};

const absolutizeCssUrls = (css: string, base: string): string =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, urlValue) => {
    if (/^(data:|blob:|#)/.test(urlValue)) return match;
    try {
      return `url("${new URL(urlValue, base).href}")`;
    } catch {
      return match;
    }
  });

const collectStyles = (): { css: string; links: string[] } => {
  const parts: string[] = [];
  const links: string[] = [];
  const sheets = [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets || [])];
  for (const sheet of sheets) {
    const base = sheet.href || location.href;
    try {
      const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      const media = sheet.media && sheet.media.mediaText;
      const css = absolutizeCssUrls(rules, base);
      parts.push(media && media !== 'all' ? `@media ${media}{\n${css}\n}` : css);
    } catch {
      if (sheet.href) links.push(sheet.href);
    }
  }
  return { css: parts.join('\n'), links };
};

const capturePage = async (opts: CaptureOptions = {}): Promise<CaptureResult | { ok: true; elements: number; kb: number }> => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const { css, links } = collectStyles();
  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  clone
    .querySelectorAll('script, noscript, style, link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"], iframe')
    .forEach((el) => el.remove());

  let count = 0;
  const body = clone.querySelector('body');
  if (body) {
    body.setAttribute('data-k', String(count++));
    body.querySelectorAll('*').forEach((el) => el.setAttribute('data-k', String(count++)));
  }

  let head = clone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  clone.querySelectorAll('base').forEach((el) => el.remove());
  const resolvedBase = opts.sourceUrl || document.querySelector('base')?.href || location.href;
  const base = document.createElement('base');
  base.href = resolvedBase;
  head.insertBefore(base, head.firstChild);

  for (const href of links) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    head.appendChild(link);
  }

  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-figma-snapshot', '');
  styleEl.textContent = css;
  head.appendChild(styleEl);

  const html = '<!doctype html>\n' + clone.outerHTML;
  const payload: CaptureResult = {
    name: opts.name || document.title || location.pathname,
    url: location.href,
    figmaUrl: opts.figmaUrl || null,
    spec: opts.spec || null,
    viewport: { width: innerWidth, height: innerHeight },
    elements: count,
    html,
  };
  if (!opts.server) return payload;
  const resp = await fetch(`${String(opts.server).replace(/\/$/, '')}/api/benchmark/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`server returned ${resp.status}`);
  return { ok: true, elements: count, kb: Math.round(html.length / 1024) };
};

const submitReport = async (opts: ReportOptions): Promise<{ id: string; url: string; warning?: string }> => {
  if (!opts.server) throw new Error('missing server URL');
  if (!opts.report || !opts.report.regions) throw new Error('missing report from window.__figmaValidator');
  const data = (await capturePage({ name: opts.name, figmaUrl: opts.figmaUrl })) as CaptureResult;
  const server = String(opts.server).replace(/\/$/, '');
  const resp = await fetch(`${server}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.name,
      url: data.url,
      figmaUrl: opts.figmaUrl || opts.report.figma?.url || null,
      figmaImageUrl: opts.figmaImageUrl || null,
      figmaImageData: opts.figmaImageData || null,
      figmaFrame: opts.figmaFrame || opts.report.figmaFrame || null,
      report: opts.report,
      html: data.html,
    }),
  });
  const res = (await resp.json().catch(() => ({}))) as { id?: string; error?: string; warning?: string };
  if (!resp.ok || !res.id) throw new Error(res.error || `server returned ${resp.status}`);
  return { id: res.id, url: `${server}/reports/${res.id}`, warning: res.warning };
};

const loadExternalScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}?${Date.now()}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });

const captureSession = async (server: string, sessionId: string): Promise<{ id: string; url: string }> => {
  const base = String(server).replace(/\/$/, '');
  const sessionRes = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!sessionRes.ok) throw new Error(`session lookup failed (${sessionRes.status})`);
  const session = (await sessionRes.json()) as {
    id: string;
    name: string;
    figmaUrl: string | null;
    figmaFrame: Dimensions | null;
    precision?: number | null;
    spec: FigmaSpec | null;
  };

  let report: ValidationReport;
  const captureWin = window as CaptureWindow;
  if (session.spec && Array.isArray(session.spec.regions) && session.spec.regions.length > 0) {
    if (!captureWin.__figmaValidator) await loadExternalScript(`${base}/validator.js`);
    if (!captureWin.__figmaValidator) throw new Error('failed to load validator.js');
    const specToRun: FigmaSpec =
      session.precision != null && session.spec.precision === undefined
        ? { ...session.spec, precision: session.precision }
        : session.spec;
    report = await captureWin.__figmaValidator!(specToRun);
  } else {
    report = {
      generatedAt: new Date().toISOString(),
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, expectedWidth: session.figmaFrame?.width },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      figmaFrame: session.figmaFrame || null,
      figma: session.figmaUrl ? { url: session.figmaUrl } : undefined,
      precision: session.precision ?? undefined,
      rootFound: null,
      summary: { regions: 0, checks: 0, pass: 0, fail: 0, warn: 0, score: null },
      pendingStates: [],
      regions: [],
    };
  }

  const snapshot = (await capturePage({ name: session.name, figmaUrl: session.figmaUrl })) as CaptureResult;
  const doneRes = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: snapshot.url,
      report,
      html: snapshot.html,
    }),
  });
  const done = (await doneRes.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!doneRes.ok || !done.id) throw new Error(done.error || `failed to complete session (${doneRes.status})`);
  return { id: done.id, url: done.url || `${base}/reports/${done.id}` };
};

const capWin = window as CaptureWindow;
capWin.__figmaCapture = capturePage;
capWin.__figmaReport = submitReport;
capWin.__figmaCaptureSession = captureSession;
