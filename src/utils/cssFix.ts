import type { CheckResult } from '../engine/types.ts';

// spaceAbove/spaceLeft e o padding medido na tela são distâncias visuais: o código pode chegar nelas com
// padding, margin ou gap, então não viram uma linha de CSS sugerida.
const NON_CSS_PROPS = new Set(['text', 'count', 'visible', 'element', 'x', 'y', 'placeholder', 'value', 'spaceAbove', 'spaceLeft']);

function toKebabCase(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function formatCssValue(prop: string, expected: string): string {
  const alphaColorMatch = expected.match(/^#([0-9a-fA-F]{6})\s*@([\d.]+)$/);
  if (alphaColorMatch) {
    const hex = alphaColorMatch[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alphaColorMatch[2]})`;
  }
  if (prop === 'fontFamily' && /\s/.test(expected) && !expected.startsWith('"') && !expected.startsWith("'")) {
    return `'${expected}', sans-serif`;
  }
  return expected;
}

export function generateCssFix(results: CheckResult[]): string {
  const declarations: string[] = [];
  for (const item of results) {
    if (item.status !== 'fail') continue;
    if (NON_CSS_PROPS.has(item.property)) continue;
    if (item.note?.startsWith('measured on screen')) continue;
    if (!item.expected || item.expected === '—') continue;
    const cssProp = toKebabCase(item.property);
    const cssVal = formatCssValue(item.property, item.expected);
    declarations.push(`${cssProp}: ${cssVal};`);
  }
  return declarations.join('\n');
}
