import type { Plugin } from 'vite';
import { handleBenchmarkRoutes } from './benchmark.ts';
import { handleFigmaRoutes } from './figma.ts';
import { applyCorsHeaders, getRequestOrigin, HttpError, isCrossOriginRoute, isForeignOrigin, sendResponse } from './http.ts';
import { handleProxyRoutes } from './proxy.ts';
import { handleReportRoutes } from './reports.ts';
import { handleRunRoutes } from './run.ts';
import { shutdownBrowser } from './browser.ts';
import { buildCaptureBundle, buildValidatorBundle } from './scripts.ts';

export function figmaValidatorPlugin(): Plugin {
  return {
    name: 'figma-validator-server',
    configureServer(server) {
      server.httpServer?.once('close', () => void shutdownBrowser());
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://local');
        const pathname = url.pathname;
        const method = req.method || 'GET';

        if (pathname.startsWith('/api/') || pathname === '/validator.js' || pathname === '/capture.js') {
          // Pré-voo (OPTIONS): vale o método que o navegador quer usar.
          const wanted = method === 'OPTIONS' ? String(req.headers['access-control-request-method'] || '').toUpperCase() : method;
          const open = isCrossOriginRoute(wanted, pathname);
          if (open) applyCorsHeaders(res);
          // Outro site chamando uma rota que só o app pode usar: nem executa (um POST simples não passa por pré-voo).
          if (!open && isForeignOrigin(req)) {
            sendResponse(res, 403, { error: 'This route only accepts requests from the Figma Validator app itself' });
            return;
          }
          if (method === 'OPTIONS') {
            sendResponse(res, 204, '');
            return;
          }
        }

        if (pathname === '/api/health' && method === 'GET') {
          sendResponse(res, 200, { ok: true, app: 'figma-validator' });
          return;
        }

        const origin = getRequestOrigin(req);

        try {
          if (pathname === '/validator.js' && method === 'GET') {
            sendResponse(res, 200, await buildValidatorBundle(), 'text/javascript; charset=utf-8');
            return;
          }
          if (pathname === '/capture.js' && method === 'GET') {
            sendResponse(res, 200, await buildCaptureBundle(), 'text/javascript; charset=utf-8');
            return;
          }
          if (await handleProxyRoutes(req, res, pathname, method, url)) return;
          if (await handleFigmaRoutes(req, res, pathname, method)) return;
          if (await handleRunRoutes(req, res, pathname, method)) return;
          if (await handleReportRoutes(req, res, pathname, method, origin)) return;
          if (await handleBenchmarkRoutes(req, res, pathname, method, origin)) return;
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 500;
          sendResponse(res, status, { error: (err as Error).message });
          return;
        }

        next();
      });
    },
  };
}
