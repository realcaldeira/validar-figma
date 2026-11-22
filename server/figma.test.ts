import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFigmaSpec } from './figma.ts';

const frame = {
  id: '1:2',
  name: 'Tela',
  type: 'FRAME',
  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
  children: [],
};

/** API do Figma de mentira: devolve a versão atual do arquivo e conta quantas vezes os nodes foram baixados. */
function fakeFigma(versions: string[]) {
  let call = 0;
  const calls = { nodes: 0, meta: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('?depth=1')) {
        calls.meta += 1;
        return new Response(JSON.stringify({ version: versions[Math.min(call++, versions.length - 1)] }), { status: 200 });
      }
      calls.nodes += 1;
      return new Response(JSON.stringify({ nodes: { '1:2': { document: frame } } }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cache do Figma', () => {
  it('reaproveita o frame enquanto o arquivo não muda e baixa de novo quando o designer salva', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = fakeFigma(['v1', 'v1', 'v2']);
    const url = 'https://www.figma.com/design/CACHEKEY123/Arquivo?node-id=1-2';

    await fetchFigmaSpec(url, 'token-teste');
    vi.setSystemTime(Date.now() + 11_000);
    await fetchFigmaSpec(url, 'token-teste');
    expect(calls.nodes).toBe(1);

    vi.setSystemTime(Date.now() + 11_000);
    await fetchFigmaSpec(url, 'token-teste');
    expect(calls.meta).toBe(3);
    expect(calls.nodes).toBe(2);
  });

  it('no limite de chamadas da consulta de versão, usa a última versão vista e não baixa o frame de novo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let limited = false;
    const calls = { nodes: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('?depth=1')) return limited ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ version: 'v1' }), { status: 200 });
        calls.nodes += 1;
        return new Response(JSON.stringify({ nodes: { '1:2': { document: frame } } }), { status: 200 });
      }),
    );
    const url = 'https://www.figma.com/design/LIMITKEY123/Arquivo?node-id=1-2';
    await fetchFigmaSpec(url, 'token-limite');
    limited = true;
    vi.setSystemTime(Date.now() + 11_000);
    await fetchFigmaSpec(url, 'token-limite');
    expect(calls.nodes).toBe(1);
  });

  it('falha imediatamente em 403 ao consultar versão sem disparar nova chamada de nodes', async () => {
    const calls = { meta: 0, nodes: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('?depth=1')) {
          calls.meta += 1;
          return new Response('{}', { status: 403 });
        }
        calls.nodes += 1;
        return new Response(JSON.stringify({ nodes: { '1:2': { document: frame } } }), { status: 200 });
      }),
    );
    const url = 'https://www.figma.com/design/AUTHKEY123/Arquivo?node-id=1-2';
    await expect(fetchFigmaSpec(url, 'token-invalido')).rejects.toMatchObject({ status: 403 });
    expect(calls.meta).toBe(1);
    expect(calls.nodes).toBe(0);
  });
});
