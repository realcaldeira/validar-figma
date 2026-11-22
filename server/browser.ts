// Chrome próprio do app: usa o Google Chrome instalado na máquina e conversa com ele pelo
// protocolo de depuração (CDP) via WebSocket nativo do Node. Sem Playwright ou Puppeteer.
// O perfil fica em .chrome-profile, então um login feito uma vez na janela do app continua valendo.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http.ts';

const PROFILE_DIR = path.resolve(process.env.FIGMA_VALIDATOR_CHROME_PROFILE || '.chrome-profile');
const IDLE_SHUTDOWN_MS = 10 * 60_000;

function chromeCandidates(): string[] {
  const list = [process.env.CHROME_PATH];
  if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else if (process.platform === 'win32') {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA];
    for (const base of pf) if (base) list.push(path.join(base, 'Google/Chrome/Application/chrome.exe'));
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return list.filter((p): p is string => Boolean(p));
}

function findChrome(): string {
  const found = chromeCandidates().find((p) => existsSync(p));
  if (!found) throw new HttpError(500, 'Google Chrome not found (set CHROME_PATH)');
  return found;
}

// ---------- Cliente CDP mínimo ----------

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
}

class Cdp {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(msg: CdpMessage) => void>();

  private ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(ev.data)) as CdpMessage;
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('Chrome connection closed'));
      this.pending.clear();
    });
  }

  static connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new Cdp(ws));
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not connect to Chrome'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {
          /* ignora */
        }
        reject(new Error('Could not connect to Chrome'));
      }, timeoutMs);
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on(fn: (msg: CdpMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  waitFor(method: string, sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const cleanup = () => {
        clearTimeout(timer);
        off();
        this.ws.removeEventListener('close', onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Chrome connection closed'));
      };
      this.ws.addEventListener('close', onClose);
      const off = this.on((msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          cleanup();
          resolve();
        }
      });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* já fechado */
    }
  }
}

// ---------- Processo do Chrome ----------

interface BrowserHandle {
  proc: ChildProcess;
  wsUrl: string;
  headless: boolean;
  exited: Promise<void>;
}

let current: BrowserHandle | null = null;

// Se o servidor sair (Ctrl-C, erro), o Chrome do app sai junto e não fica preso ao perfil.
process.once('exit', () => {
  current?.proc.kill();
});
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function readDevToolsPort(timeoutMs: number, proc: ChildProcess): Promise<string> {
  const file = path.join(PROFILE_DIR, 'DevToolsActivePort');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) throw new HttpError(500, 'Chrome closed right after starting (is the app profile already open?)');
    try {
      const [port, wsPath] = (await readFile(file, 'utf8')).trim().split('\n');
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    } catch {
      /* ainda não existe */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new HttpError(500, 'Chrome did not start in time');
}

/** Chrome do app que ficou para trás (servidor que caiu ou foi fechado à força) prende o perfil: encerra. */
async function killOrphans(includeHelpers = false): Promise<void> {
  if (process.platform === 'win32') return;
  const out = await new Promise<string>((resolve) => {
    execFile('ps', ['-ax', '-o', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => resolve(stdout || ''));
  });
  const flag = `--user-data-dir=${PROFILE_DIR}`;
  const pids = out
    .split('\n')
    .filter((line) => line.includes(flag) && (includeHelpers || !line.includes('--type=')))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => pid && pid !== current?.proc.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* já saiu */
    }
  }
  if (!pids.length) return;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const start = Date.now();
  while (pids.some(alive) && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 100));
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* já saiu */
    }
  }
}

/** Abre o Chrome do app; se ele não subir (perfil ainda preso pelo Chrome anterior), limpa tudo e tenta de novo. */
async function launch(headless: boolean, startUrl?: string): Promise<BrowserHandle> {
  try {
    return await launchOnce(headless, startUrl, false);
  } catch {
    return launchOnce(headless, startUrl, true);
  }
}

async function launchOnce(headless: boolean, startUrl: string | undefined, forceClean: boolean): Promise<BrowserHandle> {
  await mkdir(PROFILE_DIR, { recursive: true });
  await killOrphans(forceClean);
  if (forceClean) {
    for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) await rm(path.join(PROFILE_DIR, lock), { force: true });
  }
  await rm(path.join(PROFILE_DIR, 'DevToolsActivePort'), { force: true });
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--disable-background-networking',
  ];
  if (headless) args.push('--headless=new', '--hide-scrollbars', '--mute-audio');
  args.push(startUrl || 'about:blank');
  const proc = spawn(findChrome(), args, { stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  const handle: BrowserHandle = { proc, wsUrl: '', headless, exited };
  exited.then(() => {
    if (current === handle) current = null;
  });
  try {
    handle.wsUrl = await readDevToolsPort(forceClean ? 30_000 : 15_000, proc);
  } catch (err) {
    if (proc.exitCode === null) proc.kill('SIGKILL');
    throw err;
  }
  return handle;
}

async function closeBrowser(handle: BrowserHandle): Promise<void> {
  try {
    const cdp = await Cdp.connect(handle.wsUrl, 3_000);
    await Promise.race([cdp.send('Browser.close'), new Promise((r) => setTimeout(r, 3_000))]).catch(() => undefined);
    cdp.close();
  } catch {
    handle.proc.kill();
  }
  await Promise.race([handle.exited, new Promise((r) => setTimeout(r, 5000))]);
  if (handle.proc.exitCode === null) handle.proc.kill('SIGKILL');
  await handle.exited;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Pela fila: nunca fecha no meio de uma medição, e a próxima validação já encontra `current` vazio e abre outro.
    const run = queue.then(async () => {
      const h = current;
      if (!h?.headless) return;
      current = null;
      await closeBrowser(h);
    });
    queue = run.catch(() => undefined);
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.();
}

async function ensureHeadless(): Promise<BrowserHandle> {
  if (current && !current.headless) {
    // A janela de login estava aberta: fecha (o Chrome grava os cookies no perfil) e segue em segundo plano.
    await closeBrowser(current);
    current = null;
  }
  if (!current) current = await launch(true);
  return current;
}

/** Deixa o Chrome de segundo plano aberto antes de precisar dele (a validação não espera ele subir). */
export function prewarmBrowser(): void {
  if (current?.headless) return;
  const run = queue.then(async () => {
    if (!current) current = await launch(true);
    scheduleIdleShutdown();
  });
  queue = run.catch(() => undefined);
}

/** Abre uma janela visível do Chrome do app, com o mesmo perfil, para o usuário fazer login. */
export function openLoginWindow(url: string): Promise<void> {
  const run = queue.then(async () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (current?.headless) {
      await closeBrowser(current);
      current = null;
    }
    if (current) {
      try {
        const cdp = await Cdp.connect(current.wsUrl);
        await cdp.send('Target.createTarget', { url, newWindow: true });
        cdp.close();
        return;
      } catch {
        current = null;
      }
    }
    current = await launch(false, url);
  });
  queue = run.catch(() => undefined);
  return run;
}

const DOM_QUIET_SCRIPT = `new Promise((resolve) => {
  let last = Date.now();
  const start = last;
  const obs = new MutationObserver(() => { last = Date.now(); });
  obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const busy = () => document.querySelector('[aria-busy="true"], [class*="skeleton" i], [class*="Skeleton"]');
  const tick = () => {
    const quiet = Date.now() - last > 800 && !busy();
    if (quiet || Date.now() - start > 20000) { obs.disconnect(); resolve(true); } else setTimeout(tick, 150);
  };
  tick();
})`;

export interface MeasureOptions {
  url: string;
  width: number;
  height: number;
  validatorJs: string;
  spec: unknown;
}

export interface MeasureResult {
  /** Tempo de cada etapa, em ms (para achar o que está lento). */
  timings: Record<string, number>;
  report: Record<string, unknown> & { regions: unknown[] };
  screenshotDataUrl: string;
  finalUrl: string;
}

/** Abre a URL no Chrome do app, espera a tela assentar, mede com o validador e tira a captura. */
export function measureScreen(opts: MeasureOptions): Promise<MeasureResult> {
  const run = queue.then(() => doMeasure(opts));
  queue = run.catch(() => undefined);
  return run;
}

async function doMeasure(opts: MeasureOptions): Promise<MeasureResult> {
  if (idleTimer) clearTimeout(idleTimer);
  const timings: Record<string, number> = {};
  let mark = Date.now();
  const lap = (name: string) => {
    const now = Date.now();
    timings[name] = now - mark;
    mark = now;
  };
  const browser = await ensureHeadless();
  lap('chrome');
  const cdp = await Cdp.connect(browser.wsUrl);
  let targetId: string | null = null;
  try {
    ({ targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const s = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);

    await s('Page.enable');
    await s('Network.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });

    // Contagem de requisições em andamento, para saber quando a tela terminou de carregar dados.
    const inflight = new Set<string>();
    let lastActivity = Date.now();
    const off = cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      const id = (msg.params as { requestId?: string } | undefined)?.requestId;
      if (!id) return;
      if (msg.method === 'Network.requestWillBeSent') inflight.add(id);
      else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') inflight.delete(id);
      else return;
      lastActivity = Date.now();
    });

    const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 45_000);
    // Se a navegação falhar antes, ninguém espera essa promessa: sem este catch o erro derrubaria o servidor.
    loaded.catch(() => undefined);
    const nav = await s('Page.navigate', { url: opts.url });
    if (nav.errorText) {
      const why = String(nav.errorText);
      if (/ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/.test(why)) throw new HttpError(502, `Nothing is running at ${opts.url}`);
      if (/ERR_NAME_NOT_RESOLVED/.test(why)) throw new HttpError(502, `Address not found: ${opts.url}`);
      if (/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(why)) throw new HttpError(502, `Screen answered with an HTTP error: ${opts.url}`);
      throw new HttpError(502, `Could not open ${opts.url}: ${why}`);
    }
    await loaded.catch(() => {
      throw new HttpError(504, `Screen did not finish loading: ${opts.url}`);
    });
    lap('load');

    // Espera a rede ficar quieta por 0,6 s (até 20 s) e as fontes carregarem.
    const settleStart = Date.now();
    while (Date.now() - settleStart < 20_000) {
      if (inflight.size === 0 && Date.now() - lastActivity > 600) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    off();
    // Depois da rede, espera a tela parar de mudar (dados chegando, esqueletos de carregamento sumindo).
    await s('Runtime.evaluate', { expression: DOM_QUIET_SCRIPT, awaitPromise: true });
    await s('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(() => true) : true', awaitPromise: true });
    await new Promise((r) => setTimeout(r, 150));
    lap('settle');

    const inject = await s('Runtime.evaluate', { expression: opts.validatorJs });
    if (inject.exceptionDetails) throw new HttpError(500, 'Validator script failed to load in the page');
    const evaluated = await s('Runtime.evaluate', {
      expression: `window.__figmaValidator(${JSON.stringify(opts.spec)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      const details = evaluated.exceptionDetails as { exception?: { description?: string }; text?: string };
      throw new HttpError(500, `Validator failed: ${details.exception?.description || details.text || 'unknown error'}`);
    }
    const report = (evaluated.result as { value?: MeasureResult['report'] }).value;
    if (!report || !Array.isArray(report.regions)) throw new HttpError(500, 'Validator returned no report');
    lap('measure');

    const metrics = await s('Runtime.evaluate', {
      expression: 'JSON.stringify({ h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), url: location.href })',
      returnByValue: true,
    });
    let finalUrl = opts.url;
    try {
      const rawMetrics = (metrics.result as { value?: string } | undefined)?.value;
      if (rawMetrics) {
        const parsed = JSON.parse(rawMetrics) as { h?: number; url?: string };
        if (parsed.url) finalUrl = parsed.url;
      }
    } catch {
      /* mantém opts.url */
    }
    // A captura tem exatamente o tamanho do frame do Figma, para comparar lado a lado na mesma escala.
    const shot = await s('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale: 1 },
    });
    lap('screenshot');
    return { report, screenshotDataUrl: `data:image/png;base64,${String(shot.data)}`, finalUrl, timings };
  } finally {
    if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
    cdp.close();
    scheduleIdleShutdown();
  }
}

/** Fecha o Chrome do app quando o servidor para. */
export async function shutdownBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (current) await closeBrowser(current);
}
