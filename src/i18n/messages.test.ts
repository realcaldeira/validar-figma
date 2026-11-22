/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localizeMessage, localizeReportMarkdown } from './messages.ts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// Troca interpolações `${...}` por um valor de exemplo para obter a mensagem que o usuário veria.
const sample = (literal: string) => literal.replace(/\$\{[^}]+\}/g, (expr) => (/status|code/i.test(expr) ? '404' : /side/.test(expr) ? 'top' : 'x'));

function literalMessages(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => sample(m[2]));
}

describe('localizeMessage', () => {
  it('mantém o texto em inglês quando o idioma é en', () => {
    expect(localizeMessage('not set on screen', 'en')).toBe('not set on screen');
  });

  it('traduz todas as mensagens de erro do servidor', () => {
    const dir = path.join(root, 'server');
    const msgs = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .flatMap((f) => literalMessages(read(`server/${f}`), /new HttpError\(\d+, (['`])(.+?)\1\)/g));
    expect(msgs.length).toBeGreaterThan(30);
    const missing = msgs.filter((m) => localizeMessage(m, 'pt') === m);
    expect(missing).toEqual([]);
  });

  it('traduz todas as notas e valores do motor', () => {
    const compare = read('src/engine/compare.ts');
    const notes = literalMessages(compare, /note(?:: | = )(['`])(.+?)\1/g);
    const runner = read('src/engine/runner.ts');
    const capture = read('src/engine/capture.ts');
    const errors = [
      ...literalMessages(runner, /error: (['`])(.+?)\1/g),
      ...literalMessages(capture, /new Error\((['`])(.+?)\1\)/g),
    ];
    const msgs = [...notes, ...errors, 'Figma text not on screen (may be sample data)', 'Figma text appears only elsewhere on the screen', 'no element on screen in the place of this Figma box', 'box shows another label on screen (other state or sample data)', 'box shows other content on screen (other state or sample data)', 'box content appears elsewhere on screen (layout moved or other state)', 'on screen but not in the Figma frame', 'possibly not in the Figma frame (loose text, image or card): check by eye', 'on screen but not in the Figma frame (inside a box in another state)', 'absent', 'content ends far from Figma (missing content or another state)', 'present', 'not found', 'none', '— (not collected)', 'top border color mismatch'];
    expect(notes.length).toBeGreaterThan(8);
    const missing = msgs.filter((m) => localizeMessage(m, 'pt') === m);
    expect(missing).toEqual([]);
  });

  it('traduz mensagens compostas do servidor', () => {
    expect(localizeMessage('Figma image not saved: Invalid image URL; Screen image not saved: Image exceeds 25 MB limit', 'pt')).toBe(
      'Imagem do Figma não salva: URL da imagem inválida; Imagem da tela não salva: A imagem passa do limite de 25 MB',
    );
  });

  it('traduz a descrição das mutações', () => {
    expect(localizeMessage('font-size 14px -> 17px in h2.title', 'pt')).toBe('font-size 14px -> 17px em h2.title');
    expect(localizeMessage('text "Review" -> "Revisar" in td', 'pt')).toBe('texto "Review" -> "Revisar" em td');
  });
});

describe('localizeReportMarkdown', () => {
  it('traduz cabeçalhos, resumo e tabela', () => {
    const md = [
      '# Figma vs Screen Validation',
      '- Result: **MISMATCHES FOUND** - 10 pass, 2 fail, 1 warn across 4 regions',
      '## Differences',
      '| Status | Region | Property | Figma | Screen | Delta | Note |',
      '| FAIL | card | minHeight | 500px | none |  | not set on screen (auto) |',
      '## By Region',
      '- [FAIL] **card** - `#card` - 3/5 pass',
    ].join('\n');
    expect(localizeReportMarkdown(md, 'pt').split('\n')).toEqual([
      '# Validação Figma × Tela',
      '- Resultado: **DIFERENÇAS ENCONTRADAS** - 10 ok, 2 falhas, 1 avisos em 4 regiões',
      '## Diferenças',
      '| Status | Região | Propriedade | Figma | Tela | Delta | Nota |',
      '| FALHA | card | minHeight | 500px | nenhum |  | não definido na tela (auto) |',
      '## Por região',
      '- [FALHA] **card** - `#card` - 3/5 ok',
    ]);
  });
});

describe('elemento a mais', () => {
  it('traduz o nome da região', () => {
    expect(localizeMessage('Not in Figma: "All Status"', 'pt')).toBe('A mais na tela: "All Status"');
  });
});
