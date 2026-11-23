import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openInteractiveTab = vi.fn();
const closeInteractiveTab = vi.fn();
const measureInteractiveTab = vi.fn();
const measureScreen = vi.fn();
const openLoginWindow = vi.fn();
const prewarmBrowser = vi.fn();
const fetchFigmaSpec = vi.fn();
const fetchFigmaImage = vi.fn();
const persistReport = vi.fn();
const buildValidatorBundle = vi.fn();

vi.mock('./browser.ts', () => ({
  openInteractiveTab,
  closeInteractiveTab,
  measureInteractiveTab,
  measureScreen,
  openLoginWindow,
  prewarmBrowser,
}));

vi.mock('./figma.ts', () => ({
  fetchFigmaSpec,
  fetchFigmaImage,
}));

vi.mock('./reports.ts', () => ({
  persistReport,
}));

vi.mock('./scripts.ts', () => ({
  buildValidatorBundle,
}));

const { handleRunRoutes } = await import('./run.ts');

function makeReq(body: unknown): IncomingMessage {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  r.headers = { 'content-type': 'application/json' };
  return r;
}

function makeRes() {
  let statusCode = 200;
  let raw = '';
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    },
    setHeader(name: string, val: string) {
      headers[name.toLowerCase()] = val;
    },
    end(chunk?: string | Buffer) {
      raw = chunk ? String(chunk) : '';
    },
  } as unknown as ServerResponse;
  return {
    res,
    json: () => JSON.parse(raw) as Record<string, unknown>,
    status: () => statusCode,
  };
}

describe('validação rápida interativa (abrir guia antes de medir)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openInteractiveTab.mockResolvedValue({ targetId: 'tab-42' });
    closeInteractiveTab.mockResolvedValue(undefined);
    fetchFigmaSpec.mockResolvedValue({
      name: 'Checkout',
      figmaUrl: 'https://www.figma.com/design/abc/Test?node-id=1-2',
      figmaFrame: { width: 1280, height: 720 },
      spec: { name: 'Checkout', regions: [] },
    });
    fetchFigmaImage.mockResolvedValue('data:image/png;base64,AAAA');
    buildValidatorBundle.mockResolvedValue('window.__figmaValidator = () => ({})');
    measureInteractiveTab.mockResolvedValue({
      timings: { chrome: 5, resize: 10, settle: 20, measure: 30, screenshot: 40 },
      report: {
        summary: { regions: 1, checks: 4, pass: 4, fail: 0, warn: 0, score: 100 },
        regions: [{ name: 'Title', results: [] }],
      },
      screenshotDataUrl: 'data:image/png;base64,BBBB',
      finalUrl: 'http://localhost:3000/checkout',
    });
    persistReport.mockResolvedValue({ id: 'rep-123' });
  });

  it('prepara sessão abrindo guia visível e depois mede exatamente essa guia ao continuar', async () => {
    const prepOut = makeRes();
    const handledPrep = await handleRunRoutes(
      makeReq({
        figmaUrl: 'https://www.figma.com/design/abc/Test?node-id=1-2',
        token: 'figd_test',
        url: 'http://localhost:3000/checkout',
        project: 'Shop',
        includeContainers: true,
      }),
      prepOut.res,
      '/api/validate/prepare',
      'POST',
    );
    expect(handledPrep).toBe(true);
    expect(prepOut.status()).toBe(200);
    const prepJson = prepOut.json();
    expect(typeof prepJson.sessionId).toBe('string');
    expect(prepJson.figmaName).toBe('Checkout');
    expect(prepJson.figmaFrame).toEqual({ width: 1280, height: 720 });
    expect(openInteractiveTab).toHaveBeenCalledWith('http://localhost:3000/checkout');

    const contOut = makeRes();
    const handledCont = await handleRunRoutes(
      makeReq({ sessionId: prepJson.sessionId }),
      contOut.res,
      '/api/validate/continue',
      'POST',
    );
    expect(handledCont).toBe(true);
    expect(contOut.status()).toBe(200);
    expect(contOut.json().id).toBe('rep-123');
    expect(measureInteractiveTab).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'tab-42',
        width: 1280,
        height: 720,
      }),
    );
    expect(persistReport).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Checkout',
        project: 'Shop',
        url: 'http://localhost:3000/checkout',
      }),
    );
  });

  it('fecha a guia aberta se a leitura do Figma falhar durante o prepare', async () => {
    fetchFigmaSpec.mockRejectedValueOnce(new Error('Invalid or unauthorized Figma token'));
    const out = makeRes();
    await expect(
      handleRunRoutes(
        makeReq({
          figmaUrl: 'https://www.figma.com/design/abc/Test?node-id=1-2',
          token: 'bad',
          url: 'http://localhost:3000/checkout',
        }),
        out.res,
        '/api/validate/prepare',
        'POST',
      ),
    ).rejects.toThrow('Invalid or unauthorized Figma token');
    expect(closeInteractiveTab).toHaveBeenCalledWith('tab-42');
  });

  it('cancela sessão pendente fechando a guia e invalidando o sessionId', async () => {
    const prepOut = makeRes();
    await handleRunRoutes(
      makeReq({
        figmaUrl: 'https://www.figma.com/design/abc/Test?node-id=1-2',
        token: 'figd_test',
        url: 'http://localhost:3000/checkout',
      }),
      prepOut.res,
      '/api/validate/prepare',
      'POST',
    );
    const sessionId = String(prepOut.json().sessionId);

    const cancelOut = makeRes();
    await handleRunRoutes(makeReq({ sessionId }), cancelOut.res, '/api/validate/cancel', 'POST');
    expect(cancelOut.status()).toBe(200);
    expect(closeInteractiveTab).toHaveBeenCalledWith('tab-42');

    const contOut = makeRes();
    await expect(
      handleRunRoutes(makeReq({ sessionId }), contOut.res, '/api/validate/continue', 'POST'),
    ).rejects.toThrow('Validation session not found or expired');
  });
});
