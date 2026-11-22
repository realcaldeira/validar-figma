import type { FigmaSpec, SpecRegion } from '../engine/types.ts';
import type { BenchmarkCase, Mutation, MutationType } from './types.ts';

export interface GenerationOptions {
  cases: number;
  controls: number;
  maxPerCase: number;
  outsideSpec: number;
  seed: number;
}

export type GeneratedCase = BenchmarkCase & { html: string };

export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseRgbColor(css: string): [number, number, number, number] | null {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

export function shiftColor(css: string, transparentFallback = 'rgb(255, 227, 194)'): string {
  const c = parseRgbColor(css);
  if (!c || c[3] < 0.2) return transparentFallback;
  const [r, g, b, a] = c;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const next =
    luminance > 140
      ? [r * 0.55, g * 0.55, b * 0.55]
      : [r + (255 - r) * 0.6, g + (255 - g) * 0.6, b + (255 - b) * 0.6];
  next[0] = Math.min(255, next[0] + 40);
  const [nr, ng, nb] = next.map((v) => Math.round(Math.max(0, Math.min(255, v))));
  return a < 1 ? `rgba(${nr}, ${ng}, ${nb}, ${a})` : `rgb(${nr}, ${ng}, ${nb})`;
}

export function parsePxNumber(v: string | null | undefined, fallback = 0): number {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function extractExpectedProps(expect: Record<string, unknown> = {}): Set<string> {
  const out = new Set<string>();
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const corners = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
  for (const key of Object.keys(expect)) {
    if (key === 'padding' || key === 'margin') sides.forEach((s) => out.add(key + s));
    else if (key === 'gap') ['rowGap', 'columnGap'].forEach((g) => out.add(g));
    else if (key === 'borderRadius') corners.forEach((c) => out.add(`border${c}Radius`));
    else if (key === 'borderWidth') sides.forEach((s) => out.add(`border${s}Width`));
    else out.add(key);
  }
  return out;
}

const MUTATION_TYPES: MutationType[] = [
  'padding',
  'gap',
  'background',
  'color',
  'font-size',
  'font-weight',
  'line-height',
  'border-radius',
  'font-family',
  'letter-spacing',
  'text',
];

const TEXT_MUTATIONS: MutationType[] = [
  'color',
  'font-size',
  'font-weight',
  'line-height',
  'font-family',
  'letter-spacing',
  'text',
];

function directTextNode(el: Element): Text | null {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && /\p{L}{3,}/u.test(node.textContent || '')) return node as Text;
  }
  return null;
}

function elementLabel(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const cls = !id && typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
  const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return `<${el.tagName.toLowerCase()}${id}${cls}>${txt ? ` "${txt}${(el.textContent || '').trim().length > 28 ? '…' : ''}"` : ''}`;
}

function applicableTypes(el: Element, cs: CSSStyleDeclaration): MutationType[] {
  const hasText = Boolean(((el as HTMLElement).innerText ?? el.textContent)?.trim());
  return MUTATION_TYPES.filter((type) => {
    if (type === 'text') return Boolean(directTextNode(el));
    if (type === 'gap') return /flex|grid/.test(cs.display);
    if (TEXT_MUTATIONS.includes(type)) return hasText;
    return true;
  });
}

interface TargetElement {
  el: Element;
  key: string;
  region?: string;
}

export function generateCases(
  doc: Document,
  baseHtml: string,
  spec: Partial<FigmaSpec>,
  options: GenerationOptions,
): GeneratedCase[] {
  const rnd = prng(options.seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const win = doc.defaultView!;

  const measuredRegions: { el: Element; region: SpecRegion; props: Set<string> }[] = [];
  for (const region of spec.regions ?? []) {
    if (region.state) continue;
    let els: Element[] = [];
    try {
      els = Array.from(doc.querySelectorAll(region.selector));
    } catch {
      continue;
    }
    if (region.hasText) {
      els = els.filter((e) => (e.textContent || '').toLowerCase().includes(region.hasText!.toLowerCase()));
    }
    const el = els[region.index ?? 0];
    if (el?.getAttribute('data-k')) {
      measuredRegions.push({ el, region, props: extractExpectedProps(region.expect) });
    }
  }

  const inside: TargetElement[] = measuredRegions.map((m) => ({
    el: m.el,
    key: m.el.getAttribute('data-k')!,
    region: m.region.name,
  }));

  let rootEl: Element = doc.body;
  if (spec.root) {
    try {
      rootEl = doc.querySelector(spec.root) || doc.body;
    } catch {
      rootEl = doc.body;
    }
  }
  const insideKeys = new Set(inside.map((d) => d.key));
  const outside: TargetElement[] = Array.from(rootEl.querySelectorAll('[data-k]'))
    .filter((el) => {
      if (insideKeys.has(el.getAttribute('data-k')!)) return false;
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
      const r = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || cs.display === 'none' || cs.visibility === 'hidden') return false;
      const bg = parseRgbColor(cs.backgroundColor);
      return Boolean(directTextNode(el)) || (bg && bg[3] > 0.2) || parsePxNumber(cs.paddingTop) > 0 || /flex|grid/.test(cs.display);
    })
    .map((el) => ({ el, key: el.getAttribute('data-k')! }));

  if (!inside.length && !outside.length) {
    throw new Error('No elements available to mutate: verify the spec and captured screen.');
  }

  const getAncestors = (el: Element): string[] => {
    const out: string[] = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const k = p.getAttribute('data-k');
      if (k) out.push(k);
    }
    return out;
  };

  const getDescendants = (el: Element): string[] =>
    Array.from(el.querySelectorAll('[data-k]'))
      .slice(0, 3000)
      .map((d) => d.getAttribute('data-k')!);

  function isCovered(
    target: Element,
    props: string[],
    css?: Record<string, string>,
    textChange?: Mutation['text'],
  ): boolean {
    const relevant = measuredRegions.filter(({ props: p }) => props.some((x) => p.has(x)));
    if (!relevant.length) return false;
    const readValues = () =>
      relevant.map(({ el }) => {
        const cs = win.getComputedStyle(el);
        return props
          .map((p) => (p === 'text' ? ((el as HTMLElement).innerText ?? el.textContent ?? '') : (cs as unknown as Record<string, string>)[p]))
          .join('|');
      });
    const before = readValues();
    const htmlEl = target as HTMLElement;
    const originalStyle = htmlEl.getAttribute('style');
    const node = textChange ? directTextNode(target) : null;
    const originalText = node?.textContent ?? null;
    if (css) for (const [p, v] of Object.entries(css)) htmlEl.style.setProperty(p, v, 'important');
    if (node && textChange) node.textContent = (node.textContent || '').replace(textChange.from, textChange.to);
    const after = readValues();
    if (originalStyle === null) htmlEl.removeAttribute('style');
    else htmlEl.setAttribute('style', originalStyle);
    if (node) node.textContent = originalText;
    return before.some((v, i) => v !== after[i]);
  }

  function createMutation(target: TargetElement, id: string): Mutation | null {
    const cs = win.getComputedStyle(target.el);
    const types = applicableTypes(target.el, cs);
    if (!types.length) return null;
    const type = pick(types);
    let css: Record<string, string> | undefined;
    let textChange: Mutation['text'];
    let props: string[];
    let description: string;
    const fs = parsePxNumber(cs.fontSize, 16);

    switch (type) {
      case 'padding': {
        const v = parsePxNumber(cs.paddingTop);
        css = { 'padding-top': `${v + 8}px` };
        props = ['paddingTop'];
        description = `padding-top ${v}px -> ${v + 8}px`;
        break;
      }
      case 'gap': {
        const r = parsePxNumber(cs.rowGap);
        const c = parsePxNumber(cs.columnGap);
        css = { 'row-gap': `${r + 12}px`, 'column-gap': `${c + 12}px` };
        props = ['rowGap', 'columnGap'];
        description = 'gap +12px';
        break;
      }
      case 'background': {
        const next = shiftColor(cs.backgroundColor);
        css = { 'background-color': next };
        props = ['backgroundColor'];
        description = `background ${cs.backgroundColor} -> ${next}`;
        break;
      }
      case 'color': {
        const next = shiftColor(cs.color, 'rgb(200, 30, 30)');
        css = { color: next };
        props = ['color'];
        description = `color ${cs.color} -> ${next}`;
        break;
      }
      case 'font-size':
        css = { 'font-size': `${fs + 3}px` };
        props = ['fontSize', 'lineHeight'];
        description = `font-size ${fs}px -> ${fs + 3}px`;
        break;
      case 'font-weight': {
        const w = parseInt(cs.fontWeight, 10) || 400;
        const next = w >= 600 ? 400 : 700;
        css = { 'font-weight': String(next) };
        props = ['fontWeight'];
        description = `font-weight ${w} -> ${next}`;
        break;
      }
      case 'line-height': {
        const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parsePxNumber(cs.lineHeight, fs * 1.2);
        css = { 'line-height': `${Math.round(lh + 6)}px` };
        props = ['lineHeight'];
        description = `line-height ${Math.round(lh)}px -> ${Math.round(lh + 6)}px`;
        break;
      }
      case 'border-radius': {
        const r = parsePxNumber(cs.borderTopLeftRadius);
        const next = r > 0 ? 0 : 12;
        css = { 'border-radius': `${next}px` };
        props = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
        description = `border-radius ${r}px -> ${next}px`;
        break;
      }
      case 'font-family':
        css = { 'font-family': '"Courier New", monospace' };
        props = ['fontFamily'];
        description = 'font-family -> Courier New';
        break;
      case 'letter-spacing': {
        const ls = cs.letterSpacing === 'normal' ? 0 : parsePxNumber(cs.letterSpacing);
        css = { 'letter-spacing': `${ls + 1.5}px` };
        props = ['letterSpacing'];
        description = `letter-spacing ${ls}px -> ${ls + 1.5}px`;
        break;
      }
      case 'text': {
        const node = directTextNode(target.el);
        const words = (node?.textContent || '').match(/\p{L}{3,}/gu);
        if (!node || !words?.length) return null;
        const from = pick(words);
        const to = from === 'Sample' ? 'Changed' : 'Sample';
        textChange = { from, to };
        props = ['text'];
        description = `text "${from}" -> "${to}"`;
        break;
      }
    }

    return {
      id,
      type,
      key: target.key,
      ancestors: getAncestors(target.el),
      descendants: getDescendants(target.el),
      props,
      insideSpec: isCovered(target.el, props, css, textChange),
      region: target.region,
      description: `${description} in ${elementLabel(target.el)}`,
      css,
      text: textChange,
    };
  }

  function renderCaseHtml(mutations: Mutation[]): string {
    const parsedDoc = new DOMParser().parseFromString(baseHtml, 'text/html');
    for (const m of mutations) {
      const el = parsedDoc.querySelector(`[data-k="${m.key}"]`) as HTMLElement | null;
      if (!el) continue;
      if (m.css) for (const [p, v] of Object.entries(m.css)) el.style.setProperty(p, v, 'important');
      if (m.text) {
        const node = directTextNode(el);
        if (node) node.textContent = (node.textContent || '').replace(m.text.from, m.text.to);
      }
    }
    return '<!doctype html>\n' + parsedDoc.documentElement.outerHTML;
  }

  const totalCases = Math.max(1, options.cases);
  const controlCount = Math.min(totalCases, Math.max(0, options.controls));
  const outsideRatio = Math.min(1, Math.max(0, options.outsideSpec));
  const isControlList = Array.from({ length: totalCases }, (_, i) => i < controlCount);
  for (let i = isControlList.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [isControlList[i], isControlList[j]] = [isControlList[j], isControlList[i]];
  }

  const generated: GeneratedCase[] = [];
  let seq = 0;
  isControlList.forEach((control, i) => {
    const id = `case-${String(i + 1).padStart(2, '0')}`;
    const mutations: Mutation[] = [];
    if (!control) {
      const count = 1 + Math.floor(rnd() * Math.max(1, options.maxPerCase));
      const usedKeys = new Set<string>();
      for (let attempt = 0; mutations.length < count && attempt < count * 10; attempt++) {
        const pool = (rnd() < outsideRatio && outside.length) || !inside.length ? outside : inside;
        const target = pick(pool);
        if (usedKeys.has(target.key) || mutations.some((m) => m.ancestors.includes(target.key) || m.descendants.includes(target.key))) {
          continue;
        }
        const mutation = createMutation(target, `m${++seq}`);
        if (mutation) {
          usedKeys.add(target.key);
          mutations.push(mutation);
        }
      }
    }
    generated.push({ id, control, mutations, html: renderCaseHtml(mutations) });
  });

  return generated;
}
