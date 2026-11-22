import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Dimensions, ReportSummary, ValidationReport } from '../src/engine/types.ts';
import { HttpError, MAX_IMAGE_BYTES, readBodyBuffer, readBodyJson, sanitizeSlug, sendResponse } from './http.ts';

const REPORTS_DIR = path.resolve('.reports');
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface ReportMeta {
  id: string;
  name: string;
  url: string;
  figmaUrl: string | null;
  figmaFrame: Dimensions | null;
  figmaImage: string | null;
  screenImage: string | null;
  precision: number | null;
  createdAt: string;
  summary: ReportSummary | null;
  /** Projeto a que o relatório pertence (ex.: "Checkout", "Painel"); cada projeto tem seus próprios erros. */
  project?: string | null;
}

interface StagingSession {
  id: string;
  name: string;
  figmaUrl: string | null;
  figmaFrame: Dimensions | null;
  figmaImageData: string | null;
  precision: number | null;
  spec: unknown;
  status: 'pending' | 'completed';
  reportId: string | null;
  createdAt: number;
}

const sessions = new Map<string, StagingSession>();

function pruneSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions.entries()) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

export function createReportId(name: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug =
    sanitizeSlug(name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      .replace(/[._]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'screen';
  const rand = randomBytes(2).toString('hex');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}-${slug}`;
}

const isValidId = (id: string): boolean => /^[a-z0-9-]{8,96}$/.test(id);

function decodeDataUrl(dataUrl: string): { buf: Buffer; mime: string } {
  const match = dataUrl.match(/^data:(image\/[a-z0-9+.-]+)((?:;[^;,=]+=[^;,]+)*)(;base64)?,([\s\S]*)$/i);
  if (!match) throw new HttpError(400, 'Invalid image data URL');
  const mime = match[1].toLowerCase();
  if (!EXT_BY_MIME[mime]) throw new HttpError(400, `Unsupported image type: ${mime}`);
  const isBase64 = Boolean(match[3]);
  const payload = match[4];
  let buf: Buffer;
  try {
    buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    throw new HttpError(400, 'Invalid image data URL');
  }
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image exceeds 25 MB limit');
  return { buf, mime };
}

function checkImageUrl(raw: string | URL, base?: URL): URL {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    throw new HttpError(400, 'Invalid image URL');
  }
  const isLocalHttp = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !isLocalHttp) {
    throw new HttpError(400, 'Image URL must use https or localhost');
  }
  return u;
}

async function downloadImageUrl(rawUrl: string): Promise<{ buf: Buffer; mime: string }> {
  let current = checkImageUrl(rawUrl);
  let response: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        response = res;
        break;
      }
      current = checkImageUrl(loc, current);
      continue;
    }
    response = res;
    break;
  }
  if (!response) throw new HttpError(502, 'Too many redirects');
  if (!response.ok) throw new HttpError(502, `Image download failed (${response.status})`);
  const declaredLen = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'Image exceeds 25 MB limit');
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!EXT_BY_MIME[mime]) throw new HttpError(400, `URL did not return a supported image (${mime || 'unknown'})`);
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image exceeds 25 MB limit');
  return { buf, mime };
}

async function saveImageFile(reportId: string, prefix: 'figma' | 'screen', buf: Buffer, mime: string): Promise<string> {
  const cleanMime = mime.split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[cleanMime];
  if (!ext) throw new HttpError(400, `Unsupported image type: ${cleanMime}`);
  const dir = path.join(REPORTS_DIR, reportId);
  const fileName = `${prefix}.${ext}`;
  await writeFile(path.join(dir, fileName), buf);
  for (const oldExt of Object.keys(MIME_BY_EXT)) {
    if (oldExt !== ext) await rm(path.join(dir, `${prefix}.${oldExt}`), { force: true });
  }
  // Imagem nova: a miniatura antiga deixa de valer.
  await rm(path.join(dir, THUMB_NAME), { force: true });
  return fileName;
}

async function readReportMeta(id: string): Promise<ReportMeta | null> {
  try {
    return JSON.parse(await readFile(path.join(REPORTS_DIR, id, 'meta.json'), 'utf8')) as ReportMeta;
  } catch {
    return null;
  }
}

export function reportPrecision(input: Pick<CreateReportInput, 'precision' | 'report'>): number | null {
  const p = input.report?.precision;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

export interface CreateReportInput {
  name?: string;
  project?: string | null;
  url?: string;
  figmaUrl?: string | null;
  figmaImageUrl?: string | null;
  figmaImageData?: string | null;
  screenImageData?: string | null;
  figmaFrame?: Dimensions | null;
  precision?: number | null;
  report?: ValidationReport;
  html?: string;
}

/** Nome de projeto limpo (até 60 caracteres) ou null. */
export function normalizeProject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || null;
}

const THUMB_NAME = 'thumb.jpg';
const THUMB_MAX = 640;

/**
 * Miniatura em JPEG (até 640px) da imagem do Figma, para a lista de relatórios não baixar a imagem inteira (1 MB+).
 * Usa o `sips` do macOS; fora do Mac, ou se falhar, a lista usa a imagem original.
 */
/** Miniaturas sendo geradas agora: pedidos ao mesmo tempo esperam a mesma geração. */
const thumbsInFlight = new Map<string, Promise<string | null>>();

function ensureThumb(reportId: string, source: string): Promise<string | null> {
  const dir = path.join(REPORTS_DIR, reportId);
  const thumb = path.join(dir, THUMB_NAME);
  if (existsSync(thumb)) return Promise.resolve(thumb);
  if (process.platform !== 'darwin') return Promise.resolve(null);
  const pending = thumbsInFlight.get(reportId);
  if (pending) return pending;
  // Gera num arquivo temporário e só renomeia no fim: ninguém lê uma miniatura pela metade.
  const tmp = path.join(dir, `.${THUMB_NAME}.${process.pid}.tmp`);
  const job = new Promise<boolean>((resolve) => {
    execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-Z', String(THUMB_MAX), path.join(dir, source), '--out', tmp], (err) =>
      resolve(!err),
    );
  })
    .then(async (ok) => {
      if (!ok || !existsSync(tmp)) return null;
      await rename(tmp, thumb);
      return thumb;
    })
    .catch(() => null)
    .finally(() => {
      thumbsInFlight.delete(reportId);
      void rm(tmp, { force: true });
    });
  thumbsInFlight.set(reportId, job);
  return job;
}

export async function persistReport(input: CreateReportInput): Promise<{ id: string; warning?: string }> {
  if (!input.report || !Array.isArray(input.report.regions)) {
    throw new HttpError(400, 'Missing report.regions payload');
  }

  const id = createReportId(input.name || 'screen');
  const dir = path.join(REPORTS_DIR, id);
  await mkdir(dir, { recursive: true });

  if (input.html) await writeFile(path.join(dir, 'screen.html'), input.html);
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(input.report));

  let figmaImage: string | null = null;
  let screenImage: string | null = null;
  let warning: string | undefined;

  if (input.figmaImageData) {
    try {
      const { buf, mime } = decodeDataUrl(input.figmaImageData);
      figmaImage = await saveImageFile(id, 'figma', buf, mime);
    } catch (e) {
      warning = `Figma image not saved: ${(e as Error).message}`;
    }
  } else if (input.figmaImageUrl) {
    try {
      const { buf, mime } = await downloadImageUrl(input.figmaImageUrl);
      figmaImage = await saveImageFile(id, 'figma', buf, mime);
    } catch (e) {
      warning = `Figma image not saved: ${(e as Error).message}. Upload it via POST /api/reports/${id}/figma.`;
    }
  }

  if (input.screenImageData) {
    try {
      const { buf, mime } = decodeDataUrl(input.screenImageData);
      screenImage = await saveImageFile(id, 'screen', buf, mime);
    } catch (e) {
      warning = warning ? `${warning}; Screen image not saved: ${(e as Error).message}` : `Screen image not saved: ${(e as Error).message}`;
    }
  }

  const meta: ReportMeta = {
    id,
    name: input.name || 'Screen',
    url: input.url || '',
    figmaUrl: input.figmaUrl ?? null,
    figmaFrame: input.figmaFrame ?? input.report.figmaFrame ?? null,
    figmaImage,
    screenImage,
    precision: reportPrecision(input),
    createdAt: new Date().toISOString(),
    summary: input.report.summary ?? null,
    project: normalizeProject(input.project),
  };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return { id, warning };
}

export async function handleReportRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  origin: string,
): Promise<boolean> {
  if (pathname === '/api/sessions' && method === 'POST') {
    pruneSessions();
    const body = await readBodyJson<{
      name?: string;
      figmaUrl?: string | null;
      figmaFrame?: Dimensions | null;
      figmaImageData?: string | null;
      precision?: number | null;
      spec?: unknown;
    }>(req);
    const id = randomBytes(8).toString('hex');
    sessions.set(id, {
      id,
      name: body.name || 'Localhost Audit',
      figmaUrl: body.figmaUrl ?? null,
      figmaFrame: body.figmaFrame ?? null,
      figmaImageData: body.figmaImageData ?? null,
      precision: typeof body.precision === 'number' ? body.precision : null,
      spec: body.spec ?? null,
      status: 'pending',
      reportId: null,
      createdAt: Date.now(),
    });
    sendResponse(res, 200, { id });
    return true;
  }

  let match = pathname.match(/^\/api\/sessions\/([a-z0-9]+)$/);
  if (match && method === 'GET') {
    pruneSessions();
    const session = sessions.get(match[1]);
    if (!session) throw new HttpError(404, 'Capture session not found or expired');
    sendResponse(res, 200, {
      id: session.id,
      status: session.status,
      reportId: session.reportId,
      name: session.name,
      figmaUrl: session.figmaUrl,
      figmaFrame: session.figmaFrame,
      precision: session.precision,
      spec: session.spec,
    });
    return true;
  }

  match = pathname.match(/^\/api\/sessions\/([a-z0-9]+)\/complete$/);
  if (match && method === 'POST') {
    pruneSessions();
    const session = sessions.get(match[1]);
    if (!session) throw new HttpError(404, 'Capture session not found or expired');
    const body = await readBodyJson<{ url?: string; report?: ValidationReport; html?: string }>(req);
    const { id, warning } = await persistReport({
      name: session.name,
      url: body.url || '',
      figmaUrl: session.figmaUrl,
      figmaImageData: session.figmaImageData,
      figmaFrame: session.figmaFrame,
      precision: session.precision,
      report: body.report,
      html: body.html,
    });
    session.status = 'completed';
    session.reportId = id;
    sendResponse(res, 200, { ok: true, id, url: `${origin}/reports/${id}`, warning });
    return true;
  }

  if (pathname === '/api/reports' && method === 'POST') {
    const body = await readBodyJson<CreateReportInput>(req);
    const { id, warning } = await persistReport(body);
    sendResponse(res, 200, { ok: true, id, url: `${origin}/reports/${id}`, warning });
    return true;
  }

  if (pathname === '/api/reports' && method === 'GET') {
    const list: ReportMeta[] = [];
    if (existsSync(REPORTS_DIR)) {
      const entries = await readdir(REPORTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readReportMeta(entry.name);
        if (meta) list.push(meta);
      }
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendResponse(res, 200, list);
    return true;
  }

  match = pathname.match(/^\/api\/reports\/([a-z0-9-]+)\/(figma|screen)$/);
  if (match && method === 'POST' && isValidId(match[1])) {
    const reportId = match[1];
    const kind = match[2] as 'figma' | 'screen';
    const meta = await readReportMeta(reportId);
    if (!meta) throw new HttpError(404, 'Report not found');

    const contentType = String(req.headers['content-type'] || '');
    let image: { buf: Buffer; mime: string };
    if (contentType.startsWith('application/json')) {
      const body = await readBodyJson<{ url?: string; dataUrl?: string; figmaFrame?: Dimensions }>(req);
      if (body.dataUrl) {
        image = decodeDataUrl(body.dataUrl);
      } else if (body.url) {
        image = await downloadImageUrl(body.url);
      } else {
        throw new HttpError(400, 'Provide { dataUrl } or { url } or raw image binary');
      }
      if (kind === 'figma' && body.figmaFrame) meta.figmaFrame = body.figmaFrame;
    } else {
      image = { buf: await readBodyBuffer(req, MAX_IMAGE_BYTES), mime: contentType };
    }

    const fileName = await saveImageFile(reportId, kind, image.buf, image.mime);
    if (kind === 'figma') meta.figmaImage = fileName;
    else meta.screenImage = fileName;
    await writeFile(path.join(REPORTS_DIR, reportId, 'meta.json'), JSON.stringify(meta, null, 2));
    sendResponse(res, 200, { ok: true, fileName });
    return true;
  }

  match = pathname.match(/^\/api\/reports\/([a-z0-9-]+)$/);
  if (match && isValidId(match[1])) {
    const reportId = match[1];
    if (method === 'GET') {
      const meta = await readReportMeta(reportId);
      const reportPath = path.join(REPORTS_DIR, reportId, 'report.json');
      if (!meta || !existsSync(reportPath)) throw new HttpError(404, 'Report not found');
      let report: ValidationReport;
      try {
        report = JSON.parse(await readFile(reportPath, 'utf8')) as ValidationReport;
      } catch {
        throw new HttpError(404, 'Report not found');
      }
      const hasScreenHtml = existsSync(path.join(REPORTS_DIR, reportId, 'screen.html'));
      sendResponse(res, 200, { meta, report, hasScreenHtml });
      return true;
    }
    if (method === 'DELETE') {
      await rm(path.join(REPORTS_DIR, reportId), { recursive: true, force: true });
      sendResponse(res, 200, { ok: true });
      return true;
    }
  }

  match = pathname.match(/^\/api\/reports\/([a-z0-9-]+)\/thumb$/);
  if (match && method === 'GET' && isValidId(match[1])) {
    const meta = await readReportMeta(match[1]);
    const source = meta?.figmaImage || meta?.screenImage;
    if (!meta || !source) throw new HttpError(404, 'Asset not found');
    const thumb = /\.(png|jpg|webp)$/.test(source) ? await ensureThumb(match[1], source) : null;
    const filePath = thumb ?? path.join(REPORTS_DIR, match[1], source);
    if (!existsSync(filePath)) throw new HttpError(404, 'Asset not found');
    const info = await stat(filePath);
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return true;
    }
    const ext = thumb ? 'jpg' : (source.split('.').pop() ?? 'png');
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'image/png');
    res.end(await readFile(filePath));
    return true;
  }

  match = pathname.match(/^\/api\/reports\/([a-z0-9-]+)\/assets\/(screen\.html|(?:figma|screen)\.(png|jpg|webp|gif|svg))$/);
  if (match && method === 'GET' && isValidId(match[1])) {
    const filePath = path.join(REPORTS_DIR, match[1], match[2]);
    if (!existsSync(filePath)) throw new HttpError(404, 'Asset not found');
    const contentType = match[2] === 'screen.html' ? 'text/html; charset=utf-8' : MIME_BY_EXT[match[3]];
    sendResponse(res, 200, await readFile(filePath), contentType);
    return true;
  }

  return false;
}
