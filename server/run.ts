// Validação de um passo, sem agente: link do Figma + endereço da tela → relatório salvo.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValidationReport } from '../src/engine/types.ts';
import { measureScreen, openLoginWindow, prewarmBrowser } from './browser.ts';
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

export async function handleRunRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
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
    const frame =
      figma.figmaFrame && figma.figmaFrame.width > 0 && figma.figmaFrame.height > 0
        ? { width: Math.round(figma.figmaFrame.width), height: Math.round(figma.figmaFrame.height) }
        : { width: 1440, height: 900 };
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
