import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconPlay,
  IconTerminal,
  IconUpload,
} from '../components/Icons.tsx';
import { DEMO_FIGMA_FRAME, DEMO_FIGMA_SVG_DATA_URL } from '../demo/figmaReference.ts';
import { DEMO_FIGMA_URL, demoSpec } from '../demo/spec.ts';
import { DEFAULT_PRECISION, tolerancesFromPrecision } from '../engine/compare.ts';
import { parseFigmaUrl } from '../engine/figmaParser.ts';
import type { Dimensions, FigmaSpec, ValidationReport } from '../engine/types.ts';
import { localizeMessage } from '../i18n/messages.ts';
import { useI18n } from '../i18n/useI18n.ts';
import { navigate } from '../navigation.ts';
import { CountUp } from '../components/CountUp.tsx';
import { HowItWorksReel } from '../components/HowItWorksReel.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { RollingNumber } from '../components/RollingNumber.tsx';
import QuickValidate from './QuickValidate.tsx';
import { apiRequest } from '../utils/api.ts';
import './validate.css';

type Mode = 'offline' | 'figmaApi' | 'mcpAgent';
type ScreenSource = 'url' | 'image';
type ExportScale = 1 | 2 | 3;

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

interface ReportListItem {
  id: string;
  name: string;
  createdAt: string;
}

type FrameWindow = Window & {
  __figmaValidator?: (spec: FigmaSpec) => Promise<ValidationReport>;
  __figmaCapture?: (opts?: { name?: string; figmaUrl?: string | null; sourceUrl?: string }) => Promise<{ html: string }>;
};

const TOKEN_STORAGE_KEY = 'figma-validator-token';

function readImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () =>
        resolve({
          dataUrl,
          width: img.naturalWidth || img.width || 1440,
          height: img.naturalHeight || img.height || 900,
          name: file.name || 'image.png',
        });
      img.onerror = () => reject(new Error('Unsupported or corrupted image file'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function normalizeLocalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${location.origin}${trimmed}`;
  return `http://${trimmed}`;
}

function loadHiddenIframe(
  src: string,
  width: number,
  height: number,
  waitSelector?: string,
): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'hidden-frame';
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    const timer = window.setTimeout(() => {
      iframe.remove();
      reject(new Error('Timed out loading target screen'));
    }, 15000);
    iframe.onload = async () => {
      window.clearTimeout(timer);
      try {
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        if (doc) {
          const deadline = Date.now() + 6000;
          const isReady = () =>
            waitSelector
              ? Boolean(doc.querySelector(waitSelector))
              : (doc.body?.innerText || '').trim().length > 0;
          while (Date.now() < deadline && !isReady()) {
            await new Promise((r) => setTimeout(r, 80));
          }
          if (doc.fonts?.ready) await doc.fonts.ready;
          if (win) {
            await new Promise<void>((r) =>
              win.requestAnimationFrame(() => win.requestAnimationFrame(() => r())),
            );
          }
        }
      } catch {
      }
      resolve(iframe);
    };
    iframe.onerror = () => {
      window.clearTimeout(timer);
      iframe.remove();
      reject(new Error(`Failed to open ${src}`));
    };
    iframe.src = src;
    document.body.appendChild(iframe);
  });
}

function injectScript(doc: Document, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = `${location.origin}${path}?${Date.now()}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${path}`));
    doc.head.appendChild(s);
  });
}

function formatSpecJson(spec: FigmaSpec): string {
  return JSON.stringify(spec, null, 2);
}

function renderTitleWithFigmaBox(title: string) {
  const idx = title.indexOf('Figma');
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <span className="figma-word-box">
        <span className="figma-word-handle tl" aria-hidden="true" />
        <span className="figma-word-handle tr" aria-hidden="true" />
        <span className="figma-word-handle bl" aria-hidden="true" />
        <span className="figma-word-handle br" aria-hidden="true" />
        Figma
      </span>
      {title.slice(idx + 5)}
    </>
  );
}

export default function ValidatePage() {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<Mode | null>(null);
  // Rigor fixo em 100% (Exato): só o arredondamento invisível é aceito.
  const precision = DEFAULT_PRECISION;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [figmaImage, setFigmaImage] = useState<LoadedImage | null>(null);
  const [exportScale, setExportScale] = useState<ExportScale>(1);
  const [specText, setSpecText] = useState('');
  const [figmaDragging, setFigmaDragging] = useState(false);

  const [screenSource, setScreenSource] = useState<ScreenSource>('url');
  const [localhostUrl, setLocalhostUrl] = useState('http://localhost:3000');
  const [reportName, setReportName] = useState('');
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [screenImage, setScreenImage] = useState<LoadedImage | null>(null);
  const [screenDragging, setScreenDragging] = useState(false);

  const [figmaApiUrl, setFigmaApiUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [rememberToken, setRememberToken] = useState(() => {
    try {
      return Boolean(localStorage.getItem(TOKEN_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [includeContainers, setIncludeContainers] = useState(false);
  const [apiFetchedInfo, setApiFetchedInfo] = useState<string | null>(null);

  const [mcpFigmaUrl, setMcpFigmaUrl] = useState(DEMO_FIGMA_URL);
  const [mcpScreenUrl, setMcpScreenUrl] = useState('http://localhost:3000');
  const [mcpName, setMcpName] = useState('My Screen');
  const [mcpAgent, setMcpAgent] = useState('claude');
  const [mcpTask, setMcpTask] = useState<'audit' | 'fix'>('audit');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const baselineIdsRef = useRef<Set<string> | null>(null);
  const [incomingReport, setIncomingReport] = useState<ReportListItem | null>(null);

  const [consoleSession, setConsoleSession] = useState<{ id: string; snippet: string } | null>(null);
  const [artboardFocus, setArtboardFocus] = useState<'frame' | 'ok' | 'diff'>('frame');
  const [artboardHover, setArtboardHover] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [tilt, setTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });
  const artboardRef = useRef<HTMLDivElement>(null);
  const quickSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (artboardHover) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const sequence: ('frame' | 'ok' | 'diff')[] = ['frame', 'ok', 'diff'];
    const timer = window.setInterval(() => {
      setArtboardFocus((cur) => sequence[(sequence.indexOf(cur) + 1) % sequence.length]);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [artboardHover]);

  const handleArtboardMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const x = Math.max(12, Math.min(rect.width - 72, relX + 8));
    const y = Math.max(16, Math.min(rect.height - 28, relY + 8));
    const ry = ((relX / rect.width) - 0.5) * 7;
    const rx = (0.5 - (relY / rect.height)) * 6;
    setArtboardHover(true);
    setCursorPos({ x, y });
    setTilt({ rx: Number(rx.toFixed(2)), ry: Number(ry.toFixed(2)) });
  };

  const handleArtboardLeave = () => {
    setArtboardHover(false);
    setCursorPos(null);
    setTilt({ rx: 0, ry: 0 });
    setArtboardFocus('frame');
  };

  const activeTolerances = useMemo(() => tolerancesFromPrecision(precision), [precision]);

  const toggleMode = (nextMode: Mode) => {
    setMode((cur) => {
      const target = cur === nextMode ? null : nextMode;
      if (target === 'mcpAgent') {
        baselineIdsRef.current = null;
        setIncomingReport(null);
      }
      return target;
    });
  };

  const logicalFrame = useMemo<Dimensions | null>(() => {
    if (!figmaImage) return null;
    return {
      width: Math.max(1, Math.round(figmaImage.width / exportScale)),
      height: Math.max(1, Math.round(figmaImage.height / exportScale)),
    };
  }, [figmaImage, exportScale]);

  const specState = useMemo<{ valid: boolean; parsed: FigmaSpec | null }>(() => {
    const trimmed = specText.trim();
    if (!trimmed) return { valid: true, parsed: null };
    try {
      const parsed = JSON.parse(trimmed) as FigmaSpec;
      if (!parsed || !Array.isArray(parsed.regions)) return { valid: false, parsed: null };
      return { valid: true, parsed };
    } catch {
      return { valid: false, parsed: null };
    }
  }, [specText]);

  const parsedFigmaApiUrl = useMemo(() => parseFigmaUrl(figmaApiUrl), [figmaApiUrl]);

  const handleFigmaFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const img = await readImageFile(file);
        setFigmaImage(img);
        const w = Math.max(1, Math.round(img.width / exportScale));
        const h = Math.max(1, Math.round(img.height / exportScale));
        setViewportWidth(w);
        setViewportHeight(h);
        if (!reportName) setReportName(file.name.replace(/\.[^.]+$/, ''));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [exportScale, reportName],
  );

  const handleScreenFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const img = await readImageFile(file);
      setScreenImage(img);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find((item) => item.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      if (mode === null) setMode('offline');
      if (screenSource === 'image' && figmaImage && !screenImage) {
        await handleScreenFile(file);
      } else {
        await handleFigmaFile(file);
      }
    },
    [figmaImage, handleFigmaFile, handleScreenFile, mode, screenImage, screenSource],
  );

  const handleScaleChange = (nextScale: ExportScale) => {
    setExportScale(nextScale);
    if (figmaImage) {
      setViewportWidth(Math.max(1, Math.round(figmaImage.width / nextScale)));
      setViewportHeight(Math.max(1, Math.round(figmaImage.height / nextScale)));
    }
  };

  useEffect(() => {
    if (!consoleSession) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await apiRequest<{ status: 'pending' | 'completed'; reportId: string | null }>(
          `/api/sessions/${consoleSession.id}`,
        );
        if (active && res.status === 'completed' && res.reportId) {
          setConsoleSession(null);
          navigate(`/reports/${res.reportId}`);
        }
      } catch {
      }
    };
    const timer = window.setInterval(poll, 2000);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [consoleSession]);

  useEffect(() => {
    if (mode !== 'mcpAgent') return;
    let active = true;
    const init = async () => {
      try {
        const list = await apiRequest<ReportListItem[]>('/api/reports');
        if (active && !baselineIdsRef.current) {
          baselineIdsRef.current = new Set(list.map((r) => r.id));
        }
      } catch {
      }
    };
    void init();

    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const list = await apiRequest<ReportListItem[]>('/api/reports');
        const baseline = baselineIdsRef.current;
        if (!active || !baseline) return;
        const fresh = list.find((r) => !baseline.has(r.id));
        if (fresh) setIncomingReport(fresh);
      } catch {
      }
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mode]);

  const runDemo = async (withMismatches: boolean) => {
    setBusy(withMismatches ? 'demo-mismatch' : 'demo-match');
    setError(null);
    let iframe: HTMLIFrameElement | null = null;
    try {
      const targetPath = withMismatches ? '/demo/sample-screen?mismatch=1' : '/demo/sample-screen';
      iframe = await loadHiddenIframe(
        targetPath,
        DEMO_FIGMA_FRAME.width,
        DEMO_FIGMA_FRAME.height,
        '#demo-title',
      );
      const doc = iframe.contentDocument!;
      await injectScript(doc, '/validator.js');
      await injectScript(doc, '/capture.js');
      const win = iframe.contentWindow as FrameWindow;
      const report = await win.__figmaValidator!({ ...demoSpec, precision });
      const captured = await win.__figmaCapture!({
        name: withMismatches ? 'Demo - Sample Mismatches' : 'Demo - 100% Match',
        figmaUrl: DEMO_FIGMA_URL,
      });
      const res = await apiRequest<{ id: string }>('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: withMismatches ? 'Demo — Sample Mismatches' : 'Demo — 100% Match',
          url: `${location.origin}${targetPath}`,
          figmaUrl: DEMO_FIGMA_URL,
          figmaImageData: DEMO_FIGMA_SVG_DATA_URL,
          figmaFrame: DEMO_FIGMA_FRAME,
          precision,
          report,
          html: captured.html,
        }),
      });
      navigate(`/reports/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      iframe?.remove();
      setBusy(null);
    }
  };

  const runOfflineCompare = async () => {
    setError(null);
    if (!figmaImage && !specState.parsed) {
      setError(t.validate.offline.needFigmaOrSpec);
      return;
    }
    if (!specState.valid) {
      setError(t.validate.offline.specInvalid);
      return;
    }

    if (screenSource === 'image') {
      if (!screenImage) {
        setError(t.validate.offline.needLocalhostOrImage);
        return;
      }
      setBusy('compare');
      try {
        const frame = logicalFrame ?? { width: screenImage.width, height: screenImage.height };
        const report: ValidationReport = {
          generatedAt: new Date().toISOString(),
          url: reportName.trim() || screenImage.name,
          viewport: { width: screenImage.width, height: screenImage.height, expectedWidth: frame.width },
          page: { width: screenImage.width, height: screenImage.height },
          figmaFrame: frame,
          figma: specState.parsed?.figma ?? (mode === 'figmaApi' && parsedFigmaApiUrl ? { url: figmaApiUrl, ...parsedFigmaApiUrl } : undefined),
          precision,
          rootFound: null,
          summary: { regions: 0, checks: 0, pass: 0, fail: 0, warn: 0, score: null },
          pendingStates: [],
          regions: [],
        };
        const res = await apiRequest<{ id: string }>('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: reportName.trim() || figmaImage?.name || 'Visual Pixel Diff',
            url: screenImage.name,
            figmaUrl: specState.parsed?.figma?.url ?? (mode === 'figmaApi' && parsedFigmaApiUrl ? figmaApiUrl : null),
            figmaImageData: figmaImage?.dataUrl || null,
            screenImageData: screenImage.dataUrl,
            figmaFrame: frame,
            precision,
            report,
          }),
        });
        navigate(`/reports/${res.id}?view=pixelDiff`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }

    const normalizedUrl = normalizeLocalUrl(localhostUrl);
    if (!normalizedUrl) {
      setError(t.validate.offline.needLocalhostOrImage);
      return;
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(normalizedUrl);
    } catch {
      setError(t.validate.offline.invalidUrl);
      return;
    }

    setBusy('compare');
    let iframe: HTMLIFrameElement | null = null;
    try {
      const sameOrigin = parsedTarget.origin === location.origin;
      const frameSrc = sameOrigin
        ? `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`
        : `/api/proxy?url=${encodeURIComponent(parsedTarget.toString())}`;

      if (!sameOrigin) {
        const probe = await fetch(frameSrc);
        if (!probe.ok) {
          const payload = (await probe.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Proxy error (${probe.status})`);
        }
      }

      iframe = await loadHiddenIframe(frameSrc, viewportWidth, viewportHeight);
      const doc = iframe.contentDocument!;
      const win = iframe.contentWindow as FrameWindow;

      let report: ValidationReport;
      if (specState.parsed) {
        await injectScript(doc, '/validator.js');
        report = await win.__figmaValidator!({ ...specState.parsed, precision });
      } else {
        report = {
          generatedAt: new Date().toISOString(),
          url: parsedTarget.toString(),
          viewport: { width: viewportWidth, height: viewportHeight, expectedWidth: logicalFrame?.width },
          page: { width: doc.documentElement.scrollWidth || viewportWidth, height: doc.documentElement.scrollHeight || viewportHeight },
          figmaFrame: logicalFrame,
          figma: mode === 'figmaApi' && parsedFigmaApiUrl ? { url: figmaApiUrl, ...parsedFigmaApiUrl } : undefined,
          precision,
          rootFound: null,
          summary: { regions: 0, checks: 0, pass: 0, fail: 0, warn: 0, score: null },
          pendingStates: [],
          regions: [],
        };
      }
      report.url = parsedTarget.toString();

      await injectScript(doc, '/capture.js');
      const captured = await win.__figmaCapture!({
        name: reportName.trim() || parsedTarget.host,
        figmaUrl: specState.parsed?.figma?.url ?? (mode === 'figmaApi' && parsedFigmaApiUrl ? figmaApiUrl : null),
        sourceUrl: parsedTarget.toString(),
      });

      const res = await apiRequest<{ id: string }>('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reportName.trim() || specState.parsed?.name || parsedTarget.host,
          url: parsedTarget.toString(),
          figmaUrl: specState.parsed?.figma?.url ?? (mode === 'figmaApi' && parsedFigmaApiUrl ? figmaApiUrl : null),
          figmaImageData: figmaImage?.dataUrl || null,
          figmaFrame: logicalFrame ?? specState.parsed?.figmaFrame ?? { width: viewportWidth, height: viewportHeight },
          precision,
          report,
          html: captured.html,
        }),
      });
      const defaultView = specState.parsed ? '' : '?view=split';
      navigate(`/reports/${res.id}${defaultView}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      iframe?.remove();
      setBusy(null);
    }
  };

  const openConsoleSession = async () => {
    setError(null);
    if (!figmaImage && !specState.parsed) {
      setError(t.validate.offline.needFigmaOrSpec);
      return;
    }
    if (!specState.valid) {
      setError(t.validate.offline.specInvalid);
      return;
    }
    setBusy('session');
    try {
      const res = await apiRequest<{ id: string }>('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reportName.trim() || specState.parsed?.name || figmaImage?.name || 'Localhost Audit',
          figmaUrl: specState.parsed?.figma?.url ?? (mode === 'figmaApi' && parsedFigmaApiUrl ? figmaApiUrl : null),
          figmaFrame: logicalFrame ?? specState.parsed?.figmaFrame ?? { width: viewportWidth, height: viewportHeight },
          figmaImageData: figmaImage?.dataUrl || null,
          precision,
          spec: specState.parsed ? { ...specState.parsed, precision } : null,
        }),
      });
      const origin = location.origin;
      const snippet = `await new Promise((ok, err) => { const s = document.createElement('script'); s.src = '${origin}/capture.js?' + Date.now(); s.onload = ok; s.onerror = err; document.head.appendChild(s); }); await window.__figmaCaptureSession('${origin}', '${res.id}');`;
      setConsoleSession({ id: res.id, snippet });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fetchFromFigmaApi = async () => {
    setError(null);
    setApiFetchedInfo(null);
    if (!parsedFigmaApiUrl) {
      setError(t.validate.figmaApi.invalidUrl);
      return;
    }
    setBusy('figmaApi');
    try {
      try {
        if (rememberToken && figmaToken.trim()) localStorage.setItem(TOKEN_STORAGE_KEY, figmaToken.trim());
        else localStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
      }
      const res = await apiRequest<{
        name: string;
        figmaUrl: string;
        figmaFrame: Dimensions;
        spec: FigmaSpec;
        imageDataUrl: string;
      }>('/api/figma/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figmaUrl: figmaApiUrl.trim(),
          token: figmaToken.trim(),
          includeContainers,
        }),
      });

      const imgDims = await new Promise<Dimensions>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: res.figmaFrame.width * 2, height: res.figmaFrame.height * 2 });
        img.src = res.imageDataUrl;
      });

      const inferredScale: ExportScale =
        res.figmaFrame.width > 0 && Math.round(imgDims.width / res.figmaFrame.width) === 2 ? 2 : 1;

      setFigmaImage({
        dataUrl: res.imageDataUrl,
        width: imgDims.width,
        height: imgDims.height,
        name: `${res.name}.png`,
      });
      setExportScale(inferredScale);
      setViewportWidth(res.figmaFrame.width);
      setViewportHeight(res.figmaFrame.height);
      setSpecText(formatSpecJson(res.spec));
      setReportName(res.name);
      setApiFetchedInfo(
        `${t.validate.figmaApi.fetchedSummary} (${t.validate.figmaApi.fetchedDetail
          .replace('{regions}', String(res.spec.regions.length))
          .replace('{width}', String(res.figmaFrame.width))
          .replace('{height}', String(res.figmaFrame.height))}). ${t.validate.figmaApi.readyToCompare}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const mcpPrompt = useMemo(() => {
    const origin = location.origin;
    const isPt = locale === 'pt';
    const fixInstruction =
      mcpTask === 'fix'
        ? isPt
          ? '5. Corrija no código-fonte local cada falha (fail) usando os tokens do design system, reavalie até zerar divergências evitáveis e envie o relatório final atualizado.'
          : '5. Fix every failing check in the local codebase using the project design tokens, re-run validation to confirm, and publish the updated final report.'
        : isPt
          ? '5. NÃO edite o código da aplicação: apenas audite e entregue o resumo das divergências.'
          : '5. Do NOT edit application source code: audit only and summarize every mismatch.';

    if (isPt) {
      return `Valide a tela localhost contra o frame oficial do Figma usando o MCP do Figma (o Figma é sempre a referência).

Agente: ${mcpAgent}
Figma: ${mcpFigmaUrl}
Tela (Localhost): ${mcpScreenUrl}
Nome do relatório: ${mcpName}
Nível de precisão: ${precision}%
Servidor visual: ${origin}

Passos:
1. Leia o frame no Figma via MCP (get_metadata, get_design_context, get_variable_defs, get_screenshot).
2. Monte uma spec JSON completa com precision: ${precision}, seletores CSS estáveis, figmaFrame e figmaRect por região.
3. Abra ${mcpScreenUrl} no navegador na largura do frame do Figma, carregue ${origin}/validator.js e execute:
   const report = await window.__figmaValidator(spec);
   (Para regiões com state hover/focus, aplique o estado no navegador e meça com { only, stateApplied: true }).
   (Se o agente rodar só no terminal sem navegador próprio, use o CLI da skill: node ~/.agents/skills/validar-figma/bin/validar.mjs --url "${mcpScreenUrl}" --spec spec.json --send "${origin}" — ou --login --url "${mcpScreenUrl}" antes para SSO.)
4. Carregue ${origin}/capture.js na mesma página e envie o relatório lado a lado usando o image_url do get_screenshot:
   await window.__figmaReport({ server: '${origin}', report, name: '${mcpName}', figmaUrl: '${mcpFigmaUrl}', figmaImageUrl: '<image_url_do_get_screenshot>', figmaFrame: spec.figmaFrame });
${fixInstruction}`;
    }

    return `Validate the localhost screen against the official Figma frame using Figma MCP (Figma is always the reference).

Agent: ${mcpAgent}
Figma: ${mcpFigmaUrl}
Target Screen (Localhost): ${mcpScreenUrl}
Report Name: ${mcpName}
Precision Level: ${precision}%
Validator Server: ${origin}

Steps:
1. Read the Figma frame via Figma MCP (get_metadata, get_design_context, get_variable_defs, get_screenshot).
2. Build a complete FigmaSpec JSON with precision: ${precision}, stable CSS selectors, figmaFrame, and figmaRect per region.
3. Open ${mcpScreenUrl} in the browser at the Figma frame width, load ${origin}/validator.js, and run:
   const report = await window.__figmaValidator(spec);
   (For regions with hover/focus state, apply the browser state and run with { only, stateApplied: true }).
   (If the agent runs terminal-only without its own browser, run the skill CLI: node ~/.agents/skills/validar-figma/bin/validar.mjs --url "${mcpScreenUrl}" --spec spec.json --send "${origin}" — or --login --url "${mcpScreenUrl}" once for SSO.)
4. Load ${origin}/capture.js on the same page and publish the side-by-side report using get_screenshot's image_url:
   await window.__figmaReport({ server: '${origin}', report, name: '${mcpName}', figmaUrl: '${mcpFigmaUrl}', figmaImageUrl: '<image_url_from_get_screenshot>', figmaFrame: spec.figmaFrame });
${fixInstruction}`;
  }, [locale, mcpAgent, mcpFigmaUrl, mcpName, mcpScreenUrl, mcpTask, precision]);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch (err) {
      setError((err as Error).message || 'Clipboard unavailable');
    }
  };

  const onDropFile = (setter: (file: File) => Promise<void>, setDragging: (v: boolean) => void) => async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await setter(file);
  };

  const renderTargetSection = () => (
    <div className="card">
      <h2>{t.validate.offline.screenCardTitle}</h2>

      <div className="segment-group" role="tablist">
        <button
          type="button"
          className={screenSource === 'url' ? 'active' : ''}
          onClick={() => setScreenSource('url')}
        >
          {t.validate.offline.sourceUrlTab}
        </button>
        <button
          type="button"
          className={screenSource === 'image' ? 'active' : ''}
          onClick={() => setScreenSource('image')}
        >
          {t.validate.offline.sourceImageTab}
        </button>
      </div>

      {screenSource === 'url' ? (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="localhost-url-input">
              {t.validate.offline.localhostUrlLabel}
            </label>
            <input
              id="localhost-url-input"
              className="input"
              value={localhostUrl}
              onChange={(e) => setLocalhostUrl(e.target.value)}
              placeholder={t.validate.offline.localhostUrlPlaceholder}
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="report-name-input">
              {t.validate.offline.reportNameLabel}
            </label>
            <input
              id="report-name-input"
              className="input"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder={t.validate.offline.reportNamePlaceholder}
            />
          </div>
          <div className="form-row">
            <label>
              {t.validate.offline.viewportWidth}
              <input
                className="input compact"
                type="number"
                min={320}
                value={viewportWidth}
                onChange={(e) => setViewportWidth(Math.max(320, Number(e.target.value) || 320))}
              />
            </label>
            <label>
              {t.validate.offline.viewportHeight}
              <input
                className="input compact"
                type="number"
                min={200}
                value={viewportHeight}
                onChange={(e) => setViewportHeight(Math.max(200, Number(e.target.value) || 200))}
              />
            </label>
          </div>
          <p className="notice">{t.validate.offline.proxyNotice}</p>
        </>
      ) : (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="report-name-img-input">
              {t.validate.offline.reportNameLabel}
            </label>
            <input
              id="report-name-img-input"
              className="input"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder={t.validate.offline.reportNamePlaceholder}
            />
          </div>
          {screenImage ? (
            <div className="preview-box">
              <div className="preview-img-wrap">
                <img src={screenImage.dataUrl} alt={screenImage.name} />
              </div>
              <div className="preview-meta">
                <span>
                  {screenImage.name} ({screenImage.width} × {screenImage.height})
                </span>
                <button type="button" className="btn secondary small" onClick={() => setScreenImage(null)}>
                  {t.validate.offline.figmaClear}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`dropzone${screenDragging ? ' dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setScreenDragging(true);
              }}
              onDragLeave={() => setScreenDragging(false)}
              onDrop={onDropFile(handleScreenFile, setScreenDragging)}
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = '';
                  if (f) void handleScreenFile(f);
                }}
              />
              <span className="dropzone-icon">
                <IconUpload size={18} />
              </span>
              <p className="dropzone-hint">{t.validate.offline.screenDropHint}</p>
            </div>
          )}
        </>
      )}

      <div className="val-actions">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void runOfflineCompare()}>
          {busy === 'compare' ? t.validate.offline.comparingBtn : t.validate.offline.compareNowBtn}
        </button>
        {screenSource === 'url' && (
          <button
            type="button"
            className="btn secondary"
            disabled={Boolean(busy)}
            onClick={() => void openConsoleSession()}
          >
            <IconTerminal size={15} />
            {t.validate.offline.consoleBtn}
          </button>
        )}
      </div>
    </div>
  );

  const modeCards: {
    id: Mode;
    index: string;
    title: string;
    badge: string;
    tag: string;
    desc: string;
    tone: 'green' | 'blue' | 'purple';
  }[] = [
    {
      id: 'offline',
      index: '01',
      title: t.validate.modes.offline,
      badge: t.validate.modes.offlineBadge,
      tag: t.validate.modes.offlineTag,
      desc: t.validate.modes.offlineDesc,
      tone: 'green',
    },
    {
      id: 'figmaApi',
      index: '02',
      title: t.validate.modes.figmaApi,
      badge: t.validate.modes.figmaApiBadge,
      tag: t.validate.modes.figmaApiTag,
      desc: t.validate.modes.figmaApiDesc,
      tone: 'blue',
    },
    {
      id: 'mcpAgent',
      index: '03',
      title: t.validate.modes.mcpAgent,
      badge: t.validate.modes.mcpAgentBadge,
      tag: t.validate.modes.mcpAgentTag,
      desc: t.validate.modes.mcpAgentDesc,
      tone: 'purple',
    },
  ];

  const activeModeMeta = modeCards.find((c) => c.id === mode) ?? null;

  return (
    <div onPaste={(e) => void handlePaste(e)}>
      <div className="val-hero-grid">
        <div className="val-hero">
          <div className="val-frame-tag">
            <span className="val-triad" aria-hidden="true">
              <span style={{ background: 'var(--figma-red)' }} />
              <span style={{ background: 'var(--figma-purple)' }} />
              <span style={{ background: 'var(--figma-green)' }} />
            </span>
            <span>❖ {t.validate.heroEyebrow}</span>
          </div>
          <h1>{renderTitleWithFigmaBox(t.validate.title)}</h1>
          <p className="lead">{t.validate.subtitle}</p>
          <div className="hero-ruler">
            {t.validate.heroSteps.map((step, idx) => (
              <div
                key={step.num}
                className="hero-ruler-item stagger-item"
                style={{ '--stagger': idx } as CSSProperties}
              >
                <span className="hero-ruler-num">0{step.num}</span>
                <div className="hero-ruler-copy">
                  <strong>{step.title}</strong>
                  <span>{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          ref={artboardRef}
          className="figma-artboard-scene"
          aria-hidden="true"
          onPointerMove={handleArtboardMove}
          onPointerLeave={handleArtboardLeave}
        >
          <div className="figma-redline-y">
            <span className="figma-redline-tag">
              <RollingNumber value={artboardFocus === 'ok' ? 16 : artboardFocus === 'diff' ? 12 : 24} />
            </span>
          </div>
          <span className="figma-preview-label">◇ Frame · {t.reportDetail.panels.figma}</span>
          <span key={`chip-${artboardFocus}`} className={`figma-float-chip ${artboardFocus}`}>
            <span className="figma-float-dot" />
            <span>
              {artboardFocus === 'ok'
                ? '✓ ΔE 0.0 · 0px'
                : artboardFocus === 'diff'
                  ? '✕ #A259FF → #0D99FF'
                  : 'Auto Layout · 8px'}
            </span>
          </span>
          <div
            className={`figma-frame-box${artboardFocus !== 'frame' ? ' is-active' : ''}`}
            style={
              tilt.rx !== 0 || tilt.ry !== 0
                ? { transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }
                : undefined
            }
          >
            <span className="figma-scanline" />
            <span className="figma-handle tl" />
            <span className="figma-handle tr" />
            <span className="figma-handle bl" />
            <span className="figma-handle br" />

            <div className="figma-skel-head">
              <div className="figma-skel-bar" style={{ width: '52%', background: '#d6d6cf' }} />
              <span className="badge purple" style={{ fontSize: 10.5, padding: '1px 6px' }}>
                Figma
              </span>
            </div>

            <div
              className={`figma-preview-row ok${artboardFocus === 'ok' ? ' is-inspected' : ''}`}
              onPointerEnter={() => setArtboardFocus('ok')}
              onClick={() => setArtboardFocus((cur) => (cur === 'ok' ? 'frame' : 'ok'))}
            >
              <span>✓ {t.reportDetail.passChip}</span>
              <span>
                <CountUp value={100} suffix="%" duration={720} />
              </span>
            </div>

            <div
              className={`figma-preview-row diff${artboardFocus === 'diff' ? ' is-inspected' : ''}`}
              onPointerEnter={() => setArtboardFocus('diff')}
              onClick={() => setArtboardFocus((cur) => (cur === 'diff' ? 'frame' : 'diff'))}
            >
              <span>✕ {t.reportDetail.failChip}</span>
              <span className="figma-preview-swatches">
                <span className="figma-mini-dot" style={{ background: '#A259FF' }} />
                <span>→</span>
                <span className="figma-mini-dot" style={{ background: '#0D99FF' }} />
              </span>
            </div>

            <span className="figma-dim-pill">
              <RollingNumber value={artboardFocus === 'frame' ? 1440 : 320} />
              {' × '}
              <RollingNumber value={artboardFocus === 'frame' ? 900 : 36} />
              {artboardFocus === 'ok' ? ' · OK' : artboardFocus === 'diff' ? ' · ΔE 14' : ''}
            </span>
          </div>

          <div
            className={`figma-cursor${cursorPos ? ' tracking' : ` pos-${artboardFocus}`}`}
            style={cursorPos ? { left: cursorPos.x, top: cursorPos.y, right: 'auto', bottom: 'auto' } : undefined}
          >
            <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
              <path
                d="M1.5 1.5L6.5 15.5L8.9 9.7L14.5 7.5L1.5 1.5Z"
                fill="#A259FF"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="figma-cursor-pill">Lucas</span>
          </div>
        </div>
      </div>

      <HowItWorksReel
        onJumpToForm={() => quickSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      <div ref={quickSectionRef}>
        <QuickValidate precision={precision} />
      </div>

      <Reveal delay={60}>
        <div className="val-demo-strip">
          <div className="val-demo-copy">
            <strong>{t.validate.demoStripTitle}</strong>
            <span>{t.validate.demoStripDesc}</span>
          </div>
          <div className="val-demo-actions">
            <button
              type="button"
              className="demo-action-btn demo-pass"
              disabled={Boolean(busy)}
              onClick={() => void runDemo(false)}
            >
              {busy === 'demo-match' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <span className="demo-dot pass" aria-hidden="true" />
              )}
              <span className="demo-action-text">
                <strong>{busy === 'demo-match' ? t.validate.runningDemo : t.validate.demoMatchBtn}</strong>
                <small>{t.validate.demoMatchDesc}</small>
              </span>
              <IconPlay size={13} style={{ color: '#a8a8a0' }} />
            </button>

            <button
              type="button"
              className="demo-action-btn demo-warn"
              disabled={Boolean(busy)}
              onClick={() => void runDemo(true)}
            >
              {busy === 'demo-mismatch' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <span className="demo-dot warn" aria-hidden="true" />
              )}
              <span className="demo-action-text">
                <strong>{busy === 'demo-mismatch' ? t.validate.runningDemo : t.validate.demoMismatchBtn}</strong>
                <small>{t.validate.demoMismatchDesc}</small>
              </span>
              <IconPlay size={13} style={{ color: '#a8a8a0' }} />
            </button>
          </div>
        </div>
      </Reveal>

      {error && (
        <div className="banner error" role="alert">
          <span>{localizeMessage(error, locale)}</span>
          <button type="button" className="btn secondary small" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {consoleSession && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{t.validate.offline.consoleTitle}</h2>
            <span className="badge accent">
              <span className="pulse-dot" />
              {t.validate.offline.consoleWaiting}
            </span>
          </div>
          <p className="notice" style={{ marginBottom: 10 }}>
            {t.validate.offline.consoleInstructions}
          </p>
          <textarea className="code-box" style={{ minHeight: 84 }} readOnly value={consoleSession.snippet} />
          <div className="val-actions">
            <button
              type="button"
              className={`btn small${copiedKey === 'console' ? ' copied' : ''}`}
              onClick={() => void copyText('console', consoleSession.snippet)}
            >
              {copiedKey === 'console' ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copiedKey === 'console' ? t.validate.mcpAgent.copied : t.validate.offline.consoleCopyBtn}
            </button>
            <button type="button" className="btn secondary small" onClick={() => setConsoleSession(null)}>
              {t.validate.offline.consoleCancelBtn}
            </button>
          </div>
        </div>
      )}

      <Reveal delay={90}>
        <div className="other-modes-head">
          <h2>{t.validate.quick.otherModes}</h2>
          <p>{t.validate.quick.otherModesSub}</p>
        </div>

        <div className="mode-cards">
          {modeCards.map((item, idx) => {
            const isActive = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`mode-card tone-${item.tone} stagger-item${isActive ? ' active' : ''}`}
                style={{ '--stagger': idx } as CSSProperties}
                aria-expanded={isActive}
                onClick={() => toggleMode(item.id)}
              >
                <div className="mode-card-top">
                  <span className="mode-card-index">{item.index}</span>
                  <span className="mode-card-badges">
                    <span className="badge">{item.tag}</span>
                    <span className={`badge${isActive ? ' accent' : ''}`}>{item.badge}</span>
                  </span>
                </div>
                <span className="mode-card-title">{item.title}</span>
                <p className="mode-card-desc">{item.desc}</p>
                <span className="mode-card-foot">
                  <span>{isActive ? `− ${t.validate.quick.closeMode}` : `+ ${item.title}`}</span>
                  <IconChevronDown
                    size={15}
                    style={{
                      transform: isActive ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.16s ease',
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </Reveal>

      {mode !== null && (
        <div key={mode} className="mode-workspace">
          <div className="mode-workspace-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0 }}>{activeModeMeta?.title}</h2>
              <span className="badge accent">{activeModeMeta?.badge}</span>
            </div>
            <button type="button" className="btn ghost small" onClick={() => setMode(null)}>
              <IconChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />
              {t.validate.quick.closeMode}
            </button>
          </div>

          {mode === 'offline' && <div className="mode-intro-banner">{t.validate.modes.offlineIntro}</div>}
          {mode === 'figmaApi' && <div className="mode-intro-banner">{t.validate.modes.figmaApiIntro}</div>}
          {mode === 'mcpAgent' && (
            <div className="mcp-steps-strip">
              {t.validate.modes.mcpSteps.map((step) => (
                <div key={step} className="mcp-step-pill">
                  {step}
                </div>
              ))}
            </div>
          )}

          <div className="precision-strip">
            <div className="precision-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{t.validate.precisionLabel}</strong>
                <span className="badge accent">
                  <CountUp value={precision} suffix="%" />
                </span>
              </div>
              <span className="notice" style={{ marginTop: 2 }}>
                {t.validate.precisionReadout
                  .replace('{size}', String(activeTolerances.size))
                  .replace('{spacing}', String(activeTolerances.spacing))
                  .replace('{color}', String(activeTolerances.color))}
              </span>
            </div>
          </div>

          {mode === 'offline' && (
            <div className="grid-2">
              <div className="card">
                <h2>{t.validate.offline.figmaCardTitle}</h2>
                {figmaImage ? (
                  <div className="preview-box">
                    <div className="preview-img-wrap">
                      <img src={figmaImage.dataUrl} alt={figmaImage.name} />
                    </div>
                    <div className="preview-meta">
                      <div>
                        <strong>{figmaImage.name}</strong>
                        <div className="notice" style={{ marginTop: 2 }}>
                          {t.validate.offline.figmaDimensions}: {logicalFrame?.width} × {logicalFrame?.height} px
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {t.validate.offline.figmaScaleLabel}
                          <select
                            className="select compact"
                            style={{ width: 68, padding: '4px 6px' }}
                            value={exportScale}
                            onChange={(e) => handleScaleChange(Number(e.target.value) as ExportScale)}
                          >
                            <option value={1}>@1x</option>
                            <option value={2}>@2x</option>
                            <option value={3}>@3x</option>
                          </select>
                        </label>
                        <button type="button" className="btn secondary small" onClick={() => setFigmaImage(null)}>
                          {t.validate.offline.figmaClear}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`dropzone${figmaDragging ? ' dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setFigmaDragging(true);
                    }}
                    onDragLeave={() => setFigmaDragging(false)}
                    onDrop={onDropFile(handleFigmaFile, setFigmaDragging)}
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        if (f) void handleFigmaFile(f);
                      }}
                    />
                    <span className="dropzone-icon">
                      <IconUpload size={18} />
                    </span>
                    <p className="dropzone-hint">{t.validate.offline.figmaDropHint}</p>
                  </div>
                )}

                <details className="spec-details">
                  <summary>{t.validate.offline.specToggle}</summary>
                  <div className="spec-toolbar">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => {
                          setSpecText(formatSpecJson(demoSpec));
                          if (demoSpec.viewport) {
                            setViewportWidth(demoSpec.viewport.width);
                            setViewportHeight(demoSpec.viewport.height);
                          }
                        }}
                      >
                        {t.validate.offline.loadDemoSpec}
                      </button>
                      {specText && (
                        <button type="button" className="btn secondary small" onClick={() => setSpecText('')}>
                          {t.validate.offline.clearSpec}
                        </button>
                      )}
                    </div>
                    {specText.trim() && (
                      <span className={`badge ${specState.valid ? 'ok' : 'fail'}`}>
                        {specState.valid ? t.validate.offline.specValid : t.validate.offline.specInvalid}
                      </span>
                    )}
                  </div>
                  <textarea
                    className="code-box"
                    value={specText}
                    onChange={(e) => setSpecText(e.target.value)}
                    placeholder='{ "regions": [ { "name": "Title", "selector": "h1", "expect": { "fontSize": 24 } } ] }'
                  />
                </details>
              </div>

              {renderTargetSection()}
            </div>
          )}

          {mode === 'figmaApi' && (
            <>
              <div className="card">
                <div className="field-group">
                  <label className="field-label" htmlFor="figma-api-url">
                    {t.validate.figmaApi.urlLabel}
                  </label>
                  <input
                    id="figma-api-url"
                    className="input"
                    value={figmaApiUrl}
                    onChange={(e) => setFigmaApiUrl(e.target.value)}
                    placeholder={t.validate.figmaApi.urlPlaceholder}
                  />
                  <div>
                    {parsedFigmaApiUrl ? (
                      <span className="badge ok">
                        {t.validate.figmaApi.parsedBadge}: {parsedFigmaApiUrl.fileKey} · {parsedFigmaApiUrl.nodeId}
                      </span>
                    ) : (
                      <span className="badge warn">{t.validate.figmaApi.invalidUrl}</span>
                    )}
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="figma-api-token">
                    {t.validate.figmaApi.tokenLabel}
                  </label>
                  <input
                    id="figma-api-token"
                    type="password"
                    className="input"
                    value={figmaToken}
                    onChange={(e) => setFigmaToken(e.target.value)}
                    placeholder={t.validate.figmaApi.tokenPlaceholder}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={rememberToken}
                      onChange={(e) => setRememberToken(e.target.checked)}
                    />
                    <span>{t.validate.figmaApi.rememberToken}</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={includeContainers}
                      onChange={(e) => setIncludeContainers(e.target.checked)}
                    />
                    <span>{t.validate.figmaApi.includeContainers}</span>
                  </label>
                </div>

                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busy) || !parsedFigmaApiUrl || !figmaToken.trim()}
                  onClick={() => void fetchFromFigmaApi()}
                >
                  {busy === 'figmaApi' ? t.validate.figmaApi.fetchingBtn : t.validate.figmaApi.fetchBtn}
                </button>

                {apiFetchedInfo && <p className="notice ok">{apiFetchedInfo}</p>}
              </div>

              {figmaImage && (
                <div className="grid-2">
                  <div className="card">
                    <h2>{t.validate.offline.figmaCardTitle}</h2>
                    <div className="preview-box">
                      <div className="preview-img-wrap">
                        <img src={figmaImage.dataUrl} alt={figmaImage.name} />
                      </div>
                      <div className="preview-meta">
                        <span>
                          {logicalFrame?.width} × {logicalFrame?.height} px (@{exportScale}x)
                        </span>
                      </div>
                    </div>
                    <details className="spec-details">
                      <summary>{t.validate.offline.specToggle}</summary>
                      <textarea
                        className="code-box"
                        style={{ marginTop: 10 }}
                        value={specText}
                        onChange={(e) => setSpecText(e.target.value)}
                      />
                    </details>
                  </div>
                  {renderTargetSection()}
                </div>
              )}
            </>
          )}

          {mode === 'mcpAgent' && (
            <div className="card">
              <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14 }}>{t.validate.mcpAgent.intro}</p>

              {incomingReport && (
                <div className="banner ok">
                  <span>
                    {t.validate.mcpAgent.newReportBanner} <strong>{incomingReport.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => navigate(`/reports/${incomingReport.id}`)}
                  >
                    {t.validate.mcpAgent.openReportBtn}
                  </button>
                </div>
              )}

              <div className="grid-2">
                <div className="field-group">
                  <label className="field-label" htmlFor="mcp-figma-url">
                    {t.validate.mcpAgent.figmaUrlLabel}
                  </label>
                  <input
                    id="mcp-figma-url"
                    className="input"
                    value={mcpFigmaUrl}
                    onChange={(e) => setMcpFigmaUrl(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="mcp-screen-url">
                    {t.validate.mcpAgent.localhostUrlLabel}
                  </label>
                  <input
                    id="mcp-screen-url"
                    className="input"
                    value={mcpScreenUrl}
                    onChange={(e) => setMcpScreenUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <label style={{ flex: 1, minWidth: 200 }}>
                  {t.validate.mcpAgent.reportNameLabel}
                  <input className="input" value={mcpName} onChange={(e) => setMcpName(e.target.value)} />
                </label>
                <label>
                  {t.validate.mcpAgent.agentLabel}
                  <select
                    className="select"
                    style={{ width: 170 }}
                    value={['claude', 'codex', 'gemini'].includes(mcpAgent) ? mcpAgent : 'other'}
                    onChange={(e) => setMcpAgent(e.target.value === 'other' ? 'custom-agent' : e.target.value)}
                  >
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                    <option value="gemini">Gemini / Antigravity</option>
                    <option value="other">{t.validate.mcpAgent.otherAgent}</option>
                  </select>
                </label>
                {!['claude', 'codex', 'gemini'].includes(mcpAgent) && (
                  <label>
                    {t.validate.mcpAgent.agentNameLabel}
                    <input
                      className="input compact"
                      value={mcpAgent}
                      onChange={(e) => setMcpAgent(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  {t.validate.mcpAgent.taskLabel}
                  <select
                    className="select"
                    style={{ width: 250 }}
                    value={mcpTask}
                    onChange={(e) => setMcpTask(e.target.value as 'audit' | 'fix')}
                  >
                    <option value="audit">{t.validate.mcpAgent.taskAudit}</option>
                    <option value="fix">{t.validate.mcpAgent.taskAuditAndFix}</option>
                  </select>
                </label>
              </div>

              <textarea className="code-box" style={{ minHeight: 220 }} readOnly value={mcpPrompt} />

              <div className="val-actions" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className={`btn${copiedKey === 'mcp' ? ' copied' : ''}`}
                  onClick={() => void copyText('mcp', mcpPrompt)}
                >
                  {copiedKey === 'mcp' ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  {copiedKey === 'mcp' ? t.validate.mcpAgent.copied : t.validate.mcpAgent.copyPromptBtn}
                </button>
                <span className="badge accent">
                  <span className="pulse-dot" />
                  {t.validate.mcpAgent.watchingLabel}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
