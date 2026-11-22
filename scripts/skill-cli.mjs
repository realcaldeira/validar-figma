#!/usr/bin/env node
// validar-figma — medição pelo terminal, para agentes que rodam só no terminal, sem navegador próprio.
// Não usa token nem API do Figma: as regras (spec) vêm do agente, que lê o Figma pelo MCP.
// Abre um Chrome em segundo plano, injeta browser/validator.js na tela e grava o relatório.
// Copiado para a skill como bin/validar.mjs pelo "npm run sync-skill" do app validar-figma. Não edite lá.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELP = `Uso:
  node validar.mjs --url <endereço da tela> --spec <spec.json> [opções]
  node validar.mjs --login --url <endereço>      abre uma janela do Chrome para fazer login uma vez

Opções:
  --url <url>           tela a medir (http, https ou file://; um caminho local também serve)
  --spec <arquivo>      spec escrita a partir do Figma (formato em references/spec-format.md)
  --width <px>          largura da tela (padrão: figmaFrame.width da spec, senão 1440)
  --height <px>         altura (padrão: figmaFrame.height da spec, senão 900)
  --out <pasta>         onde gravar report.json, report.md e screen.png (padrão: ./.figma-validation)
  --send [servidor]     manda o relatório visual ao app Figma Validator (padrão http://localhost:5199)
  --name <texto>        nome do relatório no app
  --project <texto>     projeto do relatório no app (ex.: Checkout)
  --figma-url <url>     link do frame, guardado no relatório
  --figma-image <png>   imagem do frame (para o lado a lado no app)
  --figma-image-url <u> link da imagem do frame (o image_url do get_screenshot do MCP do Figma)
  --profile <pasta>     perfil do Chrome (padrão: ~/.cache/validar-figma/chrome); guarda o login
  --timeout <s>         espera máxima pela tela (padrão 45)
  --json                imprime o relatório inteiro em JSON em vez do resumo

Precisa de Node 22+ e de Google Chrome, Chromium ou Edge instalado (ou CHROME_PATH).`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg, code = 1) {
  process.stderr.write(`validar-figma: ${msg}\n`);
  process.exit(code);
}

const here = path.dirname(fileURLToPath(import.meta.url));

function findValidator() {
  for (const p of [path.join(here, '..', 'browser', 'validator.js'), path.join(here, 'validator.js')]) if (existsSync(p)) return p;
  return null;
}

function chromeCandidates() {
  const list = [process.env.CHROME_PATH];
  if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return list.filter(Boolean);
}

function normalizeUrl(raw) {
  if (/^(https?|file):\/\//i.test(raw)) return raw;
  const local = path.resolve(raw);
  if (existsSync(local)) return pathToFileURL(local).href;
  // "localhost:3000/x" ou "meu-host:8080" é host com porta, não protocolo.
  if (/^[\w.-]+:\d+(\/|$)/.test(raw)) return `http://${raw}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) fail(`endereço não suportado: ${raw}`);
  return `http://${raw}`;
}

// ---------- Chrome pelo protocolo DevTools (sem Playwright) ----------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
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
      for (const p of this.pending.values()) p.reject(new Error('conexão com o Chrome fechou'));
      this.pending.clear();
    });
  }

  static connect(url, timeoutMs = 10_000) {
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
        reject(new Error('não foi possível conectar ao Chrome'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          ws.close();
        } catch {
          /* já fechada */
        }
        reject(new Error('não foi possível conectar ao Chrome'));
      }, timeoutMs);
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  waitFor(method, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        off();
        this.ws.removeEventListener('close', onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('conexão com o Chrome fechou'));
      };
      this.ws.addEventListener('close', onClose);
      const off = this.on((msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          cleanup();
          resolve(msg.params ?? {});
        }
      });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`tempo esgotado esperando ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* já fechada */
    }
  }
}

async function launchChrome(profileDir, headless, startUrl) {
  const chrome = chromeCandidates().find((p) => existsSync(p));
  if (!chrome) fail('Google Chrome, Chromium ou Edge não encontrado. Instale um deles ou defina CHROME_PATH.');
  mkdirSync(profileDir, { recursive: true });
  rmSync(path.join(profileDir, 'DevToolsActivePort'), { force: true });
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--disable-background-networking',
  ];
  if (headless) args.push('--headless=new', '--hide-scrollbars', '--mute-audio');
  args.push(startUrl || 'about:blank');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const start = Date.now();
  let lines = [];
  for (;;) {
    if (existsSync(portFile)) {
      lines = readFileSync(portFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length >= 2) break;
    }
    if (proc.exitCode !== null) {
      fail(`o Chrome fechou ao abrir. Outro Chrome pode estar usando o perfil ${profileDir}: feche-o ou use --profile <outra pasta>.`);
    }
    if (Date.now() - start > 20_000) {
      proc.kill('SIGKILL');
      fail('o Chrome não respondeu em 20 s.');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const [port, wsPath] = lines;
  return { proc, exited, wsUrl: `ws://127.0.0.1:${port}${wsPath}` };
}

async function closeChrome(chrome) {
  try {
    const cdp = await Cdp.connect(chrome.wsUrl, 3000);
    await Promise.race([cdp.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined);
    cdp.close();
  } catch {
    chrome.proc.kill();
  }
  await Promise.race([chrome.exited, new Promise((r) => setTimeout(r, 5000))]);
  if (chrome.proc.exitCode === null) chrome.proc.kill('SIGKILL');
}

const DOM_QUIET_SCRIPT = `new Promise((resolve) => {
  let last = Date.now();
  const start = last;
  const obs = new MutationObserver(() => { last = Date.now(); });
  obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const busy = () => document.querySelector('[aria-busy="true"], [class*="skeleton" i], [class*="loading" i], [class*="spinner" i]');
  const tick = () => {
    const quiet = Date.now() - last > 800 && !busy();
    if (quiet || Date.now() - start > 20000) { obs.disconnect(); resolve(true); } else setTimeout(tick, 150);
  };
  tick();
})`;

async function measure({ url, width, height, spec, validatorJs, profileDir, timeoutMs }) {
  const chrome = await launchChrome(profileDir, true);
  const cdp = await Cdp.connect(chrome.wsUrl);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params = {}) => cdp.send(method, params, sessionId);
    await s('Page.enable');
    await s('Network.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    const inflight = new Set();
    let lastActivity = Date.now();
    const off = cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      const id = msg.params?.requestId;
      if (!id) return;
      if (msg.method === 'Network.requestWillBeSent') inflight.add(id);
      else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') inflight.delete(id);
      else return;
      lastActivity = Date.now();
    });

    const loaded = cdp.waitFor('Page.loadEventFired', sessionId, timeoutMs);
    loaded.catch(() => undefined);
    const nav = await s('Page.navigate', { url });
    if (nav.errorText) {
      const why = String(nav.errorText);
      if (/ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/.test(why)) throw new Error(`nada respondendo em ${url} (a tela está no ar?)`);
      if (/ERR_NAME_NOT_RESOLVED/.test(why)) throw new Error(`endereço não encontrado: ${url} (VPN?)`);
      throw new Error(`não abriu ${url}: ${why}`);
    }
    await loaded.catch(() => {
      throw new Error(`a tela não terminou de carregar em ${timeoutMs / 1000} s: ${url}`);
    });
    const settleStart = Date.now();
    while (Date.now() - settleStart < 20_000) {
      if (inflight.size === 0 && Date.now() - lastActivity > 600) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    off();
    await s('Runtime.evaluate', { expression: DOM_QUIET_SCRIPT, awaitPromise: true });
    await s('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(() => true) : true', awaitPromise: true });
    await new Promise((r) => setTimeout(r, 150));

    const finalUrl = (await s('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result?.value ?? url;
    const inject = await s('Runtime.evaluate', { expression: validatorJs });
    if (inject.exceptionDetails) throw new Error('o validator.js não carregou na página');
    const evaluated = await s('Runtime.evaluate', {
      expression: `window.__figmaValidator(${JSON.stringify(spec)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      const d = evaluated.exceptionDetails;
      throw new Error(`o validador falhou: ${d.exception?.description || d.text || 'erro desconhecido'}`);
    }
    const report = evaluated.result?.value;
    if (!report || !Array.isArray(report.regions)) throw new Error('o validador não devolveu relatório');
    const shot = await s('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return { report, screenshot: String(shot.data), finalUrl };
  } finally {
    cdp.close();
    await closeChrome(chrome);
  }
}

async function login(url, profileDir) {
  const chrome = await launchChrome(profileDir, false, url);
  process.stdout.write(`Janela do Chrome aberta em ${url}.\nFaça o login e feche a janela; o login fica guardado em ${profileDir}.\n`);
  // No Mac, fechar a última janela não fecha o Chrome (e o perfil ficaria preso): quando não sobra aba, fecha ele.
  let cdp = null;
  try {
    cdp = await Cdp.connect(chrome.wsUrl);
  } catch {
    cdp = null;
  }
  if (cdp) {
    // Fecha quando não sobra aba: depois de ter visto uma, ou se nenhuma apareceu em ~5 s (janela fechada logo de cara).
    let sawPage = false;
    let emptyPolls = 0;
    while (chrome.proc.exitCode === null) {
      const targets = await Promise.race([cdp.send('Target.getTargets').catch(() => null), chrome.exited.then(() => null)]);
      if (!targets) break;
      const pages = (targets.targetInfos || []).filter((t) => t.type === 'page');
      if (pages.length) {
        sawPage = true;
        emptyPolls = 0;
      } else if (sawPage || ++emptyPolls >= 10) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    cdp.close();
    if (chrome.proc.exitCode === null) await closeChrome(chrome);
  } else {
    await chrome.exited;
  }
  process.stdout.write('Login guardado. Agora rode a validação normalmente.\n');
}

function summaryLine(summary) {
  const split = summary.fail && summary.failCss !== undefined ? ` (${summary.failVisible} visíveis, ${summary.failCss} só no CSS)` : '';
  const strict = typeof summary.scoreVisible === 'number' && summary.scoreVisible !== summary.score;
  const score = strict ? `fidelidade ${summary.scoreVisible}% (rigorosa ${summary.score}%)` : `fidelidade ${summary.score}%`;
  return `${summary.pass} ok · ${summary.fail} falhas${split} · ${summary.warn} avisos · ${score}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || (!args.url && !args.login)) {
    process.stdout.write(`${HELP}\n`);
    process.exit(args.help || args.h ? 0 : 1);
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22 || typeof WebSocket !== 'function') fail(`precisa de Node 22 ou mais novo (este é ${process.versions.node}).`);
  const profileDir = path.resolve(args.profile || path.join(os.homedir(), '.cache', 'validar-figma', 'chrome'));
  const timeoutMs = Math.max(5, Number(args.timeout) || 45) * 1000;

  if (args.login) {
    if (typeof args.url !== 'string') fail('use --login junto com --url <endereço>.');
    await login(normalizeUrl(args.url), profileDir);
    return;
  }
  if (typeof args.url !== 'string') fail('faltou --url <endereço da tela>.');
  if (typeof args.spec !== 'string') fail('faltou --spec <spec.json> (escreva a spec a partir do Figma lido pelo MCP).');
  if (!existsSync(args.spec)) fail(`spec não encontrada: ${args.spec}`);
  let spec;
  try {
    spec = JSON.parse(readFileSync(args.spec, 'utf8'));
  } catch (e) {
    fail(`spec com JSON inválido: ${e.message}`);
  }
  if (!spec || !Array.isArray(spec.regions)) fail('a spec precisa ter "regions" (veja references/spec-format.md).');

  const validatorPath = findValidator();
  if (!validatorPath) fail('browser/validator.js não encontrado ao lado deste script.');
  const validatorJs = readFileSync(validatorPath, 'utf8');

  const width = Math.round(Number(args.width) || spec.figmaFrame?.width || spec.viewport?.width || 1440);
  const height = Math.round(Number(args.height) || spec.figmaFrame?.height || 900);
  const url = normalizeUrl(args.url);

  const { report, screenshot, finalUrl } = await measure({ url, width, height, spec, validatorJs, profileDir, timeoutMs });

  const outDir = path.resolve(typeof args.out === 'string' ? args.out : '.figma-validation');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(outDir, 'report.md'), report.markdown || '');
  writeFileSync(path.join(outDir, 'screen.png'), Buffer.from(screenshot, 'base64'));

  let sent = null;
  if (args.send) {
    const server = String(args.send === true ? 'http://localhost:5199' : args.send).replace(/\/$/, '');
    let figmaImageData = null;
    if (typeof args['figma-image-url'] === 'string') {
      try {
        const img = await fetch(args['figma-image-url'], { signal: AbortSignal.timeout(30_000) });
        if (!img.ok) throw new Error(`HTTP ${img.status}`);
        const type = (img.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith('image/')) throw new Error(`tipo não suportado: ${type || 'desconhecido'}`);
        figmaImageData = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
      } catch (e) {
        process.stderr.write(`validar-figma: não baixei a imagem do Figma (${e.message}); o relatório vai sem ela.\n`);
      }
    }
    if (typeof args['figma-image'] === 'string') {
      if (!existsSync(args['figma-image'])) fail(`imagem do Figma não encontrada: ${args['figma-image']}`);
      const ext = path.extname(args['figma-image']).toLowerCase();
      const mimeByExt = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
      };
      const mime = mimeByExt[ext] || 'image/png';
      figmaImageData = `data:${mime};base64,${readFileSync(args['figma-image']).toString('base64')}`;
    }
    try {
      const res = await fetch(`${server}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: typeof args.name === 'string' ? args.name : spec.name || 'Validação pelo terminal',
          project: typeof args.project === 'string' ? args.project : undefined,
          url: finalUrl,
          figmaUrl: typeof args['figma-url'] === 'string' ? args['figma-url'] : spec.figma?.url ?? null,
          figmaImageData,
          screenImageData: `data:image/png;base64,${screenshot}`,
          // O tamanho do frame vem da spec; a janela medida já vai em report.viewport (o app avisa se forem diferentes).
          figmaFrame: spec.figmaFrame?.width && spec.figmaFrame?.height ? spec.figmaFrame : { width, height },
          precision: report.precision ?? 100,
          report,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent = await res.json();
    } catch (e) {
      process.stderr.write(`validar-figma: não consegui mandar ao app em ${server} (${e.message}). O relatório ficou em ${outDir}.\n`);
    }
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [`Resultado: ${summaryLine(report.summary)}`, `Tela: ${finalUrl} (${width}×${height})`];
  const fails = (r, vis) => r.results.filter((x) => x.status === 'fail' && (x.visibility ?? 'visible') === vis);
  const failing = report.regions.filter((r) => fails(r, 'visible').length);
  if (failing.length) {
    lines.push('', 'Diferenças visíveis:');
    for (const r of failing.slice(0, 40)) {
      for (const c of fails(r, 'visible').slice(0, 6)) {
        lines.push(`- ${r.name} · ${c.property}: Figma ${c.expected} → tela ${c.actual}${c.note ? ` (${c.note})` : ''}`);
      }
    }
    if (failing.length > 40) lines.push(`… e mais ${failing.length - 40} regiões; veja report.md`);
  }
  const cssOnly = report.regions.filter((r) => fails(r, 'css').length);
  if (cssOnly.length) {
    const n = cssOnly.reduce((t, r) => t + fails(r, 'css').length, 0);
    lines.push('', `Só no CSS (não se vê na tela): ${n} em ${cssOnly.length} regiões; a lista está em report.md`);
  }
  if (report.pendingStates?.length) lines.push('', `Estados para medir à parte (hover/focus): ${report.pendingStates.map((p) => p.name).join(', ')}`);
  lines.push('', `Arquivos: ${path.join(outDir, 'report.md')} · report.json · screen.png`);
  if (sent?.url) lines.push(`Relatório visual: ${sent.url}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((e) => fail(e.message || String(e)));
