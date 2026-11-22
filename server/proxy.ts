import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, MAX_BODY_BYTES, sendResponse } from './http.ts';

function isAllowedLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

function injectBaseHref(html: string, targetUrl: string): string {
  if (/<base\b/i.test(html)) return html;
  const escaped = targetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const baseTag = `<base href="${escaped}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${baseTag}`);
  }
  return `${baseTag}\n${html}`;
}

export async function handleProxyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
): Promise<boolean> {
  if (pathname !== '/api/proxy' || method !== 'GET') return false;

  const target = url.searchParams.get('url');
  if (!target) throw new HttpError(400, 'Missing url query parameter');

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new HttpError(400, 'Invalid target URL');
  }

  const validateTarget = (u: URL): void => {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new HttpError(400, 'Only http and https protocols are allowed');
    }
    if (!isAllowedLocalHostname(u.hostname)) {
      throw new HttpError(403, 'Proxy only allows localhost or loopback addresses');
    }
    if (u.pathname.startsWith('/api/proxy')) {
      throw new HttpError(400, 'Recursive proxy request is not allowed');
    }
  };

  validateTarget(parsed);

  const forwardHeaders: Record<string, string> = {};
  if (req.headers.accept) forwardHeaders.accept = String(req.headers.accept);

  let currentUrl = parsed;
  let upstream: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    let resUp: Response;
    try {
      resUp = await fetch(currentUrl.toString(), {
        headers: forwardHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new HttpError(502, `Failed to reach localhost target: ${(err as Error).message}`);
    }
    if (resUp.status >= 300 && resUp.status < 400) {
      const loc = resUp.headers.get('location');
      if (!loc) {
        upstream = resUp;
        break;
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(loc, currentUrl);
      } catch {
        throw new HttpError(400, 'Invalid target URL');
      }
      validateTarget(nextUrl);
      currentUrl = nextUrl;
      continue;
    }
    upstream = resUp;
    break;
  }
  if (!upstream) {
    throw new HttpError(502, 'Too many redirects');
  }

  const declaredLen = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large');
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const rawBuf = Buffer.from(await upstream.arrayBuffer());
  if (rawBuf.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large');
  }

  if (contentType.toLowerCase().includes('text/html')) {
    const html = injectBaseHref(rawBuf.toString('utf8'), currentUrl.toString());
    sendResponse(res, upstream.status, html, contentType);
    return true;
  }

  sendResponse(res, upstream.status, rawBuf, contentType);
  return true;
}
