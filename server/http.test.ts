import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isCrossOriginRoute, isForeignOrigin } from './http.ts';

const req = (host: string, origin?: string) => ({ headers: { host, ...(origin ? { origin } : {}) } }) as unknown as IncomingMessage;

describe('origem dos pedidos à API', () => {
  it('aceita o próprio app (localhost ou 127.0.0.1 na mesma porta) e pedidos sem Origin (CLI, curl)', () => {
    expect(isForeignOrigin(req('localhost:5199', 'http://localhost:5199'))).toBe(false);
    expect(isForeignOrigin(req('localhost:5199', 'http://127.0.0.1:5199'))).toBe(false);
    expect(isForeignOrigin(req('localhost:5199'))).toBe(false);
  });

  it('trata como outro site outra porta, outro host e Origin "null"', () => {
    expect(isForeignOrigin(req('localhost:5199', 'http://localhost:3010'))).toBe(true);
    expect(isForeignOrigin(req('localhost:5199', 'https://evil.example'))).toBe(true);
    expect(isForeignOrigin(req('localhost:5199', 'null'))).toBe(true);
  });

  it('só libera para outras origens o que a skill usa de dentro da tela medida', () => {
    expect(isCrossOriginRoute('GET', '/validator.js')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/reports')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/benchmark/capture')).toBe(true);
    expect(isCrossOriginRoute('GET', '/api/sessions/abc123')).toBe(true);
    expect(isCrossOriginRoute('GET', '/api/reports')).toBe(false);
    expect(isCrossOriginRoute('DELETE', '/api/reports/20261121-000705-aaaa-x')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/validate/run')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/validate/prepare')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/validate/continue')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/validate/cancel')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/browser/login')).toBe(false);
    expect(isCrossOriginRoute('GET', '/api/proxy')).toBe(false);
  });
});
