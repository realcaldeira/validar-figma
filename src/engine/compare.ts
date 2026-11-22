import type {
  BoxTextSlot,
  CheckResult,
  CheckStatus,
  MeasuredElement,
  RegionExpect,
  RegionReport,
  ReportSummary,
  ToleranceConfig,
} from './types.ts';

/** Rigor padrão: Exato (100%). Só o arredondamento invisível é aceito; 85% e 60% ficam como opção manual. */
export const DEFAULT_PRECISION = 100;

export const DEFAULT_TOLERANCES: ToleranceConfig = {
  size: 1,
  position: 2,
  spacing: 2,
  fontSize: 0.5,
  lineHeight: 1,
  letterSpacing: 0.2,
  radius: 1,
  borderWidth: 0.5,
  color: 2.3,
  alpha: 0.02,
  opacity: 0.02,
  shadow: 1,
};

export function clampPrecision(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_PRECISION;
  return Math.max(0, Math.min(100, Math.round(level)));
}

/**
 * Folga mínima de arredondamento, mesmo no modo Exato (100%): o navegador calcula frações (48,09px) e as cores
 * do Figma viram RGB inteiro. Tudo abaixo disso não aparece na tela; qualquer diferença visível continua falhando.
 */
/** Medidas de espaço que passam por caixa de texto: até 1px de variação da métrica da fonte. */
export const SPACING_TEXT_FLOOR = 1;

export const ROUNDING_FLOOR: ToleranceConfig = {
  size: 0.1,
  position: 0.1,
  spacing: 0.1,
  fontSize: 0.05,
  lineHeight: 0.1,
  letterSpacing: 0.02,
  radius: 0.1,
  borderWidth: 0.05,
  color: 0.5,
  alpha: 0.01,
  opacity: 0.01,
  shadow: 0.1,
};

export function tolerancesFromPrecision(precision: number): ToleranceConfig {
  const clamped = clampPrecision(precision);
  const scale = (100 - clamped) / 15;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const t = (key: keyof ToleranceConfig) => Math.max(ROUNDING_FLOOR[key], r2(DEFAULT_TOLERANCES[key] * scale));
  return {
    size: t('size'),
    position: t('position'),
    spacing: t('spacing'),
    fontSize: t('fontSize'),
    lineHeight: t('lineHeight'),
    letterSpacing: t('letterSpacing'),
    radius: t('radius'),
    borderWidth: t('borderWidth'),
    color: t('color'),
    alpha: Math.min(0.5, t('alpha')),
    opacity: Math.min(0.5, t('opacity')),
    shadow: t('shadow'),
  };
}

export function computeMatchScore(pass: number, fail: number, warn: number): number | null {
  const total = pass + fail + warn;
  if (total <= 0) return null;
  if (fail === 0 && warn === 0) return 100;
  return Math.min(99.9, Math.max(0, Math.round(((pass + warn * 0.5) / total) * 1000) / 10));
}

export const VISIBILITY_THRESHOLDS = {
  colorDeltaE: 3,
  alpha: 0.15,
  fontSize: 1,
  letterSpacing: 0.5,
  borderWidth: 1,
  opacity: 0.1,
  length: 4,
} as const;

export type Visibility = 'visible' | 'css';

const TEXT_LIKE_PROPS = new Set(['fontFamily', 'fontWeight', 'fontStyle', 'text', 'textAlign', 'textTransform', 'textDecorationLine', 'element', 'display', 'flexDirection', 'justifyContent', 'alignItems']);

function firstNumber(v: unknown): number | null {
  const m = String(v ?? '').replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function classifyVisibility(r: Pick<CheckResult, 'property' | 'expected' | 'actual' | 'delta' | 'status'>): Visibility {
  if (r.status !== 'fail') return 'visible';
  const t = VISIBILITY_THRESHOLDS;
  const p = r.property;
  const delta = String(r.delta ?? '');
  const dE = delta.match(/ΔE\s*([\d.]+)/);
  if (dE) {
    const alpha = delta.match(/α\s*([-+]?[\d.]+)/);
    if (alpha && Math.abs(parseFloat(alpha[1])) >= t.alpha) return 'visible';
    return parseFloat(dE[1]) >= t.colorDeltaE ? 'visible' : 'css';
  }
  if (TEXT_LIKE_PROPS.has(p) || p === 'boxShadow') return 'visible';
  const d = firstNumber(delta) ?? (() => {
    const e = firstNumber(r.expected);
    const a = firstNumber(r.actual);
    return e !== null && a !== null ? a - e : null;
  })();
  if (d === null) return 'visible';
  const abs = Math.abs(d);
  if (/^border(Top|Right|Bottom|Left)?Width$/.test(p)) {
    const e = firstNumber(r.expected);
    const a = firstNumber(r.actual);
    if ((e === 0) !== (a === 0)) return 'visible';
    return abs >= t.borderWidth ? 'visible' : 'css';
  }
  if (p === 'fontSize') return abs >= t.fontSize ? 'visible' : 'css';
  if (p === 'letterSpacing') return abs >= t.letterSpacing ? 'visible' : 'css';
  if (p === 'opacity') return abs >= t.opacity ? 'visible' : 'css';
  return abs >= t.length ? 'visible' : 'css';
}

export function headlineScore(s: Pick<ReportSummary, 'pass' | 'fail' | 'warn' | 'score' | 'failCss' | 'scoreVisible'>, cssOnly?: number): number | null {
  if (typeof s.scoreVisible === 'number') return s.scoreVisible;
  const css = s.failCss ?? cssOnly;
  if (typeof css === 'number') return computeMatchScore(s.pass + css, s.fail - css, s.warn);
  return s.score ?? computeMatchScore(s.pass, s.fail, s.warn);
}

export function annotateVisibility(regions: RegionReport[]): void {
  for (const r of regions) for (const x of r.results) if (x.status === 'fail') x.visibility = classifyVisibility(x);
}

export const COLLECTED_STYLES: readonly string[] = [
  'display',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'boxSizing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'backgroundColor',
  'color',
  'fill',
  'stroke',
  'outlineColor',
  'opacity',
  'zIndex',
  'objectFit',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'boxShadow',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecorationLine',
  'whiteSpace',
  'overflow',
  'textOverflow',
  'cursor',
];

function round(n: number, decimals = 2): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function parsePx(value: unknown, fontSize?: number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === '' || s === 'auto' || s === 'normal') return null;
  if (s === '0') return 0;
  const m = s.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|%|em|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || 'px';
  if (unit === 'px') return n;
  if ((unit === '%' || unit === 'em') && fontSize != null) {
    return unit === '%' ? (n / 100) * fontSize : n * fontSize;
  }
  if (unit === 'rem') return n * 16;
  return null;
}

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

function hslToRgb(h: number, sPct: number, lPct: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, sPct / 100));
  const l = Math.max(0, Math.min(1, lPct / 100));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh < 1) [r1, g1, b1] = [c, x, 0];
  else if (hh < 2) [r1, g1, b1] = [x, c, 0];
  else if (hh < 3) [r1, g1, b1] = [0, c, x];
  else if (hh < 4) [r1, g1, b1] = [0, x, c];
  else if (hh < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function parseAngleDeg(token: string): number {
  const m = token.match(/^(-?(?:\d+\.?\d*|\.\d+))(deg|rad|grad|turn)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return NaN;
  const unit = m[2] || 'deg';
  if (unit === 'deg') return n;
  if (unit === 'rad') return (n * 180) / Math.PI;
  if (unit === 'grad') return n * 0.9;
  return n * 360;
}

export function parseColor(value: unknown): [number, number, number, number] | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (NAMED_COLORS[s]) return [...NAMED_COLORS[s]];

  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, round(a, 3)];
  }

  m = s.match(/^rgba?\((.+)\)$/);
  if (m) {
    const parts = m[1].replace(/\s*\/\s*/, ',').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    let a = 1;
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (channels.some(Number.isNaN) || Number.isNaN(a)) return null;
    return [channels[0], channels[1], channels[2], a];
  }

  m = s.match(/^hsla?\((.+)\)$/);
  if (m) {
    const parts = m[1].replace(/\s*\/\s*/, ',').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseAngleDeg(parts[0]);
    const sat = parseFloat(parts[1]);
    const light = parseFloat(parts[2]);
    let a = 1;
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if ([h, sat, light, a].some(Number.isNaN)) return null;
    const [r, g, b] = hslToRgb(h, sat, light);
    return [r, g, b, round(a, 3)];
  }

  m = s.match(/^color\(srgb\s+(.+)\)$/);
  if (m) {
    const parts = m[1].replace(/\s*\/\s*/, ' ').split(/\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p) * 255));
    let a = 1;
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (ch.some(Number.isNaN) || Number.isNaN(a)) return null;
    return [round(ch[0], 2), round(ch[1], 2), round(ch[2], 2), round(a, 3)];
  }

  return null;
}

/** Cor que aparece quando `color` (com transparência) é pintada sobre `background`. */
export function compositeOver(
  color: [number, number, number, number],
  background: [number, number, number, number],
): [number, number, number, number] {
  const a = Math.max(0, Math.min(1, color[3]));
  return [
    Math.round(color[0] * a + background[0] * (1 - a)),
    Math.round(color[1] * a + background[1] * (1 - a)),
    Math.round(color[2] * a + background[2] * (1 - a)),
    1,
  ];
}

export function colorToHex(rgba: [number, number, number, number] | null): string | null {
  if (!rgba) return null;
  const [r, g, b, a] = rgba;
  const hex =
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  return a < 1 ? `${hex} @${round(a, 2)}` : hex;
}

const WEIGHT_NAMES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

export function parseFontWeight(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return WEIGHT_NAMES[s] ?? null;
}

export function primaryFontFamily(value: unknown): string | null {
  if (!value) return null;
  return String(value).split(',')[0].trim().replace(/^["']|["']$/g, '');
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export interface ParsedShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: [number, number, number, number];
  inset: boolean;
}

export function parseShadows(value: unknown): ParsedShadow[] {
  if (!value || String(value).trim() === 'none') return [];
  const out: ParsedShadow[] = [];
  for (const part of splitTopLevel(String(value))) {
    let rest = part.trim();
    const inset = /\binset\b/.test(rest);
    rest = rest.replace(/\binset\b/, '').trim();
    const colorMatch = rest.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}|\b[a-z]+\b)/);
    let color: [number, number, number, number] = [0, 0, 0, 1];
    if (colorMatch) {
      const c = parseColor(colorMatch[1]);
      if (c) {
        color = c;
        rest = rest.replace(colorMatch[1], '').trim();
      }
    }
    const nums = rest
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => parsePx(n) ?? 0);
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    out.push({ x, y, blur, spread, color, inset });
  }
  return out;
}

export function normalizeText(s: unknown): string {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma de comparar textos só para ACHAR o elemento: ignora maiúsculas, tipo de aspas/apóstrofo/travessão e a
 * pontuação final. A checagem de texto (propriedade "text") continua estrita e mostra essas diferenças.
 */
export function normalizeForMatch(s: unknown): string {
  return normalizeText(s)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u0060\u00b4]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[.:;!?]+$/, '')
    .trim();
}

/** Texto sem números: contadores "(32)", "9+", datas e valores viram um marcador só. */
export function withoutNumbers(s: string): string {
  return normalizeForMatch(s)
    .replace(/\(\s*[\d.,]+\+?\s*\)/g, '')
    .replace(/(?:r\$|[$€£])?\s?\d[\d.,/:%-]*[kmb]?\+?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O texto da tela é a mesma cópia do Figma com alguma mudança (e não outro dado)?
 * Aceita quando um é o começo do outro ("Last Update" → "Last Updated", texto cortado) ou quando são muito
 * parecidos (75% ou mais). Nomes de exemplo parecidos ("Release Plan Archive" × "Release Plan 2026") não passam.
 */
export function isSameCopy(screenText: string, figmaText: string): boolean {
  const strip = (s: string) => normalizeForMatch(s).replace(/(\.\.\.|…)$/, '').trim();
  const a = strip(screenText);
  const b = strip(figmaText);
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return textSimilarity(a, b) >= 0.75;
}

/**
 * O texto `needle` aparece em `hay` como palavra ou frase inteira? ("on" não vale dentro de "Monolith", "all" não vale
 * dentro de "Allocation"). Os dois já devem vir normalizados (minúsculas, espaços simples).
 */
export function containsPhrase(hay: string, needle: string): boolean {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : hay[i - 1];
    const after = hay[i + needle.length] ?? '';
    const isWord = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
    const startOk = !before || !isWord(before) || !isWord(needle[0]);
    const endOk = !after || !isWord(after) || !isWord(needle[needle.length - 1]);
    if (startOk && endOk) return true;
    from = i + 1;
  }
}

/**
 * Quantos textos do Figma aparecem dentro do texto de um elemento da tela.
 * Textos só de números (contadores, datas, valores) são dado e não contam. Um texto que mudou só nos números
 * ("12 tasks" × "3 tasks") conta como presente.
 */
export function contentMatch(screenText: string, figmaTexts: string[]): { found: number; total: number } {
  const shown = normalizeForMatch(screenText);
  const shownNoNum = withoutNumbers(screenText);
  let found = 0;
  let total = 0;
  for (const t of figmaTexts) {
    const want = normalizeForMatch(t);
    const wantNoNum = withoutNumbers(t);
    if (!want || !/[a-z\u00c0-\u024f]{2,}/i.test(wantNoNum)) continue;
    total += 1;
    if (containsPhrase(shown, want) || containsPhrase(shownNoNum, wantNoNum)) found += 1;
  }
  return { found, total };
}

/**
 * Quantos textos do Figma têm um texto da tela no mesmo lugar dentro da caixa (posições relativas à caixa).
 * Mesmo componente com dado de exemplo diferente: os textos mudam, os lugares não.
 * Vale o lado do alinhamento (começo, fim ou centro) com folga de 8px e o centro da 1ª linha com folga de 6px.
 * Com 2 textos ou mais, aceita um deslocamento igual para todos (até 24px): um padding errado empurra o conteúdo
 * inteiro, e esse erro precisa aparecer na comparação, não esconder a caixa.
 */
export function slotMatch(
  slots: BoxTextSlot[],
  screen: { left: number; right: number; cy: number }[],
  tolerance = { x: 8, y: 6, shift: 24 },
): { found: number; total: number; dx: number; dy: number } {
  const anchorX = (s: BoxTextSlot, t: { left: number; right: number }) =>
    s.align === 'R' ? t.right - s.right : s.align === 'C' ? (t.left + t.right) / 2 - (s.x + s.right) / 2 : t.left - s.x;
  // Cada texto da tela vale para um texto do Figma só (os pares mais próximos primeiro).
  const count = (dx: number, dy: number) => {
    const pairs: { s: number; t: number; d: number }[] = [];
    slots.forEach((s, si) =>
      screen.forEach((t, ti) => {
        const ex = Math.abs(anchorX(s, t) - dx);
        const ey = Math.abs(t.cy - dy - s.cy);
        if (ex <= tolerance.x && ey <= tolerance.y) pairs.push({ s: si, t: ti, d: ex + ey });
      }),
    );
    pairs.sort((a, b) => a.d - b.d);
    const usedS = new Set<number>();
    const usedT = new Set<number>();
    for (const p of pairs) {
      if (usedS.has(p.s) || usedT.has(p.t)) continue;
      usedS.add(p.s);
      usedT.add(p.t);
    }
    return usedS.size;
  };
  let best = { found: count(0, 0), dx: 0, dy: 0 };
  if (slots.length >= 2) {
    // Cada par (texto do Figma, texto da tela) sugere um deslocamento; fica o que encaixa mais textos.
    for (const s of slots) {
      for (const t of screen) {
        const dx = anchorX(s, t);
        const dy = t.cy - s.cy;
        if (Math.abs(dx) > tolerance.shift || Math.abs(dy) > tolerance.shift) continue;
        const found = count(dx, dy);
        if (found > best.found) best = { found, dx: Math.round(dx), dy: Math.round(dy) };
      }
    }
    // Com deslocamento, um texto só não prova nada.
    if (best.found < 2 && (best.dx || best.dy)) best = { found: count(0, 0), dx: 0, dy: 0 };
  }
  return { found: best.found, total: slots.length, dx: best.dx, dy: best.dy };
}

/** Semelhança entre dois textos (0 a 1), pelo coeficiente de Dice dos pares de letras. */
export function textSimilarity(a: string, b: string): number {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const pairs = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const px = pairs(x);
  const py = pairs(y);
  let common = 0;
  for (const [k, n] of px) common += Math.min(n, py.get(k) ?? 0);
  return (2 * common) / (x.length - 1 + (y.length - 1));
}

function srgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE2000(
  c1: [number, number, number] | [number, number, number, number],
  c2: [number, number, number] | [number, number, number, number],
): number {
  const [L1, a1, b1] = srgbToLab([c1[0], c1[1], c1[2]]);
  const [L2, a2, b2] = srgbToLab([c2[0], c2[1], c2[2]]);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const v = Math.atan2(b, a) / rad;
    return v >= 0 ? v : v + 360;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

function numResult(
  property: string,
  expected: number | null,
  actual: number | null | undefined,
  tol: number,
  unit = 'px',
): CheckResult {
  if (expected === null || !Number.isFinite(expected)) {
    return { property, expected: String(expected ?? '—'), actual: String(actual ?? '—'), status: 'warn', note: 'invalid expected value' };
  }
  if (actual === null || actual === undefined || Number.isNaN(actual)) {
    return { property, expected: `${round(expected)}${unit}`, actual: '—', status: 'warn', note: 'could not measure' };
  }
  const delta = round(actual - expected);
  return {
    property,
    expected: `${round(expected)}${unit}`,
    actual: `${round(actual)}${unit}`,
    delta: `${delta > 0 ? '+' : ''}${delta}${unit}`,
    status: Math.abs(delta) <= tol ? 'pass' : 'fail',
  };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Interseção sobre união de duas caixas (0 = nada em comum, 1 = idênticas). */
export function rectIoU(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Espaço vazio entre duas caixas, em px (0 quando elas se encostam ou se sobrepõem). */
export function boxGap(a: Box, b: Box): number {
  const gx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(gx, gy);
}

/** Distância entre os centros de duas caixas, em px. */
export function centerDistance(a: Box, b: Box): number {
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
}

/**
 * Quanto a tela está deslocada em relação ao Figma (ex.: o Figma inclui o menu do host e a tela local não).
 * Usa a mediana dos pares de textos que aparecem num só lugar; com menos de 3 pares, assume zero.
 */
export function estimateOffset(pairs: { figma: Box; screen: Box }[]): { dx: number; dy: number } {
  if (pairs.length < 3) return { dx: 0, dy: 0 };
  const median = (values: number[]) => {
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };
  // Canto superior esquerdo: um parágrafo da tela costuma ser mais largo que a caixa de texto do Figma.
  return {
    dx: Math.round(median(pairs.map((p) => p.screen.x - p.figma.x))),
    dy: Math.round(median(pairs.map((p) => p.screen.y - p.figma.y))),
  };
}

/** Índice da caixa que melhor cobre o alvo, ou -1 se nenhuma passa do mínimo de sobreposição. */
export function pickBestRect(
  candidates: Box[],
  target: Box,
  minIoU = 0.6,
  maxCornerShift = 24,
  /** Desempate: pontos extras (ex.: o elemento que pinta fundo ou borda ganha de um invólucro transparente). */
  bonus: number[] = [],
): number {
  let best = -1;
  let bestScore = -Infinity;
  candidates.forEach((c, i) => {
    // O canto superior esquerdo precisa bater: evita casar com um contêiner que só engloba a caixa.
    if (Math.abs(c.x - target.x) > maxCornerShift || Math.abs(c.y - target.y) > maxCornerShift) return;
    const iou = rectIoU(c, target);
    if (iou < minIoU) return;
    const score = iou + (bonus[i] ?? 0);
    if (score > bestScore + 1e-9) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Cor do que está atrás de bordas e textos: o fundo do próprio elemento sobre o fundo de trás. */
function surfaceBehind(measured: MeasuredElement): string | null {
  const behind = parseColor(measured.effectiveBackground);
  const own = parseColor(measured.style?.backgroundColor);
  if (!behind) return null;
  const c = own && own[3] > 0 ? compositeOver(own, behind) : behind;
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Como colorResult, mas quando há transparência compara a cor que de fato aparece sobre o fundo de trás. */
function seenColorResult(property: string, exp: unknown, actualRaw: unknown, tol: ToleranceConfig, behindRaw: string | null): CheckResult {
  const r = colorResult(property, exp, actualRaw, tol);
  if (r.status !== 'fail' || !behindRaw) return r;
  const own = parseColor(actualRaw);
  const want = parseColor(exp);
  const behind = parseColor(behindRaw);
  if (!own || !want || !behind || (own[3] >= 1 && want[3] >= 1)) return r;
  const dE = deltaE2000(compositeOver(want, behind), compositeOver(own, behind));
  return {
    ...r,
    delta: `ΔE ${round(dE, 1)}`,
    status: dE <= tol.color ? 'pass' : 'fail',
    note: 'compared as seen over the background behind it',
  };
}

function colorResult(property: string, expectedRaw: unknown, actualRaw: unknown, tol: ToleranceConfig): CheckResult {
  const e = parseColor(expectedRaw);
  const a = parseColor(actualRaw);
  if (!e) return { property, expected: String(expectedRaw), actual: String(actualRaw ?? '—'), status: 'warn', note: 'invalid expected color in spec' };
  if (!a) return { property, expected: colorToHex(e) ?? String(expectedRaw), actual: String(actualRaw ?? '—'), status: 'warn', note: 'unrecognized screen color' };
  if (e[3] === 0 && a[3] === 0) {
    return { property, expected: colorToHex(e) ?? 'transparent', actual: colorToHex(a) ?? 'transparent', status: 'pass' };
  }
  const dE = deltaE2000(e, a);
  const dA = Math.abs(e[3] - a[3]);
  return {
    property,
    expected: colorToHex(e) ?? String(expectedRaw),
    actual: colorToHex(a) ?? String(actualRaw),
    delta: `ΔE ${round(dE, 1)}${dA > 0 ? ` · α ${round(a[3] - e[3], 2)}` : ''}`,
    status: dE <= tol.color && dA <= tol.alpha ? 'pass' : 'fail',
  };
}

function boxValues<T>(v: unknown): (T | undefined)[] | null {
  if (typeof v === 'number' || typeof v === 'string') return [v as T, v as T, v as T, v as T];
  if (Array.isArray(v)) {
    if (v.length === 1) return [v[0], v[0], v[0], v[0]];
    if (v.length === 2) return [v[0], v[1], v[0], v[1]];
    if (v.length === 3) return [v[0], v[1], v[2], v[1]];
    return v.slice(0, 4);
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, T | undefined>;
    return [o.top, o.right, o.bottom, o.left];
  }
  return null;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const;

export function compareRegion(
  expect: RegionExpect,
  measured: MeasuredElement,
  tolerances: Partial<ToleranceConfig> = {},
): CheckResult[] {
  const tol: ToleranceConfig = { ...DEFAULT_TOLERANCES, ...tolerances };
  const results: CheckResult[] = [];
  if (!measured || !measured.found) {
    return [{ property: 'element', expected: 'present', actual: 'not found', status: 'fail' }];
  }
  const st = measured.style || {};
  const measuredFontSize = parsePx(st.fontSize);
  const expectedFontSize = parsePx(expect.fontSize) ?? measuredFontSize;

  for (const [key, exp] of Object.entries(expect)) {
    if (exp === null || exp === undefined) continue;
    switch (key) {
      case 'width':
      case 'height':
        results.push(numResult(key, parsePx(exp), measured.rect?.[key], tol.size));
        break;
      case 'x':
      case 'y': {
        const relKey = key === 'x' ? 'relX' : 'relY';
        results.push(numResult(key, parsePx(exp), measured.rect?.[relKey], tol.position));
        break;
      }
      case 'minWidth':
      case 'maxWidth':
      case 'minHeight':
      case 'maxHeight': {
        const raw = st[key];
        if (raw === 'none' || (raw === 'auto' && key.startsWith('max'))) {
          results.push({ property: key, expected: `${exp}px`, actual: 'none', status: 'fail', note: 'not set on screen' });
          break;
        }
        const actual = raw === 'auto' ? 0 : parsePx(raw);
        const r = numResult(key, parsePx(exp), actual, tol.size);
        if (raw === 'auto') r.note = 'not set on screen (auto)';
        results.push(r);
        break;
      }
      case 'padding':
      case 'margin': {
        const vals = boxValues<number>(exp);
        if (!vals) break;
        vals.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const prop = `${key}${SIDES[i]}`;
          results.push(numResult(prop, parsePx(v), parsePx(st[prop]), tol.spacing));
        });
        break;
      }
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft':
      case 'marginTop':
      case 'marginRight':
      case 'marginBottom':
      case 'marginLeft':
        results.push(numResult(key, parsePx(exp), parsePx(st[key]), tol.spacing));
        break;
      case 'gap': {
        const gapObj = typeof exp === 'object' && exp !== null ? (exp as { row?: number; column?: number }) : null;
        const row = gapObj ? gapObj.row : (exp as number);
        const col = gapObj ? gapObj.column : (exp as number);
        const layout = st.display || '';
        const dir = st.flexDirection || 'row';
        const isFlex = layout.includes('flex');
        if (row !== undefined && (!isFlex || dir.startsWith('column') || Boolean(gapObj))) {
          results.push(numResult('rowGap', parsePx(row), parsePx(st.rowGap) ?? 0, tol.spacing));
        }
        if (col !== undefined && (!isFlex || dir.startsWith('row') || Boolean(gapObj))) {
          results.push(numResult('columnGap', parsePx(col), parsePx(st.columnGap) ?? 0, tol.spacing));
        }
        break;
      }
      case 'borderColor': {
        if (typeof exp === 'object' && exp !== null) {
          const vals = boxValues<string>(exp);
          if (vals) {
            vals.forEach((v, i) => {
              if (!v) return;
              const prop = `border${SIDES[i]}Color`;
              results.push(seenColorResult(prop, v, st[prop], tol, surfaceBehind(measured)));
            });
          }
          break;
        }
        const activeSides = SIDES.filter((side) => (parsePx(st[`border${side}Width`]) ?? 0) > 0);
        const sidesToCheck = activeSides.length ? activeSides : (['Top'] as const);
        const primaryProp = `border${sidesToCheck[0]}Color`;
        const primary = seenColorResult('borderColor', exp, st[primaryProp], tol, surfaceBehind(measured));
        if (primary.status === 'pass' && sidesToCheck.length > 1) {
          for (const side of sidesToCheck.slice(1)) {
            const sideRes = seenColorResult(`border${side}Color`, exp, st[`border${side}Color`], tol, surfaceBehind(measured));
            if (sideRes.status === 'fail') {
              results.push({ ...sideRes, property: 'borderColor', note: `${side.toLowerCase()} border color mismatch` });
              break;
            }
          }
          if (!results.some((r) => r.property === 'borderColor')) results.push(primary);
        } else {
          results.push(primary);
        }
        break;
      }
      case 'borderTopColor':
      case 'borderRightColor':
      case 'borderBottomColor':
      case 'borderLeftColor':
        results.push(seenColorResult(key, exp, st[key], tol, surfaceBehind(measured)));
        break;
      case 'backgroundColor': {
        const r = colorResult(key, exp, st[key], tol);
        const own = parseColor(st[key]);
        if (r.status === 'fail' && own && own[3] === 0 && measured.effectiveBackground) {
          // Fundo transparente: o que aparece é a cor de trás (do elemento pai). Compara essa cor.
          const eff = seenColorResult(key, exp, measured.effectiveBackground, tol, measured.effectiveBackground);
          results.push({ ...eff, note: 'transparent; color shown comes from the element behind it' });
        } else {
          results.push(seenColorResult(key, exp, st[key], tol, measured.effectiveBackground ?? null));
        }
        break;
      }
      case 'color':
        results.push(seenColorResult(key, exp, st[key], tol, surfaceBehind(measured)));
        break;
      case 'outlineColor':
      case 'fill':
      case 'stroke':
        results.push(colorResult(key, exp, st[key], tol));
        break;
      case 'borderWidth': {
        const vals = boxValues<number>(exp);
        if (!vals) break;
        vals.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const prop = `border${SIDES[i]}Width`;
          const want = parsePx(v);
          const r = numResult(prop, want, parsePx(st[prop]), tol.borderWidth);
          // O navegador desenha borda em pixels inteiros do dispositivo: 1,2px do Figma vira 1px em qualquer código.
          const dpr = measured.dpr || 1;
          const drawable = want && want > 0 ? Math.max(1, Math.floor(want * dpr + 0.01)) / dpr : want;
          if (r.status === 'fail' && drawable !== null && drawable !== want && Math.abs((parsePx(st[prop]) ?? -1) - drawable) <= tol.borderWidth) {
            r.status = 'pass';
            r.note = `${round(want ?? 0)}px is drawn as ${round(drawable)}px (browsers draw borders in whole pixels)`;
          }
          results.push(r);
        });
        break;
      }
      case 'contentCenterTop':
      case 'contentCenterBottom':
        break;
      case 'contentInsetRight':
      case 'contentInsetBottom': {
        // Medido na tela, do fim do último conteúdo até a borda (só onde o Figma define onde o conteúdo termina).
        const bottom = key === 'contentInsetBottom';
        const expPx = parsePx(exp);
        let actual = measured.contentInset ? (bottom ? measured.contentInset.bottom : measured.contentInset.right) : null;
        // Embaixo, compara pelo centro da última linha: a entrelinha diferente já é cobrada em lineHeight.
        const centerExp = bottom && typeof expect.contentCenterBottom === 'number' ? expect.contentCenterBottom : null;
        const centerAct = measured.contentInset?.centerBottom;
        if (expPx !== null && centerExp !== null && typeof centerAct === 'number') actual = expPx + (centerAct - centerExp);
        if (actual === null || actual === undefined) break;
        const r = numResult(bottom ? 'paddingBottom' : 'paddingRight', expPx, actual, Math.max(tol.spacing, SPACING_TEXT_FLOOR));
        r.note = 'measured on screen: last content to box edge';
        // Diferença muito grande no fim da caixa é conteúdo faltando ou outro estado, não padding: vira aviso.
        if (r.status === 'fail' && expPx !== null && Math.abs(actual - expPx) > 40) {
          r.status = 'warn';
          r.note = 'content ends far from Figma (missing content or another state)';
        }
        results.push(r);
        break;
      }
      case 'contentInsetTop':
      case 'contentInsetLeft': {
        // Medido na tela, da borda da caixa até o primeiro conteúdo: não depende de como o CSS montou o espaço.
        const side = key === 'contentInsetTop' ? 'top' : 'left';
        const expPx = parsePx(exp);
        let actual = measured.contentInset ? measured.contentInset[side] : null;
        // Em cima, compara pelo centro da primeira linha: a entrelinha diferente já é cobrada em lineHeight.
        const centerExp = typeof expect.contentCenterTop === 'number' ? expect.contentCenterTop : null;
        const centerAct = measured.contentInset?.centerTop;
        if (side === 'top' && expPx !== null && centerExp !== null && typeof centerAct === 'number') actual = expPx + (centerAct - centerExp);
        if (actual === null || actual === undefined) break;
        const r = numResult(key === 'contentInsetTop' ? 'paddingTop' : 'paddingLeft', expPx, actual, Math.max(tol.spacing, SPACING_TEXT_FLOOR));
        r.note = 'measured on screen: box edge to first content';
        results.push(r);
        break;
      }
      case 'borderRadius': {
        const vals = boxValues<number>(exp);
        if (!vals) break;
        vals.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const prop = `border${CORNERS[i]}Radius`;
          // getComputedStyle devolve "50%" quando o raio é em porcentagem: converte pelo menor lado.
          const raw = String(st[prop] ?? '');
          const side = measured.rect ? Math.min(measured.rect.width, measured.rect.height) : null;
          const actualPx = raw.trim().endsWith('%') && side ? (parseFloat(raw) / 100) * side : parsePx(raw);
          const r = numResult(prop, parsePx(v), actualPx, tol.radius);
          // Raio a partir de metade do menor lado já arredonda tudo: 512px e 9999px desenham a mesma pílula.
          const half = measured.rect ? Math.min(measured.rect.width, measured.rect.height) / 2 : null;
          const want = parsePx(v);
          const got = actualPx;
          if (r.status === 'fail' && half && want !== null && got !== null && want >= half - 0.5 && got >= half - 0.5) {
            r.status = 'pass';
            r.note = 'both fully rounded (radius at least half the height)';
          }
          results.push(r);
        });
        break;
      }
      case 'fontFamily': {
        const actual = primaryFontFamily(st.fontFamily);
        const ok = Boolean(actual && actual.toLowerCase() === String(exp).toLowerCase());
        const r: CheckResult = { property: key, expected: String(exp), actual: actual ?? '—', status: ok ? 'pass' : 'fail' };
        if (ok && measured.fontLoaded === false) {
          r.status = 'warn';
          r.note = 'font declared but not loaded (rendering fallback)';
        }
        results.push(r);
        break;
      }
      case 'fontSize':
        results.push(numResult(key, parsePx(exp), measuredFontSize, tol.fontSize));
        break;
      case 'fontWeight': {
        const e = parseFontWeight(exp);
        const a = parseFontWeight(st.fontWeight);
        results.push({ property: key, expected: String(e ?? exp), actual: String(a ?? '—'), status: e === a ? 'pass' : 'fail' });
        break;
      }
      case 'lineHeight': {
        let actual = parsePx(st.lineHeight, measuredFontSize);
        let note: string | undefined;
        if (st.lineHeight === 'normal' && measuredFontSize) {
          actual = measuredFontSize * 1.2;
          note = 'line-height "normal" (~1.2 * fontSize)';
        }
        const expPx = typeof exp === 'string' ? parsePx(exp, expectedFontSize) : (exp as number);
        const r = numResult(key, expPx, actual, tol.lineHeight);
        if (note) r.note = note;
        results.push(r);
        break;
      }
      case 'letterSpacing': {
        const expPx = typeof exp === 'string' ? parsePx(exp, expectedFontSize) : (exp as number);
        const actual = st.letterSpacing === 'normal' ? 0 : parsePx(st.letterSpacing, measuredFontSize);
        results.push(numResult(key, expPx, actual, tol.letterSpacing));
        break;
      }
      case 'textAlign':
      case 'textTransform':
      case 'textDecorationLine':
      case 'fontStyle':
      case 'display':
      case 'flexDirection':
      case 'flexWrap':
      case 'justifyContent':
      case 'alignItems':
      case 'alignSelf':
      case 'whiteSpace':
      case 'overflow':
      case 'textOverflow':
      case 'cursor':
      case 'boxSizing':
      case 'objectFit': {
        const a = String(st[key] ?? '');
        const e = String(exp);
        const norm = (s: string) => s.replace(/^start$/, 'left').replace(/^flex-start$/, 'start').replace(/^flex-end$/, 'end');
        results.push({ property: key, expected: e, actual: a || '—', status: norm(a) === norm(e) ? 'pass' : 'fail' });
        break;
      }
      case 'opacity': {
        const expOpacity =
          typeof exp === 'string' && exp.trim().endsWith('%') ? parseFloat(exp) / 100 : parsePx(exp);
        results.push(numResult(key, expOpacity, parseFloat(st.opacity), tol.opacity, ''));
        break;
      }
      case 'boxShadow': {
        const e = parseShadows(exp);
        const a = parseShadows(st.boxShadow);
        const fmt = (list: ParsedShadow[]) =>
          list.length
            ? list.map((s) => `${s.inset ? 'inset ' : ''}${s.x} ${s.y} ${s.blur} ${s.spread} ${colorToHex(s.color)}`).join(', ')
            : 'none';
        let ok = e.length === a.length;
        if (ok) {
          ok = e.every((s, i) => {
            const t = a[i];
            return (
              s.inset === t.inset &&
              (['x', 'y', 'blur', 'spread'] as const).every((k) => Math.abs((s[k] ?? 0) - (t[k] ?? 0)) <= tol.shadow) &&
              deltaE2000(s.color, t.color) <= tol.color &&
              Math.abs(s.color[3] - t.color[3]) <= tol.alpha * 2
            );
          });
        }
        results.push({ property: key, expected: fmt(e), actual: fmt(a), status: ok ? 'pass' : 'fail' });
        break;
      }
      case 'text': {
        const e = normalizeText(exp);
        const a = normalizeText(measured.text);
        let status: CheckStatus = e === a ? 'pass' : 'fail';
        let note: string | undefined;
        const transform = String(st.textTransform || 'none');
        const shownAs = (t: string) =>
          transform === 'uppercase' ? t.toUpperCase() : transform === 'lowercase' ? t.toLowerCase() : t;
        // innerText já vem com o text-transform aplicado: se a spec pede a mesma transformação, é igual.
        if (status === 'fail' && transform !== 'none' && String(expect.textTransform || 'none') === transform && shownAs(e) === a) {
          status = 'pass';
          note = `same text, shown with text-transform: ${transform}`;
        } else if (status === 'fail' && e.toLowerCase() === a.toLowerCase()) note = 'differs only in letter case';
        else if (status === 'fail' && normalizeForMatch(e) === normalizeForMatch(a)) note = 'differs only in punctuation (quotes, dashes or final period)';
        // Só os números mudam (contadores, datas, valores): é dado de exemplo, não diferença de design.
        if (status === 'fail' && withoutNumbers(e) === withoutNumbers(a) && /\d/.test(e + a)) {
          status = 'warn';
          note = 'only numbers differ (sample data)';
        }
        if (status === 'fail' && measured.truncated && e.startsWith(a.replace(/…$/, ''))) {
          status = 'warn';
          note = 'text truncated on screen';
        }
        const r: CheckResult = { property: key, expected: e, actual: a || '—', status };
        if (note) r.note = note;
        results.push(r);
        break;
      }
      case 'placeholder':
      case 'value': {
        const e = normalizeText(exp);
        const a = normalizeText(measured[key]);
        results.push({ property: key, expected: e, actual: a || '—', status: e === a ? 'pass' : 'fail' });
        break;
      }
      case 'count':
        results.push({
          property: key,
          expected: String(exp),
          actual: String(measured.count ?? 0),
          status: measured.count === exp ? 'pass' : 'fail',
        });
        break;
      case 'visible': {
        const vis = measured.visible !== false;
        results.push({ property: key, expected: String(exp), actual: String(vis), status: vis === exp ? 'pass' : 'fail' });
        break;
      }
      default: {
        const a = st[key];
        results.push({
          property: key,
          expected: String(exp),
          actual: a === undefined ? '— (not collected)' : String(a),
          status: a === undefined ? 'warn' : String(a) === String(exp) ? 'pass' : 'fail',
        });
      }
    }
  }
  return results;
}

export function summarize(regions: RegionReport[]): ReportSummary {
  const all = regions.flatMap((r) => r.results);
  const pass = all.filter((r) => r.status === 'pass').length;
  const fail = all.filter((r) => r.status === 'fail').length;
  const warn = all.filter((r) => r.status === 'warn').length;
  const failCss = all.filter((r) => r.status === 'fail' && (r.visibility ?? classifyVisibility(r)) === 'css').length;
  return {
    regions: regions.length,
    checks: all.length,
    pass,
    fail,
    warn,
    score: computeMatchScore(pass, fail, warn),
    failVisible: fail - failCss,
    failCss,
    scoreVisible: computeMatchScore(pass + failCss, fail - failCss, warn),
  };
}

export interface SpacingItem {
  id: number;
  name: string;
  /** Caixa no Figma (relativa ao frame). */
  fig: Box;
  /** Caixa visual na tela (mesmo sistema de coordenadas, com o deslocamento já embutido). */
  screen: Box;
  /** A borda direita significa algo (caixa ou texto de largura automática). */
  rightIsReal: boolean;
  /** A borda esquerda é o começo do conteúdo (caixa ou texto alinhado à esquerda). */
  leftIsReal: boolean;
  /** O espaço até o vizinho é fixo no Figma nesse eixo (auto-layout alinhado no início, sem espalhar). */
  fixedGap?: { vertical: boolean; horizontal: boolean };
}

export interface SpacingPair {
  a: number;
  b: number;
  axis: 'vertical' | 'horizontal';
  figGap: number;
  screenGap: number;
}

const contains = (outer: Box, inner: Box, slack = 1) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

const overlapLen = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1);

/** Alguma caixa (que não seja de A ou B) ocupa o corredor entre os dois? */
function corridorBlocked(corridor: Box, leaves: Box[], a: Box, b: Box): boolean {
  if (corridor.width <= 0 || corridor.height <= 0) return false;
  return leaves.some((l) => {
    if (contains(a, l) || contains(b, l) || contains(l, a) || contains(l, b)) return false;
    return (
      overlapLen(l.x, l.x + l.width, corridor.x, corridor.x + corridor.width) > 0.5 &&
      overlapLen(l.y, l.y + l.height, corridor.y, corridor.y + corridor.height) > 0.5
    );
  });
}

/**
 * Pares de vizinhos para conferir o espaço entre eles (o "gap" visual), sem olhar o CSS:
 * B logo abaixo de A (ou logo à direita), sem nada entre os dois nem no Figma nem na tela.
 * Pares com algo no meio (dados, outro elemento) ficam de fora: o espaço ali depende do conteúdo.
 */
export function findSpacingPairs(
  items: SpacingItem[],
  figLeaves: Box[],
  screenLeaves: Box[],
  maxGap = 120,
  /** Blocos do Figma (caixas): A e B precisam estar nos mesmos blocos; o espaço entre blocos é medido entre as caixas. */
  groups: Box[] = [],
): SpacingPair[] {
  const pairs: SpacingPair[] = [];
  // Em que blocos cada item está (e qual bloco é ele mesmo), calculado uma vez: comparar dois itens fica barato
  // mesmo com centenas de caixas. A e B estão nos mesmos blocos se todo bloco que contém um contém o outro
  // (o bloco que é o próprio A ou B não conta).
  const isSelf = (g: Box, x: Box) => Math.abs(g.x - x.x) < 0.5 && Math.abs(g.y - x.y) < 0.5 && Math.abs(g.width - x.width) < 0.5 && Math.abs(g.height - x.height) < 0.5;
  const membership = new Map<SpacingItem, { inside: Set<number>; self: Set<number> }>();
  for (const it of items) {
    const inside = new Set<number>();
    const self = new Set<number>();
    groups.forEach((g, i) => {
      if (isSelf(g, it.fig)) self.add(i);
      else if (contains(g, it.fig)) inside.add(i);
    });
    membership.set(it, { inside, self });
  }
  const sameGroups = (A: SpacingItem, B: SpacingItem) => {
    const a = membership.get(A)!;
    const b = membership.get(B)!;
    for (const g of a.inside) if (!b.self.has(g) && !b.inside.has(g)) return false;
    for (const g of b.inside) if (!a.self.has(g) && !a.inside.has(g)) return false;
    return true;
  };
  for (const B of items) {
    for (const axis of ['vertical', 'horizontal'] as const) {
      if (B.fixedGap && !B.fixedGap[axis]) continue;
      let best: { A: SpacingItem; gap: number } | null = null;
      for (const A of items) {
        if (A === B || contains(A.fig, B.fig) || contains(B.fig, A.fig) || !sameGroups(A, B)) continue;
        if (axis === 'horizontal' && (!A.rightIsReal || !B.leftIsReal)) continue;
        const ov =
          axis === 'vertical'
            ? overlapLen(A.fig.x, A.fig.x + A.fig.width, B.fig.x, B.fig.x + B.fig.width)
            : overlapLen(A.fig.y, A.fig.y + A.fig.height, B.fig.y, B.fig.y + B.fig.height);
        if (ov <= 0.5) continue;
        const gap = axis === 'vertical' ? B.fig.y - (A.fig.y + A.fig.height) : B.fig.x - (A.fig.x + A.fig.width);
        if (gap < -0.5 || gap > maxGap) continue;
        if (!best || gap < best.gap) best = { A, gap };
      }
      if (!best) continue;
      const A = best.A;
      const vertical = axis === 'vertical';
      // Na tela, os dois precisam continuar lado a lado no mesmo eixo.
      const ovS = vertical
        ? overlapLen(A.screen.x, A.screen.x + A.screen.width, B.screen.x, B.screen.x + B.screen.width)
        : overlapLen(A.screen.y, A.screen.y + A.screen.height, B.screen.y, B.screen.y + B.screen.height);
      if (ovS <= 0.5) continue;
      const screenGap = vertical ? B.screen.y - (A.screen.y + A.screen.height) : B.screen.x - (A.screen.x + A.screen.width);
      // Na tela a ordem mudou (B ficou antes de A): não são vizinhos, o espaço entre eles não significa nada.
      if (screenGap < -2) continue;
      const corridor = (a: Box, b: Box, g: number): Box =>
        vertical
          ? { x: Math.max(a.x, b.x), y: a.y + a.height, width: overlapLen(a.x, a.x + a.width, b.x, b.x + b.width), height: g }
          : { x: a.x + a.width, y: Math.max(a.y, b.y), width: g, height: overlapLen(a.y, a.y + a.height, b.y, b.y + b.height) };
      if (corridorBlocked(corridor(A.fig, B.fig, best.gap), figLeaves, A.fig, B.fig)) continue;
      if (screenGap > 0 && corridorBlocked(corridor(A.screen, B.screen, screenGap), screenLeaves, A.screen, B.screen)) continue;
      pairs.push({ a: A.id, b: B.id, axis, figGap: best.gap, screenGap });
    }
  }
  return pairs;
}

/** Resultado de um par de vizinhos: espaço no Figma × espaço na tela. */
export function spacingResult(pair: SpacingPair, fromName: string, tol: ToleranceConfig): CheckResult {
  const r = numResult(
    pair.axis === 'vertical' ? 'spaceAbove' : 'spaceLeft',
    pair.figGap,
    pair.screenGap,
    Math.max(tol.spacing, SPACING_TEXT_FLOOR),
  );
  r.note = `space from "${fromName}"`;
  return r;
}

/**
 * Pareia o conteúdo da tela com o do Figma, um para um (sentido tela → Figma). Cada folha da tela traz deslocamentos
 * candidatos (tela → Figma) vindos dos textos e caixas casados perto dela; vale o primeiro que a põe sobre uma folha
 * do Figma do mesmo tipo (texto com texto, ícone/imagem com ícone/imagem) que ainda não tem par. Folhas do Figma já
 * casadas pelo conteúdo vêm como `taken`. É por posição: dado de exemplo diferente no mesmo lugar tem par.
 * Devolve, para cada folha da tela, o índice da folha do Figma que virou par (ou -1).
 */
export function pairLeaves(
  screen: { box: Box; text: boolean; offsets: { dx: number; dy: number }[] }[],
  figma: { box: Box; text: boolean; taken?: boolean }[],
  pad = 16,
): number[] {
  const used = figma.map((f) => Boolean(f.taken));
  return screen.map((s) => {
    for (const o of s.offsets) {
      const x = s.box.x + o.dx;
      const y = s.box.y + o.dy;
      let best = -1;
      let bestD = Infinity;
      figma.forEach((f, i) => {
        if (used[i] || f.text !== s.text) return;
        const b = f.box;
        // Na horizontal basta encostar (texto de exemplo mais curto ou mais longo); na vertical, o centro da linha
        // precisa bater (uma caixa de texto larga logo abaixo não serve de par).
        const dcy = Math.abs(b.y + b.height / 2 - (y + s.box.height / 2));
        if (!(x < b.x + b.width + pad && x + s.box.width > b.x - pad) || dcy > pad) return;
        const d = Math.abs(b.x - x) + dcy;
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      });
      if (best >= 0) {
        used[best] = true;
        return best;
      }
    }
    return -1;
  });
}

/**
 * A folha sem par é só mais uma linha de dado? Mesma estrutura (`sig`) e mesma coluna (x) de uma folha que tem par,
 * em outra altura: é a tabela/lista com mais itens que o exemplo do Figma, não um elemento a mais.
 * Na mesma linha (lado a lado) não vale: um filtro ou botão a mais ao lado dos outros é erro de layout.
 */
export function isRepeatedRow(leaf: { box: Box; sig: string }, withPair: { box: Box; sig: string }[], tol = 4): boolean {
  return withPair.some((p) => p.sig === leaf.sig && Math.abs(p.box.x - leaf.box.x) <= tol && Math.abs(p.box.y - leaf.box.y) > tol);
}

/**
 * Ordena como se lê: em linhas de cima para baixo e, em cada linha, da esquerda para a direita. A linha começa no
 * item mais alto e junta os que estão até `tol` px abaixo dele, então a ordem não depende de comparar pares soltos
 * (0, 3 e 6px dão sempre a mesma ordem). Itens sem posição ficam no fim, na ordem em que vieram.
 */
export function orderByLines<T>(items: T[], pos: (item: T) => { x: number; y: number } | null | undefined, tol = 4): T[] {
  const placed = items.map((item, i) => ({ item, i, p: pos(item) ?? null }));
  const known = placed.filter((e) => e.p).sort((a, b) => a.p!.y - b.p!.y || a.i - b.i);
  const line = new Map<(typeof placed)[number], number>();
  let current = -1;
  let top = -Infinity;
  for (const e of known) {
    if (e.p!.y - top > tol) {
      current += 1;
      top = e.p!.y;
    }
    line.set(e, current);
  }
  known.sort((a, b) => line.get(a)! - line.get(b)! || a.p!.x - b.p!.x || a.i - b.i);
  return [...known, ...placed.filter((e) => !e.p)].map((e) => e.item);
}
