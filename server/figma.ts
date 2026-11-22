import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { convertFigmaNodeToSpec, parseFigmaUrl } from '../src/engine/figmaParser.ts';
import type { FigmaNodeInput, FigmaSpec } from '../src/engine/types.ts';
import { HttpError, readBodyJson, sendResponse } from './http.ts';

interface FigmaFetchRequest {
  figmaUrl?: string;
  token?: string;
  includeContainers?: boolean;
}

interface FigmaNodesApiResponse {
  nodes?: Record<string, { document?: FigmaNodeInput }>;
  err?: string;
}

interface FigmaImagesApiResponse {
  images?: Record<string, string | null>;
  err?: string;
}

// Arquivos grandes (hand-offs com muitas páginas) levam bem mais de 20 s para renderizar o frame.
const FIGMA_API_TIMEOUT_MS = 90_000;
const FIGMA_IMAGE_TIMEOUT_MS = 60_000;

/** Tenta de novo (até 3 vezes) quando a rede falha ou o Figma responde 5xx; erros 4xx não se repetem. */
async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs) });
      if (res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (isTimeout(err) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr;
}

function isTimeout(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function fetchFigmaJson<T>(endpoint: string, token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithRetry(`https://api.figma.com/v1${endpoint}`, {
      headers: { 'X-Figma-Token': token },
      timeoutMs: FIGMA_API_TIMEOUT_MS,
    });
  } catch (err) {
    if (isTimeout(err)) throw new HttpError(504, `Figma API did not respond within ${FIGMA_API_TIMEOUT_MS / 1000} s`);
    throw new HttpError(502, `Failed to connect to Figma API: ${(err as Error).message}`);
  }

  if (response.status === 403) throw new HttpError(403, 'Invalid or unauthorized Figma token');
  if (response.status === 404) throw new HttpError(404, 'Figma file or node not found');
  if (response.status === 429) throw new HttpError(429, 'Figma API rate limit exceeded');

  const data = (await response.json().catch(() => ({}))) as T & { err?: string; message?: string };
  if (!response.ok) {
    throw new HttpError(response.status, data.err || data.message || `Figma API error (${response.status})`);
  }
  return data;
}

async function downloadImageAsDataUrl(imageUrl: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithRetry(imageUrl, { timeoutMs: FIGMA_IMAGE_TIMEOUT_MS });
  } catch (err) {
    if (isTimeout(err)) throw new HttpError(504, `Rendered Figma image did not download within ${FIGMA_IMAGE_TIMEOUT_MS / 1000} s`);
    throw new HttpError(502, `Failed to download rendered Figma image: ${(err as Error).message}`);
  }
  if (!response.ok) throw new HttpError(502, `Failed to download rendered Figma image (${response.status})`);
  const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const buf = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buf.toString('base64')}`;
}

export interface FigmaFrameResult {
  name: string;
  figmaUrl: string;
  fileKey: string;
  nodeId: string;
  figmaFrame: FigmaSpec['figmaFrame'];
  spec: FigmaSpec;
  imageDataUrl: string;
}

// ---------- cache: o mesmo frame costuma ser validado várias vezes seguidas (cada papel, cada ajuste da tela).
// A chave leva a versão do arquivo no Figma, então uma alteração do designer nunca é comparada com o desenho antigo.
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;
  const value = load();
  const entry = { at: Date.now(), ttl, value };
  cache.set(key, entry);
  // Erro não fica guardado: a próxima chamada tenta de novo (sem apagar uma entrada mais nova).
  value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  for (const [k, v] of cache) if (Date.now() - v.at >= v.ttl) cache.delete(k);
  return value;
}

/** Quanto tempo a versão do arquivo vale: só o bastante para a spec e a imagem da mesma validação dividirem a consulta. */
const VERSION_TTL_MS = 10_000;

/**
 * Versão atual do arquivo no Figma (muda a cada alteração salva). Entra na chave do cache: se o designer mexeu no
 * frame, a próxima validação baixa de novo em vez de comparar com o desenho antigo.
 */
async function fileVersion(token: string, fileKey: string): Promise<string> {
  const id = `${tokenKey(token)}:${fileKey}`;
  try {
    const meta = await cached(
      `version:${id}`,
      () => fetchFigmaJson<{ version?: string; lastModified?: string }>(`/files/${fileKey}?depth=1`, token),
      VERSION_TTL_MS,
    );
    const version = meta.version || meta.lastModified || `t${Date.now()}`;
    if (lastVersion.size > 200) lastVersion.clear();
    lastVersion.set(id, version);
    return version;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 404)) throw err;
    // Limite de chamadas: baixar de novo só pioraria o limite. Fica a última versão vista (se houver).
    const known = lastVersion.get(id);
    if (err instanceof HttpError && err.status === 429 && known) return known;
    // Sem a versão não dá para saber se mudou: baixa de novo.
    return `t${Date.now()}`;
  }
}

/** Última versão vista de cada arquivo (por token), para o caso de a consulta da versão bater no limite de chamadas. */
const lastVersion = new Map<string, string>();

/** O token entra na chave (como hash), para um token não ver o cache de outro. */
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

function resolveTarget(figmaUrl: string, tokenInput: string | undefined) {
  const token = (tokenInput || process.env.FIGMA_TOKEN || '').trim();
  if (!token) throw new HttpError(400, 'Missing Figma access token');
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed) throw new HttpError(400, 'Invalid Figma frame URL (must include file key and node-id)');
  return { token, parsed, key: `${tokenKey(token)}:${parsed.fileKey}:${parsed.nodeId}` };
}

export interface FigmaSpecResult {
  name: string;
  figmaUrl: string;
  fileKey: string;
  nodeId: string;
  figmaFrame: FigmaSpec['figmaFrame'];
  spec: FigmaSpec;
}

/** Só a estrutura do frame (rápido): spec automática e tamanho. */
export async function fetchFigmaSpec(figmaUrl: string, tokenInput: string | undefined, includeContainers = false): Promise<FigmaSpecResult> {
  const { token, parsed, key } = resolveTarget(figmaUrl, tokenInput);
  const encodedIds = encodeURIComponent(parsed.nodeId);
  const version = await fileVersion(token, parsed.fileKey);
  const nodesRes = await cached(`nodes:${key}:${version}`, () =>
    fetchFigmaJson<FigmaNodesApiResponse>(`/files/${parsed.fileKey}/nodes?ids=${encodedIds}`, token),
  );
  const nodeEntry = nodesRes.nodes?.[parsed.nodeId] ?? Object.values(nodesRes.nodes ?? {})[0];
  const documentNode = nodeEntry?.document;
  if (!documentNode) throw new HttpError(404, `Node ${parsed.nodeId} not found in Figma response`);
  const spec = convertFigmaNodeToSpec(documentNode, { url: figmaUrl, fileKey: parsed.fileKey, nodeId: parsed.nodeId, includeContainers });
  return { name: spec.name || 'Figma Frame', figmaUrl, fileKey: parsed.fileKey, nodeId: parsed.nodeId, figmaFrame: spec.figmaFrame, spec };
}

/** A imagem renderizada do frame (a parte lenta da API do Figma), já baixada como data URL. */
export async function fetchFigmaImage(figmaUrl: string, tokenInput: string | undefined): Promise<string> {
  const { token, parsed, key } = resolveTarget(figmaUrl, tokenInput);
  const version = await fileVersion(token, parsed.fileKey);
  return cached(`image:${key}:${version}`, async () => {
    const encodedIds = encodeURIComponent(parsed.nodeId);
    const imagesRes = await fetchFigmaJson<FigmaImagesApiResponse>(`/images/${parsed.fileKey}?ids=${encodedIds}&format=png&scale=2`, token);
    const renderedUrl = imagesRes.images?.[parsed.nodeId] ?? Object.values(imagesRes.images ?? {})[0];
    if (!renderedUrl) throw new HttpError(502, 'Figma API did not return a rendered image URL');
    return downloadImageAsDataUrl(renderedUrl);
  });
}

/** Busca o frame na API REST do Figma: imagem renderizada (2x) e spec gerada a partir dos nodes. */
export async function fetchFigmaFrame(figmaUrl: string, tokenInput: string | undefined, includeContainers = false): Promise<FigmaFrameResult> {
  const [spec, imageDataUrl] = await Promise.all([
    fetchFigmaSpec(figmaUrl, tokenInput, includeContainers),
    fetchFigmaImage(figmaUrl, tokenInput),
  ]);
  return { ...spec, imageDataUrl };
}

export async function handleFigmaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> {
  if (pathname !== '/api/figma/fetch' || method !== 'POST') return false;

  const body = await readBodyJson<FigmaFetchRequest>(req);
  if (!body.figmaUrl) throw new HttpError(400, 'Missing figmaUrl');
  sendResponse(res, 200, await fetchFigmaFrame(body.figmaUrl, body.token, Boolean(body.includeContainers)));
  return true;
}
