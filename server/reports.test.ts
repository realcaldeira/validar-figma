import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { isCrossOriginRoute, isForeignOrigin, sanitizeSlug } from './http.ts';
import { createReportId, normalizeProject, reportPrecision } from './reports.ts';
import type { ValidationReport } from '../src/engine/types.ts';

describe('projeto do relatório', () => {
  it('limpa espaços, corta em 60 caracteres e ignora vazio', () => {
    expect(normalizeProject('  Dashboard  ')).toBe('Dashboard');
    expect(normalizeProject('Web   Portal')).toBe('Web Portal');
    expect(normalizeProject('')).toBeNull();
    expect(normalizeProject(undefined)).toBeNull();
    expect(normalizeProject('x'.repeat(80))?.length).toBe(60);
  });
});

describe('segurança de slug e ID do relatório', () => {
  it('bloqueia sequências de traversal em sanitizeSlug', () => {
    expect(sanitizeSlug('..')).toBe('untitled');
    expect(sanitizeSlug('../secret')).toBe('secret');
    expect(sanitizeSlug('.hidden.')).toBe('hidden');
  });

  it('gera IDs de relatório válidos mesmo com pontos e underscores no nome', () => {
    for (const sample of ['tela-checkout.png', 'Checkout v4.2_final', '...', 'Relatório Figma @2x']) {
      const id = createReportId(sample);
      expect(id).toMatch(/^[a-z0-9-]{8,96}$/);
    }
  });
});

describe('segurança cross-origin da API e do Chrome', () => {
  it('libera CORS apenas para bundles, health, POST /api/reports, sessions e callbacks de benchmark', () => {
    expect(isCrossOriginRoute('GET', '/validator.js')).toBe(true);
    expect(isCrossOriginRoute('GET', '/capture.js')).toBe(true);
    expect(isCrossOriginRoute('GET', '/api/health')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/reports')).toBe(true);
    expect(isCrossOriginRoute('GET', '/api/sessions/abc123')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/sessions/abc123/complete')).toBe(true);
    expect(isCrossOriginRoute('GET', '/api/benchmark/state')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/benchmark/capture')).toBe(true);
    expect(isCrossOriginRoute('POST', '/api/benchmark/result')).toBe(true);

    // Rotas que controlam Chrome, token Figma, proxy ou relatórios salvos não aceitam cross-origin
    expect(isCrossOriginRoute('POST', '/api/run')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/run/login')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/figma/frame')).toBe(false);
    expect(isCrossOriginRoute('GET', '/api/proxy')).toBe(false);
    expect(isCrossOriginRoute('GET', '/api/reports')).toBe(false);
    expect(isCrossOriginRoute('DELETE', '/api/reports/abc')).toBe(false);
    expect(isCrossOriginRoute('POST', '/api/benchmark/start')).toBe(false);
  });

  it('identifica requisições cross-origin de navegadores sem bloquear same-origin nem CLI', () => {
    const req = (headers: IncomingMessage['headers']) => ({ headers }) as IncomingMessage;
    // CLI / Node / curl sem headers de origem do navegador
    expect(isForeignOrigin(req({ host: 'localhost:5199' }))).toBe(false);
    // Mesmo app em execução (localhost / 127.0.0.1 na mesma porta)
    expect(isForeignOrigin(req({ host: 'localhost:5199', origin: 'http://localhost:5199', 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isForeignOrigin(req({ host: 'localhost:5199', origin: 'http://127.0.0.1:5199' }))).toBe(false);
    // Site externo tentando chamar o servidor
    expect(isForeignOrigin(req({ host: 'localhost:5199', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).toBe(true);
    // Outro site local (outra porta) tentando controlar o Chrome logado
    expect(isForeignOrigin(req({ host: 'localhost:5199', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' }))).toBe(true);
    // Origem sandboxed null ou tag GET cross-site
    expect(isForeignOrigin(req({ host: 'localhost:5199', origin: 'null' }))).toBe(true);
    expect(isForeignOrigin(req({ host: 'localhost:5199', 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });
});

describe('rigor gravado no relatório', () => {
  const report = (precision?: number) => ({ precision }) as ValidationReport;
  it('usa o que o motor escreveu e ignora o precision mandado por quem envia', () => {
    expect(reportPrecision({ precision: 80, report: report(100) })).toBe(100);
    expect(reportPrecision({ precision: 60, report: report(undefined) })).toBeNull();
    expect(reportPrecision({ precision: 85 })).toBeNull();
  });
});
