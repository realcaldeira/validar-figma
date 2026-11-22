import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { scoreAll } from '../src/benchmark/scoring.ts';
import type { AnswerKey, BenchmarkCapture, BenchmarkState } from '../src/benchmark/types.ts';
import type { ValidationReport } from '../src/engine/types.ts';
import { HttpError, readBodyJson, sanitizeSlug, sendResponse } from './http.ts';

const BENCHMARK_DIR = path.resolve('.benchmark');

const FILES = {
  capture: path.join(BENCHMARK_DIR, 'capture.json'),
  base: path.join(BENCHMARK_DIR, 'base.html'),
  answerKey: path.join(BENCHMARK_DIR, 'answer-key.json'),
  cases: path.join(BENCHMARK_DIR, 'cases'),
  results: path.join(BENCHMARK_DIR, 'results'),
};

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readAllResults(): Promise<Record<string, Record<string, ValidationReport>>> {
  const out: Record<string, Record<string, ValidationReport>> = {};
  if (!existsSync(FILES.results)) return out;
  const agentEntries = await readdir(FILES.results, { withFileTypes: true });
  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) continue;
    const agent = agentEntry.name;
    out[agent] = {};
    const agentDir = path.join(FILES.results, agent);
    const fileEntries = await readdir(agentDir, { withFileTypes: true });
    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue;
      const report = await readJsonFile<ValidationReport>(path.join(agentDir, fileEntry.name));
      if (report) out[agent][fileEntry.name.replace(/\.json$/, '')] = report;
    }
  }
  return out;
}

async function buildState(origin: string): Promise<BenchmarkState> {
  const cap = await readJsonFile<BenchmarkCapture>(FILES.capture);
  const key = await readJsonFile<AnswerKey>(FILES.answerKey);
  const results = await readAllResults();
  const cases = key?.cases.length
    ? [
        { id: 'base', url: `${origin}/benchmark-cases/base.html` },
        ...key.cases.map((c) => ({ id: c.id, url: `${origin}/benchmark-cases/${c.id}.html` })),
      ]
    : [];

  return {
    capture: cap
      ? {
          name: cap.name,
          url: cap.url,
          figmaUrl: cap.figmaUrl,
          viewport: cap.viewport,
          elements: cap.elements,
          capturedAt: cap.capturedAt,
          hasSpec: Boolean(cap.spec),
        }
      : null,
    cases,
    results: Object.fromEntries(Object.entries(results).map(([agent, map]) => [agent, Object.keys(map).sort()])),
  };
}

export async function handleBenchmarkRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  origin: string,
): Promise<boolean> {
  if (pathname === '/api/benchmark/state' && method === 'GET') {
    sendResponse(res, 200, await buildState(origin));
    return true;
  }

  if (pathname === '/api/benchmark/capture' && method === 'POST') {
    const body = await readBodyJson<BenchmarkCapture & { html?: string }>(req);
    if (!body.html) throw new HttpError(400, 'Missing html payload');
    await rm(BENCHMARK_DIR, { recursive: true, force: true });
    await mkdir(FILES.cases, { recursive: true });
    await writeFile(FILES.base, body.html);
    const { html: _html, ...meta } = body;
    await writeFile(FILES.capture, JSON.stringify({ ...meta, capturedAt: new Date().toISOString() }, null, 2));
    sendResponse(res, 200, { ok: true, kb: Math.round(body.html.length / 1024) });
    return true;
  }

  if (pathname === '/api/benchmark/spec' && method === 'GET') {
    const cap = await readJsonFile<BenchmarkCapture>(FILES.capture);
    if (!cap?.spec) throw new HttpError(404, 'Capture has no spec');
    sendResponse(res, 200, cap.spec);
    return true;
  }

  if (pathname === '/api/benchmark/spec' && method === 'POST') {
    const cap = await readJsonFile<BenchmarkCapture>(FILES.capture);
    if (!cap) throw new HttpError(409, 'Capture a screen first');
    cap.spec = await readBodyJson(req);
    await writeFile(FILES.capture, JSON.stringify(cap, null, 2));
    sendResponse(res, 200, { ok: true });
    return true;
  }

  if ((pathname === '/benchmark-base.html' || pathname === '/benchmark-cases/base.html') && method === 'GET') {
    if (!existsSync(FILES.base)) throw new HttpError(404, 'No capture yet');
    sendResponse(res, 200, await readFile(FILES.base), 'text/html; charset=utf-8');
    return true;
  }

  if (pathname === '/api/benchmark/cases' && method === 'POST') {
    const body = await readBodyJson<{ seed?: number; cases?: (AnswerKey['cases'][number] & { html: string })[] }>(req);
    if (!Array.isArray(body.cases)) throw new HttpError(400, 'Missing cases array');
    await rm(FILES.cases, { recursive: true, force: true });
    await rm(FILES.results, { recursive: true, force: true });
    await mkdir(FILES.cases, { recursive: true });
    const seen = new Set<string>(['base']);
    const answerKey: AnswerKey = {
      generatedAt: new Date().toISOString(),
      seed: typeof body.seed === 'number' && Number.isFinite(body.seed) ? body.seed : 0,
      cases: [],
    };
    for (const item of body.cases) {
      if (!item || typeof item.html !== 'string') throw new HttpError(400, 'Missing cases array');
      const baseId = sanitizeSlug(item.id || 'case');
      let id = baseId;
      let n = 2;
      while (seen.has(id)) id = `${baseId}-${n++}`;
      seen.add(id);
      await writeFile(path.join(FILES.cases, `${id}.html`), item.html);
      answerKey.cases.push({ id, control: item.control, mutations: item.mutations });
    }
    await writeFile(FILES.answerKey, JSON.stringify(answerKey, null, 2));
    sendResponse(res, 200, { ok: true, cases: answerKey.cases.length });
    return true;
  }

  const caseMatch = pathname.match(/^\/benchmark-cases\/([a-z0-9._-]+)\.html$/);
  if (caseMatch && method === 'GET') {
    if (caseMatch[1].includes('..')) throw new HttpError(400, 'Invalid target URL');
    const filePath = path.resolve(FILES.cases, `${caseMatch[1]}.html`);
    if (!filePath.startsWith(FILES.cases + path.sep) || !existsSync(filePath)) throw new HttpError(404, 'Case not found');
    sendResponse(res, 200, await readFile(filePath), 'text/html; charset=utf-8');
    return true;
  }

  if (pathname === '/api/benchmark/result' && method === 'POST') {
    const body = await readBodyJson<{ agent?: string; caseId?: string; report?: ValidationReport }>(req);
    if (!body.agent || !body.caseId || !body.report?.regions) {
      throw new HttpError(400, 'Send { agent, caseId, report } with report.regions');
    }
    const dir = path.join(FILES.results, sanitizeSlug(body.agent));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${sanitizeSlug(body.caseId)}.json`), JSON.stringify(body.report));
    sendResponse(res, 200, { ok: true });
    return true;
  }

  const deleteAgentMatch = pathname.match(/^\/api\/benchmark\/results\/([a-z0-9._-]+)$/);
  if (deleteAgentMatch && method === 'DELETE') {
    await rm(path.join(FILES.results, sanitizeSlug(deleteAgentMatch[1])), { recursive: true, force: true });
    sendResponse(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/benchmark/scoreboard' && method === 'GET') {
    sendResponse(res, 200, scoreAll(await readJsonFile<AnswerKey>(FILES.answerKey), await readAllResults()));
    return true;
  }

  if (pathname === '/api/benchmark/reset' && method === 'POST') {
    await rm(BENCHMARK_DIR, { recursive: true, force: true });
    sendResponse(res, 200, { ok: true });
    return true;
  }

  return false;
}
