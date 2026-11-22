import type { IncomingMessage, ServerResponse } from 'node:http';

export const MAX_BODY_BYTES = 60 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sanitizeSlug(value: string): string {
  return (
    String(value)
      .toLowerCase()
      .replace(/\.{2,}/g, '-')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

export function getRequestOrigin(req: IncomingMessage): string {
  const host = req.headers.host || 'localhost:5199';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/**
 * Rotas que a skill chama de dentro da tela medida (outra origem: localhost de outro app, UAT): baixar os scripts,
 * mandar o relatório e a captura, ler a sessão (id aleatório) e o estado do benchmark. O resto da API (listar, ler e
 * apagar relatórios, abrir telas no Chrome do app, proxy, Figma) só atende o próprio app: um site qualquer aberto no
 * navegador não pode ler as capturas, apagar nada nem abrir telas com o login do usuário.
 */
const CROSS_ORIGIN_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/(?:validator|capture)\.js$/ },
  { method: 'GET', path: /^\/api\/health$/ },
  { method: 'POST', path: /^\/api\/reports$/ },
  { method: 'GET', path: /^\/api\/sessions\/[a-z0-9]+$/ },
  { method: 'POST', path: /^\/api\/sessions\/[a-z0-9]+\/complete$/ },
  { method: 'GET', path: /^\/api\/benchmark\/state$/ },
  { method: 'POST', path: /^\/api\/benchmark\/(?:capture|result)$/ },
];

export function isCrossOriginRoute(method: string, pathname: string): boolean {
  return CROSS_ORIGIN_ROUTES.some((r) => r.method === method && r.path.test(pathname));
}

/**
 * O pedido vem de outro site (o navegador manda Origin)? Sem Origin (curl, a CLI da skill, o servidor) não é site.
 * O próprio app vale em localhost e 127.0.0.1 na mesma porta.
 */
export function isForeignOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin === 'null') return true;
  try {
    const o = new URL(origin);
    const self = new URL(getRequestOrigin(req));
    const loopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    const sameHost = o.hostname === self.hostname || (loopback(o.hostname) && loopback(self.hostname));
    return !(sameHost && o.port === self.port && o.protocol === self.protocol);
  } catch {
    return true;
  }
}

export function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

export function sendResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
  contentType = 'application/json; charset=utf-8',
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    res.end(data);
    return;
  }
  res.end(JSON.stringify(data));
}

export function readBodyBuffer(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export async function readBodyJson<T = unknown>(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<T> {
  const buf = await readBodyBuffer(req, limit);
  const raw = buf.toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
