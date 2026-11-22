import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR = path.join(ROOT_DIR, 'src', 'engine');

interface CachedBundle {
  mtimeKey: string;
  code: string;
}

const cache = new Map<string, CachedBundle>();

function stripModuleSyntax(code: string): string {
  return code
    .replace(/^\s*import\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*\s+as\s+\w+|[\w$]+)\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+\{[\s\S]*?\};?\s*$/gm, '')
    .replace(/^\s*export\s+(?=(?:const|let|var|function|async\s+function|class)\b)/gm, '');
}

async function compileTsFile(filePath: string): Promise<{ code: string; mtimeMs: number }> {
  const [source, info] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
  const result = await transformWithOxc(source, filePath, { lang: 'ts' });
  return { code: stripModuleSyntax(result.code), mtimeMs: info.mtimeMs };
}

export async function buildValidatorBundle(): Promise<string> {
  const comparePath = path.join(ENGINE_DIR, 'compare.ts');
  const runnerPath = path.join(ENGINE_DIR, 'runner.ts');
  const [compareStat, runnerStat] = await Promise.all([stat(comparePath), stat(runnerPath)]);
  const mtimeKey = `${compareStat.mtimeMs}:${runnerStat.mtimeMs}`;
  const cached = cache.get('validator');
  if (cached && cached.mtimeKey === mtimeKey) return cached.code;

  const [compareJs, runnerJs] = await Promise.all([compileTsFile(comparePath), compileTsFile(runnerPath)]);
  const bundle = `(() => {\n'use strict';\n${compareJs.code}\n${runnerJs.code}\n})();\n`;
  cache.set('validator', { mtimeKey, code: bundle });
  return bundle;
}

export async function buildCaptureBundle(): Promise<string> {
  const capturePath = path.join(ENGINE_DIR, 'capture.ts');
  const captureStat = await stat(capturePath);
  const mtimeKey = String(captureStat.mtimeMs);
  const cached = cache.get('capture');
  if (cached && cached.mtimeKey === mtimeKey) return cached.code;

  const captureJs = await compileTsFile(capturePath);
  const bundle = `(() => {\n'use strict';\n${captureJs.code}\n})();\n`;
  cache.set('capture', { mtimeKey, code: bundle });
  return bundle;
}
