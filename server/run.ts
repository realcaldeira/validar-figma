// Validação de um passo, sem agente: link do Figma + endereço da tela → relatório salvo.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Dimensions, FigmaSpec, ValidationReport } from '../src/engine/types.ts';
import {
  closeInteractiveTab,
  measureInteractiveTab,
  measureScreen,
  openInteractiveTab,
  openLoginWindow,
  prewarmBrowser,
} from './browser.ts';
import { fetchFigmaImage, fetchFigmaSpec } from './figma.ts';
import { HttpError, readBodyJson, sendResponse } from './http.ts';
import { persistReport } from './reports.ts';
import { buildValidatorBundle } from './scripts.ts';
import { DEFAULT_PRECISION } from '../src/engine/compare.ts';

interface RunRequest {
  figmaUrl?: string;
  token?: string;
  url?: string;
  name?: string;
  project?: string;
  /** Ignorado: o rigor é sempre 100% (Exato). Fica no tipo só para clientes antigos que ainda mandam. */
  precision?: number;
  includeContainers?: boolean;
}

interface PendingRun {
  id: string;
  targetId: string;
  screenUrl: string;
  name: string;
  project?: string;
  figmaUrl: string;
  frame: Dimensions;
  spec: FigmaSpec;
  imageP: Promise<string>;
  tFigma: number;
  createdAt: number;
  inProgress: boolean;
}

const PENDING_TTL_MS = 30 * 60 * 1000;
const pendingRuns = new Map<string, PendingRun>();

function prunePendingRuns(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, run] of pendingRuns.entries()) {
    if (!run.inProgress && run.createdAt < cutoff) {
      pendingRuns.delete(id);
      void closeInteractiveTab(run.targetId).catch(() => undefined);
    }
  }
}

function parseScreenUrl(raw: string | undefined): string {
  if (!raw?.trim()) throw new HttpError(400, 'Missing screen URL');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Invalid target URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http and https protocols are allowed');
  return url.toString();
}

function resolveFrame(figmaFrame: Dimensions | null | undefined): Dimensions {
  return figmaFrame && figmaFrame.width > 0 && figmaFrame.height > 0
    ? { width: Math.round(figmaFrame.width), height: Math.round(figmaFrame.height) }
    : { width: 1440, height: 900 };
}

export async function handleRunRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/validate/prepare' && method === 'POST') {
    prunePendingRuns();
    const body = await readBodyJson<RunRequest>(req);
    if (!body.figmaUrl?.trim()) throw new HttpError(400, 'Missing figmaUrl');
    const screenUrl = parseScreenUrl(body.url);

    const t0 = Date.now();
    // Abre a guia visível em paralelo com a busca do Figma para o usuário já conseguir fazer login sem esperar.
    const imageP = fetchFigmaImage(body.figmaUrl.trim(), body.token);
    imageP.catch(() => undefined);
    const tabP = openInteractiveTab(screenUrl);
    tabP.catch(() => undefined);

    let figma: Awaited<ReturnType<typeof fetchFigmaSpec>>;
    let tab: { targetId: string };
    try {
      [figma, tab] = await Promise.all([
        fetchFigmaSpec(body.figmaUrl.trim(), body.token, Boolean(body.includeContainers)),
        tabP,
      ]);
    } catch (err) {
      const opened = await tabP.catch(() => null);
      if (opened) void closeInteractiveTab(opened.targetId).catch(() => undefined);
      throw err;
    }

    const tFigma = Date.now() - t0;
    const frame = resolveFrame(figma.figmaFrame);
    const spec: FigmaSpec = { ...figma.spec, precision: DEFAULT_PRECISION };
    const sessionId = randomBytes(12).toString('hex');

    pendingRuns.set(sessionId, {
      id: sessionId,
      targetId: tab.targetId,
      screenUrl,
      name: body.name?.trim() || figma.name,
      project: body.project,
      figmaUrl: figma.figmaUrl,
      frame,
      spec,
      imageP,
      tFigma,
      createdAt: Date.now(),
      inProgress: false,
    });

    sendResponse(res, 200, {
      sessionId,
      targetUrl: screenUrl,
      figmaName: figma.name,
      figmaFrame: frame,
    });
    return true;
  }

  if (pathname === '/api/validate/continue' && method === 'POST') {
    prunePendingRuns();
    const body = await readBodyJson<{ sessionId?: string }>(req);
    const sessionId = body.sessionId?.trim();
    if (!sessionId) throw new HttpError(400, 'Missing sessionId');
    const pending = pendingRuns.get(sessionId);
    if (!pending) throw new HttpError(404, 'Validation session not found or expired');
    if (pending.inProgress) throw new HttpError(409, 'Validation is already running for this session');

    pending.inProgress = true;
    const t0 = Date.now();
    try {
      const measured = await measureInteractiveTab({
        targetId: pending.targetId,
        url: pending.screenUrl,
        width: pending.frame.width,
        height: pending.frame.height,
        validatorJs: await buildValidatorBundle(),
        spec: pending.spec,
      });

      const tImage0 = Date.now();
      let imageWarning: string | undefined;
      const figmaImage = await pending.imageP.catch((e: Error) => {
        imageWarning = `Figma image unavailable (${e.message}); the report was saved without it`;
        return null;
      });
      const tImageWait = Date.now() - tImage0;
      const report = measured.report as unknown as ValidationReport;
      const t1 = Date.now();
      const { id, warning } = await persistReport({
        name: pending.name,
        project: pending.project,
        url: measured.finalUrl,
        figmaUrl: pending.figmaUrl,
        figmaImageData: figmaImage,
        screenImageData: measured.screenshotDataUrl,
        figmaFrame: pending.frame,
        precision: DEFAULT_PRECISION,
        report,
      });
      pendingRuns.delete(sessionId);
      const timings = {
        figmaSpec: pending.tFigma,
        ...measured.timings,
        figmaImageWait: tImageWait,
        save: Date.now() - t1,
        total: Date.now() - t0,
      };
      const warnings = [imageWarning, warning].filter(Boolean).join('; ') || undefined;
      sendResponse(res, 200, { id, summary: report.summary, warning: warnings, regions: report.regions.length, timings });
      return true;
    } catch (err) {
      pendingRuns.delete(sessionId);
      throw err;
    }
  }

  if (pathname === '/api/validate/cancel' && method === 'POST') {
    prunePendingRuns();
    const body = await readBodyJson<{ sessionId?: string }>(req);
    const sessionId = body.sessionId?.trim();
    if (sessionId) {
      const pending = pendingRuns.get(sessionId);
      if (pending && !pending.inProgress) {
        pendingRuns.delete(sessionId);
        await closeInteractiveTab(pending.targetId).catch(() => undefined);
      }
    }
    sendResponse(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/validate/run' && method === 'POST') {
    const body = await readBodyJson<RunRequest>(req);
    if (!body.figmaUrl?.trim()) throw new HttpError(400, 'Missing figmaUrl');
    const screenUrl = parseScreenUrl(body.url);

    const t0 = Date.now();
    // O Chrome sobe e a imagem do Figma renderiza enquanto o resto acontece: nada espera à toa.
    prewarmBrowser();
    const imageP = fetchFigmaImage(body.figmaUrl.trim(), body.token);
    imageP.catch(() => undefined);
    const figma = await fetchFigmaSpec(body.figmaUrl.trim(), body.token, Boolean(body.includeContainers));
    const tFigma = Date.now() - t0;
    // A tela abre sempre na resolução do frame do Figma (largura e altura exatas).
    const frame = resolveFrame(figma.figmaFrame);
    // Rigor sempre 100% (Exato): um valor menor no pedido é ignorado.
    const precision = DEFAULT_PRECISION;
    const spec = { ...figma.spec, precision };

    const measured = await measureScreen({
      url: screenUrl,
      width: frame.width,
      height: frame.height,
      validatorJs: await buildValidatorBundle(),
      spec,
    });

    const tImage0 = Date.now();
    // A tela já foi medida: se a imagem do Figma não vier (frame grande demais para renderizar, falha da CDN),
    // o relatório é salvo sem ela, com um aviso, em vez de perder a medição.
    let imageWarning: string | undefined;
    const figmaImage = await imageP.catch((e: Error) => {
      imageWarning = `Figma image unavailable (${e.message}); the report was saved without it`;
      return null;
    });
    const tImageWait = Date.now() - tImage0;
    const report = measured.report as unknown as ValidationReport;
    const t1 = Date.now();
    const { id, warning } = await persistReport({
      name: body.name?.trim() || figma.name,
      project: body.project,
      url: measured.finalUrl,
      figmaUrl: figma.figmaUrl,
      figmaImageData: figmaImage,
      screenImageData: measured.screenshotDataUrl,
      figmaFrame: frame,
      precision,
      report,
    });
    const timings = { figmaSpec: tFigma, ...measured.timings, figmaImageWait: tImageWait, save: Date.now() - t1, total: Date.now() - t0 };
    const warnings = [imageWarning, warning].filter(Boolean).join('; ') || undefined;
    sendResponse(res, 200, { id, summary: report.summary, warning: warnings, regions: report.regions.length, timings });
    return true;
  }

  if (pathname === '/api/browser/login' && method === 'POST') {
    const body = await readBodyJson<{ url?: string }>(req);
    await openLoginWindow(parseScreenUrl(body.url));
    sendResponse(res, 200, { ok: true });
    return true;
  }

  return false;
}
