import {
  COLLECTED_STYLES,
  annotateVisibility,
  DEFAULT_PRECISION,
  boxGap,
  centerDistance,
  compareRegion,
  compositeOver,
  contentMatch,
  containsPhrase,
  slotMatch,
  estimateOffset,
  findSpacingPairs,
  normalizeForMatch,
  normalizeText,
  spacingResult,
  parseColor,
  withoutNumbers,
  isSameCopy,
  pickBestRect,
  rectIoU,
  pairLeaves,
  isRepeatedRow,
  orderByLines,
  textSimilarity,
  primaryFontFamily,
  summarize,
  tolerancesFromPrecision,
} from './compare.ts';
import type {
  CheckResult,
  FigmaSpec,
  MeasuredElement,
  PendingState,
  Rect,
  RegionReport,
  SpecRegion,
  ToleranceConfig,
  ValidationReport,
} from './types.ts';
import type { SpacingItem } from './compare.ts';

function getDomDepth(el: Element): number {
  let depth = 0;
  let cur: Element | null = el;
  while (cur) {
    depth++;
    cur = cur.parentElement;
  }
  return depth;
}

/** Caixa do elemento em coordenadas da página, relativa à raiz (mesmo sistema do figmaRect). */
function pageRect(el: Element, rootRect: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return { x: r.x + scrollX - rootRect.x, y: r.y + scrollY - rootRect.y, width: r.width, height: r.height };
}

const classOf = (el: Element): string => el.getAttribute('class') ?? '';

/** Cor de fundo efetiva atrás do elemento (composita camadas semitransparentes até atingir opacidade ou branco). */
function effectiveBackground(el: Element): string {
  const layers: [number, number, number, number][] = [];
  let cur: Element | null = el.parentElement;
  let base: [number, number, number, number] = [255, 255, 255, 1];
  while (cur) {
    const parsed = parseColor(getComputedStyle(cur).backgroundColor);
    if (parsed && parsed[3] > 0) {
      if (parsed[3] >= 0.999) {
        base = [parsed[0], parsed[1], parsed[2], 1];
        break;
      }
      layers.push(parsed);
    }
    cur = cur.parentElement;
  }
  let acc = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    acc = compositeOver(layers[i], acc);
  }
  return `rgb(${acc[0]}, ${acc[1]}, ${acc[2]})`;
}

type Offset = { dx: number; dy: number };
type PageBox = { x: number; y: number; width: number; height: number };

/** Distância máxima (px) entre o lugar esperado e o texto achado, nas regras automáticas. */
const MAX_TEXT_DISTANCE = 200;

function shift(rect: PageBox, offset: Offset): PageBox {
  return { ...rect, x: rect.x + offset.dx, y: rect.y + offset.dy };
}

function isVisible(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'html' || tag === 'body') return false;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
}

/** Texto que a pessoa vê no elemento: campos mostram o valor ou, vazios, o placeholder. */
function elementText(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value || el.placeholder || '';
  return (el as HTMLElement).innerText ?? el.textContent ?? '';
}

/** Região da spec automática: casa pelo texto exato + posição do Figma. */
function isAutoTextRegion(region: SpecRegion): boolean {
  return Boolean(region.hasText && region.textMatch === 'exact' && region.selector === '*');
}

interface TextEntry {
  el: Element;
  text: string;
  box: PageBox;
}

/** Índice dos textos visíveis da tela, só os elementos mais internos de cada texto (um por lugar). */
function buildTextIndex(rootRect: { x: number; y: number }): TextEntry[] {
  const entries: TextEntry[] = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!isVisible(el)) continue;
    const text = normalizeForMatch(elementText(el));
    if (!text || text.length > 400) continue;
    entries.push({ el, text, box: pageRect(el, rootRect) });
  }
  const byEl = new Map(entries.map((e) => [e.el, e]));
  return entries.filter((e) => !Array.from(e.el.querySelectorAll('*')).some((child) => byEl.get(child)?.text === e.text));
}

/** Elementos visíveis com o texto da região (specs escritas à mão); no modo "deepest", só os mais internos. */
function textCandidates(region: SpecRegion, list: Element[]): Element[] {
  const needle = normalizeText(region.hasText).toLowerCase();
  const matches = list.filter((el) => {
    const txt = normalizeText(elementText(el)).toLowerCase();
    return region.textMatch === 'exact' ? txt === needle : txt.includes(needle);
  });
  const useDeepest = region.matchMode === 'deepest' || (region.selector === '*' && Boolean(region.hasText));
  if (!useDeepest) return matches;
  const visible = matches.filter(isVisible);
  return visible.filter((el) => !visible.some((other) => other !== el && el.contains(other)));
}

/** Deslocamento da tela em relação ao Figma, a partir dos textos que aparecem num só lugar. */
function estimateLayoutOffset(spec: FigmaSpec, index: TextEntry[]): Offset {
  const pairs: { figma: PageBox; screen: PageBox }[] = [];
  for (const region of spec.regions || []) {
    if (!isAutoTextRegion(region) || !region.figmaRect) continue;
    const needle = normalizeForMatch(region.hasText);
    const hits = index.filter((e) => e.text === needle);
    if (hits.length === 1) pairs.push({ figma: region.figmaRect, screen: hits[0].box });
  }
  return estimateOffset(pairs);
}

/** Distância (px) até onde ainda vale "o mesmo lugar" para aceitar um texto parecido. */
const SAME_PLACE_GAP = 16;

/** Escolha do elemento para uma região da spec automática. */
function pickAutoText(region: SpecRegion, target: PageBox | null, index: TextEntry[]): { el: Element | null; elsewhere: boolean } {
  const needle = normalizeForMatch(region.hasText);
  const exact = index.filter((e) => e.text === needle);
  if (!target) return { el: exact[0]?.el ?? null, elsewhere: false };
  const byPlace = (a: TextEntry, b: TextEntry) =>
    Math.round(boxGap(a.box, target) / 24) - Math.round(boxGap(b.box, target) / 24) ||
    centerDistance(a.box, target) - centerDistance(b.box, target);
  exact.sort(byPlace);
  if (exact.length && boxGap(exact[0].box, target) <= MAX_TEXT_DISTANCE) return { el: exact[0].el, elsewhere: false };
  // Sem o texto exato por perto: um texto parecido no mesmo lugar é o mesmo elemento com a cópia diferente.
  let best: TextEntry | null = null;
  let bestScore = -1;
  // Palavras curtas parecidas ("Male" × "Female") costumam ser dado de exemplo: não entram nessa regra.
  if (needle.length < 8) return { el: null, elsewhere: exact.length > 0 };
  for (const e of index) {
    if (boxGap(e.box, target) > SAME_PLACE_GAP || e.text.length < 8) continue;
    if (!isSameCopy(e.text, needle)) continue;
    const score = textSimilarity(e.text, needle);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  if (best) return { el: best.el, elsewhere: false };
  return { el: null, elsewhere: exact.length > 0 };
}

/** Altura da linha em px ("normal" fica null: aí a caixa do texto já é a da linha). */
function lineHeightPx(el: Element): number | null {
  const cs = getComputedStyle(el);
  const v = parseFloat(cs.lineHeight);
  return Number.isFinite(v) ? v : null;
}

function toPage(r: { left: number; top: number; width: number; height: number }, rootRect: { x: number; y: number }): PageBox {
  return { x: r.left + scrollX - rootRect.x, y: r.top + scrollY - rootRect.y, width: r.width, height: r.height };
}

/**
 * Caixa das linhas de um texto com meia entrelinha em cima e embaixo: é a caixa que o Figma desenha para um texto.
 * Campos (input) mostram o texto centralizado na altura, depois do padding.
 */
function textLineBox(target: Node, styleEl: Element, rootRect: { x: number; y: number }): PageBox | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const r = target.getBoundingClientRect();
    const cs = getComputedStyle(target);
    const lh = lineHeightPx(target) ?? parseFloat(cs.fontSize) * 1.2;
    const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
    const top = target instanceof HTMLTextAreaElement ? r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) : r.top + (r.height - lh) / 2;
    return toPage({ left: r.left + padL, top, width: Math.max(0, r.width - padL - padR), height: lh }, rootRect);
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const lh = lineHeightPx(styleEl);
  const half = lh ? (lh - rects[0].height) / 2 : 0;
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top)) - half;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + half;
  return toPage({ left, top, width: right - left, height: bottom - top }, rootRect);
}

const REPLACED = 'img, svg, canvas, video, input, textarea, select, [role="img"]';

/** Centro vertical da primeira linha de um texto (não depende da entrelinha). */
function firstLineCenter(target: Node, rootRect: { x: number; y: number }): number | null {
  const range = document.createRange();
  range.selectNodeContents(target);
  const first = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
  return first ? first.top + first.height / 2 + scrollY - rootRect.y : null;
}

/** Centro vertical da última linha de um texto (a mais de baixo). */
function lastLineCenter(target: Node, rootRect: { x: number; y: number }): number | null {
  const range = document.createRange();
  range.selectNodeContents(target);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const last = rects.reduce((a, b) => (b.bottom > a.bottom ? b : a));
  return last.top + last.height / 2 + scrollY - rootRect.y;
}

/**
 * Caixa de um texto da spec com a entrelinha do Figma, em volta dos centros das linhas na tela.
 * Assim o espaço entre vizinhos não muda só porque a entrelinha é outra (isso já é cobrado em lineHeight).
 */
function textBoxWithFigmaLineHeight(el: Element, figmaLineHeight: number, rootRect: { x: number; y: number }): PageBox | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const centers = rects.map((r) => r.top + r.height / 2);
  const top = Math.min(...centers) - figmaLineHeight / 2;
  const bottom = Math.max(...centers) + figmaLineHeight / 2;
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  return toPage({ left, top, width: right - left, height: bottom - top }, rootRect);
}

/** Primeiro conteúdo dentro da caixa (textos, ícones, imagens, campos): distância das bordas de cima e da esquerda. */
function measureContentInset(
  el: Element,
  rootRect: { x: number; y: number },
): { top: number | null; left: number | null; centerTop: number | null; right: number | null; bottom: number | null; centerBottom: number | null } | null {
  const box = pageRect(el, rootRect);
  const leaves: { b: PageBox; start: boolean; text: boolean; centerY: number; centerYLast?: number }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!n.textContent?.trim() || !parent || !isVisible(parent) || parent.closest('svg')) continue;
    const b = textLineBox(n, parent, rootRect);
    if (!b) continue;
    const pcs = getComputedStyle(parent);
    const align = pcs.textAlign;
    // Centralizado só desloca o texto se sobra espaço na linha; num elemento do tamanho do texto, começa na borda.
    const pr = parent.getBoundingClientRect();
    const room = pr.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight) - b.width;
    const start = align === 'start' || align === 'left' || align === 'justify' || room <= 2;
    leaves.push({ b, text: true, start, centerY: firstLineCenter(n, rootRect) ?? b.y + b.height / 2, centerYLast: lastLineCenter(n, rootRect) ?? undefined });
  }
  for (const r of Array.from(el.querySelectorAll(REPLACED))) {
    if (!isVisible(r) || (r.tagName.toLowerCase() !== 'svg' && r.closest('svg'))) continue;
    const isField = r instanceof HTMLInputElement || r instanceof HTMLTextAreaElement;
    const b = isField ? textLineBox(r, r, rootRect) : pageRect(r, rootRect);
    if (b) leaves.push({ b, text: isField, start: true, centerY: b.y + b.height / 2 });
  }
  // Ícone desenhado por fonte (<i class="…icon…">, até 48px, sem texto): também é conteúdo.
  for (const ic of Array.from(el.querySelectorAll('i, [class*="icon" i]'))) {
    if (ic.matches(REPLACED) || ic.closest('svg') || ic.querySelector(REPLACED) || (ic.textContent ?? '').trim().length > 2 || !isVisible(ic)) continue;
    const b = pageRect(ic, rootRect);
    if (b.width >= 8 && b.height >= 8 && b.width <= 48 && b.height <= 48) leaves.push({ b, text: false, start: true, centerY: b.y + b.height / 2 });
  }
  // Imagem desenhada como fundo (capa de vídeo, banner): também é conteúdo.
  // Ícone dentro de um quadrado ou círculo pintado (até 48px, sem texto): o Figma mede até o quadrado, não até o desenho.
  for (const d of Array.from(el.querySelectorAll('*'))) {
    if (d.matches(REPLACED) || d.closest('svg')) continue;
    const dcs = getComputedStyle(d);
    const fill = parseColor(dcs.backgroundColor);
    if (fill && fill[3] > 0 && !(d.textContent ?? '').trim() && d.querySelector(REPLACED + ', i') && isVisible(d)) {
      const b = pageRect(d, rootRect);
      if (b.width >= 12 && b.height >= 12 && b.width <= 48 && b.height <= 48) leaves.push({ b, text: false, start: true, centerY: b.y + b.height / 2 });
    }
    const bg = dcs.backgroundImage;
    if (!bg || bg === 'none' || !/url\(/.test(bg) || !isVisible(d)) continue;
    const b = pageRect(d, rootRect);
    if (b.width >= 16 && b.height >= 16) leaves.push({ b, text: false, start: true, centerY: b.y + b.height / 2 });
  }
  const inside = leaves.filter(
    ({ b, text }) =>
      b.x + b.width > box.x &&
      b.x < box.x + box.width &&
      b.y + b.height > box.y &&
      b.y < box.y + box.height &&
      (text || !(b.width <= 2 || b.height <= 2 || (b.height >= box.height * 0.9 && b.width >= box.width * 0.9))),
  );
  if (!inside.length) return null;
  const starts = inside.filter((l) => l.start);
  const lastCenter = (l: (typeof inside)[number]) => l.centerYLast ?? l.b.y + l.b.height / 2;
  return {
    top: Math.min(...inside.map((l) => l.b.y)) - box.y,
    left: starts.length ? Math.min(...starts.map((l) => l.b.x)) - box.x : null,
    centerTop: Math.min(...inside.map((l) => l.centerY)) - box.y,
    right: box.x + box.width - Math.max(...inside.map((l) => l.b.x + l.b.width)),
    bottom: box.y + box.height - Math.max(...inside.map((l) => l.b.y + l.b.height)),
    centerBottom: box.y + box.height - Math.max(...inside.map(lastCenter)),
  };
}

/** Elementos da tela já casados com uma caixa do Figma nesta medição. */
let claimedBoxes = new Map<Element, Rect>();

/** O elemento desenha alguma coisa (fundo, borda, sombra, imagem)? */
function paintOf(el: Element): { paints: boolean; hasBorder: boolean; rounded: boolean } {
  const cs = getComputedStyle(el);
  const bg = parseColor(cs.backgroundColor);
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(
    (s) => parseFloat((cs as unknown as Record<string, string>)[`border${s}Width`]) > 0 && (cs as unknown as Record<string, string>)[`border${s}Style`] !== 'none',
  );
  const paints = Boolean((bg && bg[3] > 0) || hasBorder || (cs.boxShadow && cs.boxShadow !== 'none') || el.tagName === 'IMG');
  return { paints, hasBorder, rounded: parseFloat(cs.borderTopLeftRadius) > 0 };
}

/** Textos dentro do elemento, com começo, fim e centro da 1ª linha relativos à caixa dele. */
function screenTextSlots(
  el: Element,
  rootRect: { x: number; y: number },
  /** Só interessam textos até esta altura dentro da caixa (o último texto do Figma mais a folga de deslocamento). */
  maxCy = Infinity,
): { left: number; right: number; cy: number }[] {
  const box = pageRect(el, rootRect);
  const out: { left: number; right: number; cy: number }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && out.length < 200; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!n.textContent?.trim() || !parent || !isVisible(parent) || parent.closest('svg')) continue;
    // Tabela ou painel grande: o que está abaixo dos textos do Figma não entra (e não esgota o limite).
    if (pageRect(parent, rootRect).y - box.y > maxCy) continue;
    const b = textLineBox(n, parent, rootRect);
    if (!b) continue;
    const cy = firstLineCenter(n, rootRect) ?? b.y + b.height / 2;
    out.push({ left: b.x - box.x, right: b.x + b.width - box.x, cy: cy - box.y });
  }
  for (const f of Array.from(el.querySelectorAll('input, textarea'))) {
    if (!isVisible(f)) continue;
    const b = textLineBox(f, f, rootRect);
    if (b) out.push({ left: b.x - box.x, right: b.x + b.width - box.x, cy: b.y + b.height / 2 - box.y });
  }
  return out;
}

/** O que conta como controle: o elemento a mais que dá para afirmar sem confundir com dado de exemplo. */
const CONTROL =
  'button, a[href], select, summary, label, [role="button"], [role="tab"], [role="combobox"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"]';

/** Estrutura de um elemento (tags dos 4 ancestros): linhas de uma mesma tabela ou lista têm a mesma. */
function structureSig(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) parts.push(cur.tagName);
  return parts.join('<');
}

type Anchor = { fig: PageBox; screen: PageBox };

/**
 * Deslocamentos candidatos (tela → Figma) para um ponto da tela: a menor caixa casada que o contém (com a borda
 * direita valendo para o que está na metade direita de caixa fluida) e os 3 textos casados mais perto.
 */
function offsetsAround(box: PageBox, boxAnchors: Anchor[], textAnchors: Anchor[], fallback: Offset): Offset[] {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const out: Offset[] = [];
  let inside: Anchor | null = null;
  for (const a of boxAnchors) {
    const s = a.screen;
    if (cx < s.x || cx > s.x + s.width || cy < s.y || cy > s.y + s.height) continue;
    if (!inside || s.width * s.height < inside.screen.width * inside.screen.height) inside = a;
  }
  if (inside) {
    const right = cx > inside.screen.x + inside.screen.width / 2;
    const dx = right ? inside.fig.x + inside.fig.width - (inside.screen.x + inside.screen.width) : inside.fig.x - inside.screen.x;
    out.push({ dx, dy: inside.fig.y - inside.screen.y });
  }
  const near = textAnchors
    .map((a) => ({ a, d: Math.hypot(a.screen.x - box.x, a.screen.y - box.y) }))
    .filter((n) => n.d <= 400)
    .sort((p, q) => p.d - q.d)
    .slice(0, 3);
  for (const n of near) out.push({ dx: n.a.fig.x - n.a.screen.x, dy: n.a.fig.y - n.a.screen.y });
  // O deslocamento da tela inteira só vale onde não há nada casado por perto (ele erra em blocos rearrumados).
  if (!out.length) out.push({ dx: -fallback.dx, dy: -fallback.dy });
  return out;
}

/**
 * Elementos na tela que não existem no Figma (um filtro, um botão, um badge a mais).
 * - par por posição e por tipo, um para um (dado de exemplo diferente no mesmo lugar tem par);
 * - linha a mais de tabela/lista (mesma coluna, mesma estrutura) é dado, não erro;
 * - numa linha de itens lado a lado, só sobra elemento se a tela tem mais itens que o Figma naquela linha
 *   (texto de exemplo mais comprido empurra os vizinhos, mas não cria item);
 * - dentro de uma caixa que está em outro estado, vira aviso.
 */
function findExtraElements(
  spec: FigmaSpec,
  rootRect: { x: number; y: number },
  textIndex: TextEntry[],
  matchedTexts: { fig: PageBox; el: Element; screen: PageBox }[],
  movedTexts: PageBox[],
  matchedEls: Element[],
  boxAnchors: Anchor[],
  otherStateAreas: PageBox[],
  layoutOffset: Offset,
  rootEl: Element | null,
): RegionReport[] {
  const frame = spec.figmaFrame!;
  // Onde o frame do Figma está na tela: pela mediana do deslocamento dos textos casados (um frame que é só um painel
  // fica no meio da página; o que está fora dele, como o breadcrumb da página, não é "a mais").
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  const fx = matchedTexts.length ? median(matchedTexts.map((m) => m.screen.x - m.fig.x)) : 0;
  const fy = matchedTexts.length ? median(matchedTexts.map((m) => m.screen.y - m.fig.y)) : 0;
  const inFrame = (b: PageBox) => {
    const cx = b.x + b.width / 2 - fx;
    const cy = b.y + b.height / 2 - fy;
    return cx >= 0 && cx <= frame.width && cy >= 0 && cy <= frame.height;
  };
  type Leaf = { el: Element; box: PageBox; sig: string; text: boolean };
  const leaves: Leaf[] = [];
  // Só folhas de verdade: um contêiner com o texto de vários filhos juntos tomaria o par de um deles.
  const textEls = new Set(textIndex.map((e) => e.el));
  for (const e of textIndex) {
    if (!inFrame(e.box)) continue;
    if (Array.from(e.el.querySelectorAll('*')).some((c) => textEls.has(c))) continue;
    // Ícone desenhado por fonte (1–2 caracteres) conta como ícone.
    const isGlyph = e.text.length <= 2 && !/[a-z0-9]/i.test(e.text);
    leaves.push({ el: e.el, box: e.box, sig: structureSig(e.el), text: !isGlyph });
  }
  for (const el of Array.from(document.querySelectorAll(REPLACED))) {
    if (!isVisible(el) || (el.tagName.toLowerCase() !== 'svg' && el.closest('svg'))) continue;
    const box = pageRect(el, rootRect);
    if (box.width < 6 || box.height < 6 || !inFrame(box)) continue;
    if (leaves.some((l) => l.el.contains(el))) continue;
    const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    leaves.push({ el, box, sig: structureSig(el), text: field });
  }
  if (!leaves.length) return [];

  // Folhas do Figma; as dos textos já casados pelo conteúdo ficam com o par delas.
  const figma = (spec.figmaLeaves || []).map((f) => ({ box: f as PageBox, text: Boolean(f.text), taken: false }));
  for (const fig of [...matchedTexts.map((m) => m.fig), ...movedTexts]) {
    let best = -1;
    let bestIoU = 0.5;
    figma.forEach((f, i) => {
      if (!f.text || f.taken) return;
      const iou = rectIoU(f.box, fig);
      if (iou > bestIoU) {
        best = i;
        bestIoU = iou;
      }
    });
    if (best >= 0) figma[best].taken = true;
  }
  const textAnchors: Anchor[] = matchedTexts.map((m) => ({ fig: m.fig, screen: m.screen }));
  const isMatched = (el: Element) => matchedEls.some((m) => m === el || m.contains(el) || el.contains(m));
  const free = leaves.filter((l) => !isMatched(l.el));
  const pairs = pairLeaves(
    free.map((l) => ({ box: l.box, text: l.text, offsets: offsetsAround(l.box, boxAnchors, textAnchors, layoutOffset) })),
    figma,
  );
  const withPair = new Set<Element>(leaves.filter((l) => isMatched(l.el)).map((l) => l.el));
  free.forEach((l, i) => {
    if (pairs[i] >= 0) withPair.add(l.el);
  });
  const paired = leaves.filter((l) => withPair.has(l.el));
  // Só controles e rótulos de controle (botão, filtro, aba, link, campo, ícone clicável) com texto que não existe em
  // lugar nenhum do Figma e sem números: é o elemento a mais típico, e não se confunde com dado de exemplo.
  const figmaTexts = new Set<string>();
  for (const r of spec.regions || []) {
    for (const t of [r.hasText, r.boxLabel, ...(r.boxTexts ?? [])]) if (t) figmaTexts.add(normalizeForMatch(t));
  }
  const inFigma = (t: string) => figmaTexts.has(t) || [...figmaTexts].some((f) => isSameCopy(t, f));
  const control = (el: Element) => el.closest(CONTROL) ?? (el.matches('input, textarea, select') ? el : null);
  // Linha a mais de tabela/lista: além da mesma estrutura e da mesma coluna (isRepeatedRow), as duas precisam estar
  // em itens irmãos de uma lista de verdade (mesma tag e mesma classe sob o mesmo pai: <tr>, <li>, card repetido).
  // Dois parágrafos diferentes um embaixo do outro não são linhas de dado.
  const sameListItem = (a: Element, b: Element) => {
    const upA: Element[] = [];
    for (let c: Element | null = a, i = 0; c && i < 6; c = c.parentElement, i++) upA.push(c);
    for (let c: Element | null = b, i = 0; c && i < 6; c = c.parentElement, i++) {
      const twin = upA.find((x) => x !== c && x.parentElement && x.parentElement === c.parentElement);
      if (twin) return twin.tagName === c.tagName && classOf(twin) === classOf(c) && !twin.contains(c) && !c.contains(twin);
    }
    return false;
  };
  const isDataRow = (l: Leaf) => isRepeatedRow(l, paired.filter((p) => sameListItem(p.el, l.el)));
  // Card ou chip clicável que repete um irmão da mesma lista que tem par: é mais um item de dado, não elemento a mais.
  const repeatsListItem = (l: Leaf, ctrl: Element) => {
    const list = ctrl.parentElement?.parentElement ?? ctrl.parentElement;
    return Boolean(list) && paired.some((p) => p.sig === l.sig && list!.contains(p.el) && !ctrl.contains(p.el));
  };
  let extras = free.filter((l, i) => {
    const ctrl = control(l.el);
    if (!l.text || pairs[i] >= 0 || isDataRow(l) || !ctrl || repeatsListItem(l, ctrl)) return false;
    // Controle de rótulo único (botão, filtro, aba, link): um texto só dentro dele. Card clicável com vários textos é dado.
    if (leaves.filter((o) => o.text && ctrl.contains(o.el)).length !== 1) return false;
    const t = normalizeForMatch(elementText(l.el));
    return Boolean(t) && !/\d/.test(t) && t.split(' ').length <= 4 && !inFigma(t);
  });
  const sure = new Set(extras.map((x) => x.el));
  // Segundo nível (aviso, não erro): texto solto, imagem ou card sem par no Figma. Pode ser dado de exemplo
  // ou outra arrumação, por isso fica para conferir no olho. Dado repetido (linha, item de lista) e números ficam de fora.
  const repeatsSibling = (l: Leaf) => paired.some((p) => p.sig === l.sig && sameListItem(p.el, l.el));
  // Item de uma lista repetida (linhas, cards, logos de um carrossel) é dado, tenha ou não par no Figma: no segundo
  // nível ele não vira "talvez a mais". Lista é irmão com a mesma tag e a mesma classe: com 3 itens ou mais, basta;
  // com só 2, os dois precisam ter o mesmo formato por dentro (duas colunas diferentes com a mesma classe utilitária,
  // comum em Tailwind, não são lista).
  const sameShape = (a: Element, b: Element) => {
    const kids = (e: Element) => Array.from(e.children).map((k) => k.tagName).join(',');
    if (kids(a) === kids(b)) return true;
    const na = a.querySelectorAll('*').length;
    const nb = b.querySelectorAll('*').length;
    return na > 0 && nb > 0 && Math.max(na, nb) / Math.min(na, nb) <= 1.5;
  };
  // Resposta por elemento guardada: numa tabela longa, cada célula sobe até a mesma linha (<tr>) com centenas de irmãs.
  const repeatedItem = new Map<Element, boolean>();
  const isRepeatedItem = (c: Element) => {
    const known = repeatedItem.get(c);
    if (known !== undefined) return known;
    let answer = false;
    const p = c.parentElement;
    if (p && (classOf(c) || c.tagName === 'LI' || c.tagName === 'TR')) {
      // Para no segundo irmão visível igual: não precisa medir a lista inteira.
      const twins: Element[] = [];
      for (const s of Array.from(p.children)) {
        if (s === c || s.tagName !== c.tagName || classOf(s) !== classOf(c) || !isVisible(s)) continue;
        twins.push(s);
        if (twins.length >= 2) break;
      }
      answer = twins.length >= 2 || (twins.length === 1 && sameShape(twins[0], c));
    }
    repeatedItem.set(c, answer);
    return answer;
  };
  const inRepeatedList = (el: Element) => {
    for (let c: Element | null = el, i = 0; c && c !== document.body && i < 6; c = c.parentElement, i++) {
      if (!c.parentElement) break;
      if (isRepeatedItem(c)) return true;
    }
    return false;
  };
  // Iniciais de avatar ("TS", "KW"): o texto fica num círculo ou quadrado pequeno pintado. Fora disso, "PDF" e "OK"
  // são rótulos de verdade.
  const isAvatar = (el: Element) => {
    for (let c: Element | null = el, i = 0; c && i < 2; c = c.parentElement, i++) {
      const r = c.getBoundingClientRect();
      if (r.width < 16 || r.width > 64 || Math.abs(r.width - r.height) > 4) continue;
      const cs = getComputedStyle(c);
      const radius = parseFloat(cs.borderTopLeftRadius);
      const round = cs.borderTopLeftRadius.endsWith('%') ? radius > 0 : radius >= r.width / 4;
      if (round || paintOf(c).paints || cs.backgroundImage !== 'none') return true;
    }
    return false;
  };
  extras.push(
    ...free.filter((l, i) => {
      if (sure.has(l.el) || pairs[i] >= 0 || isDataRow(l) || repeatsSibling(l) || inRepeatedList(l.el)) return false;
      const ctrl = control(l.el);
      if (ctrl && repeatsListItem(l, ctrl)) return false;
      if (!l.text) return l.box.width >= 12 && l.box.height >= 12;
      const t = normalizeForMatch(elementText(l.el));
      // @menção, #tag, e-mail, link e iniciais de avatar ("TS", "KW") são dado de exemplo.
      if (/(^|\s)[@#]\w|@|:\/\/|www\./.test(t)) return false;
      if (/^[A-Z]{1,3}$/.test(normalizeText(elementText(l.el))) && isAvatar(l.el)) return false;
      return Boolean(t) && !/\d/.test(t) && t.split(' ').length <= 8 && !inFigma(t);
    }),
  );

  // Linha de itens lado a lado: só há item a mais se a tela tem mais itens que o Figma naquela linha.
  extras = extras.filter((x) => {
    const cy = x.box.y + x.box.height / 2;
    const container = x.el.parentElement?.parentElement ?? x.el.parentElement;
    // Conta só o mesmo tipo (texto com texto, ícone com ícone): um botão a mais não "empata" com a lupa do Figma.
    const line = leaves.filter((l) => l.text === x.text && Math.abs(l.box.y + l.box.height / 2 - cy) <= 6 && container?.contains(l.el));
    if (line.length < 2) return true;
    const ref = line.find((l) => withPair.has(l.el));
    if (!ref) return true;
    const off = offsetsAround(ref.box, boxAnchors, textAnchors, layoutOffset)[0];
    const minX = Math.min(...line.map((l) => l.box.x)) + off.dx;
    const maxX = Math.max(...line.map((l) => l.box.x + l.box.width)) + off.dx;
    const figCy = cy + off.dy;
    const figOnLine = figma.filter(
      (f) => f.text === x.text && Math.abs(f.box.y + f.box.height / 2 - figCy) <= 8 && f.box.x + f.box.width >= minX - 40 && f.box.x <= maxX + 240,
    ).length;
    return line.length > figOnLine;
  });
  if (!extras.length) return [];

  // Agrupa no maior bloco da tela que só tem coisa sem par (o filtro inteiro, não o texto e o ícone separados).
  const pairedEls = [...withPair];
  const frameArea = frame.width * frame.height;
  const groups = new Set<Element>();
  for (const x of extras) {
    let cur: Element = x.el;
    for (;;) {
      const parent: Element | null = cur.parentElement;
      if (!parent || parent === document.body || parent === rootEl || parent === document.documentElement) break;
      if (pairedEls.some((p) => parent.contains(p))) break;
      const b = pageRect(parent, rootRect);
      if (b.width * b.height > frameArea * 0.25) break;
      cur = parent;
    }
    groups.add(cur);
  }
  const outer = [...groups].filter((g) => ![...groups].some((o) => o !== g && o.contains(g)));
  return outer.map((el): RegionReport => {
    const box = pageRect(el, rootRect);
    const certain = [...sure].some((s) => el === s || el.contains(s));
    const label = normalizeText(elementText(el)).slice(0, 40) || el.getAttribute('aria-label') || el.tagName.toLowerCase();
    const inOtherState = otherStateAreas.some(
      (a) => box.x + box.width / 2 >= a.x && box.x + box.width / 2 <= a.x + a.width && box.y + box.height / 2 >= a.y && box.y + box.height / 2 <= a.y + a.height,
    );
    return {
      name: `Not in Figma: "${label}"`,
      selector: '*',
      figmaRect: null,
      count: 1,
      key: el.getAttribute('data-k'),
      rect: { x: box.x + rootRect.x, y: box.y + rootRect.y, width: box.width, height: box.height },
      matchedBy: null,
      extra: true,
      results: [
        {
          property: 'element',
          expected: 'absent',
          actual: 'present',
          status: certain && !inOtherState ? 'fail' : 'warn',
          note: !certain
            ? 'possibly not in the Figma frame (loose text, image or card): check by eye'
            : inOtherState
              ? 'on screen but not in the Figma frame (inside a box in another state)'
              : 'on screen but not in the Figma frame',
        },
      ],
    };
  });
}

/** Deslocamento local de uma caixa: o do texto mais em cima e à esquerda dentro dela no Figma. */
function localOffset(box: PageBox, anchors: { fig: PageBox; screen: PageBox }[]): Offset | null {
  const inside = anchors.filter(
    (a) => a.fig.x >= box.x - 1 && a.fig.y >= box.y - 1 && a.fig.x + a.fig.width <= box.x + box.width + 1 && a.fig.y + a.fig.height <= box.y + box.height + 1,
  );
  if (!inside.length) return null;
  inside.sort((a, b) => a.fig.y - b.fig.y || a.fig.x - b.fig.x);
  const first = inside[0];
  return { dx: Math.round(first.screen.x - first.fig.x), dy: Math.round(first.screen.y - first.fig.y) };
}

function measureRegion(
  region: SpecRegion,
  rootRect: { x: number; y: number },
  offset: Offset = { dx: 0, dy: 0 },
  textIndex: TextEntry[] = [],
  /** Elemento já escolhido (linha de uma lista casada pela ordem): mede esse, sem procurar. */
  forced?: Element,
): MeasuredElement {
  let list: Element[];
  try {
    list = Array.from(document.querySelectorAll(region.selector || '*'));
  } catch (e) {
    return { found: false, count: 0, error: `invalid selector: ${(e as Error).message}` };
  }

  const target = region.figmaRect ? shift(region.figmaRect, offset) : null;
  let matchedBy: MeasuredElement['matchedBy'];

  if (forced) {
    list = [forced];
    matchedBy = { by: 'order' };
  } else if (isAutoTextRegion(region)) {
    const picked = pickAutoText(region, target, textIndex);
    if (!picked.el) return { found: false, count: 0, elsewhere: picked.elsewhere };
    list = [picked.el];
  } else if (region.hasText) {
    const needle = normalizeText(region.hasText).toLowerCase();
    list = textCandidates(region, list);
    const boxes = new Map(list.map((el) => [el, pageRect(el, rootRect)]));
    const gap = (el: Element) => (target ? boxGap(boxes.get(el)!, target) : 0);
    list.sort((a, b) => {
      const ta = normalizeText(elementText(a)).toLowerCase();
      const tb = normalizeText(elementText(b)).toLowerCase();
      const ea = ta === needle ? 1 : 0;
      const eb = tb === needle ? 1 : 0;
      if (ea !== eb) return eb - ea;
      // Mesmo texto em lugares diferentes: fica o mais perto de onde o Figma desenha.
      const ga = Math.round(gap(a) / 24);
      const gb = Math.round(gap(b) / 24);
      if (ga !== gb) return ga - gb;
      const da = getDomDepth(a);
      const db = getDomDepth(b);
      if (da !== db) return db - da;
      return a.querySelectorAll('*').length - b.querySelectorAll('*').length;
    });
  }

  if (!forced && region.matchMode === 'rect' && target) {
    // Um elemento da tela é uma caixa só: o que já casou com outra caixa do Figma não entra de novo.
    // (Camadas do Figma do mesmo tamanho, uma dentro da outra, podem casar com o mesmo elemento.)
    const visible = list.filter((el) => {
      if (!isVisible(el)) return false;
      const owner = claimedBoxes.get(el);
      return !owner || !region.figmaRect || rectIoU(owner, region.figmaRect) >= 0.9;
    });
    const rects = visible.map((el) => pageRect(el, rootRect));
    // Caixas empilhadas no mesmo lugar (invólucro, caixa, imagem): fica a que desenha o que o Figma mostra.
    const wantsRadius = region.expect?.borderRadius !== undefined;
    const wantsBorder = region.expect?.borderWidth !== undefined;
    // Os textos do Figma dentro da caixa: o candidato que tem esses textos é a mesma caixa (vale mais que pintar).
    const figTexts = region.boxTexts ?? (region.boxLabel ? [region.boxLabel] : []);
    const contentOf = new Map<number, { found: number; total: number }>();
    const bonus = rects.map((r, i) => {
      if (Math.abs(r.x - target.x) > 24 || Math.abs(r.y - target.y) > 24) return 0;
      let byContent = 0;
      if (figTexts.length) {
        const c = contentMatch(elementText(visible[i]), figTexts);
        contentOf.set(i, c);
        if (c.total) byContent = 0.15 * (c.found / c.total);
      }
      const p = paintOf(visible[i]);
      return byContent + (p.paints ? 0.05 : 0) + (wantsRadius && p.rounded ? 0.05 : 0) + (wantsBorder && p.hasBorder ? 0.03 : 0);
    });
    const best = pickBestRect(rects, target, 0.6, 24, bonus);
    list = best >= 0 ? [visible[best]] : [];
    // Invólucro transparente no lugar da caixa: se o Figma pinta a caixa e um filho no mesmo canto pinta, a caixa é o filho.
    const e = region.expect ?? {};
    const bgWanted = typeof e.backgroundColor === 'string' && parseColor(e.backgroundColor)?.[3];
    const wantsPaint = Boolean(bgWanted) || e.borderWidth !== undefined || e.boxShadow !== undefined;
    if (list.length && wantsPaint && !paintOf(list[0]).paints) {
      const outer = pageRect(list[0], rootRect);
      let inner: Element | null = null;
      let innerArea = 0;
      let innerTaken = false;
      for (const d of Array.from(list[0].querySelectorAll('*'))) {
        if (!isVisible(d) || !paintOf(d).paints) continue;
        const b = pageRect(d, rootRect);
        const area = b.width * b.height;
        if (Math.abs(b.x - outer.x) > 4 || Math.abs(b.y - outer.y) > 4 || area < 0.4 * target.width * target.height || area <= innerArea) continue;
        const owner = claimedBoxes.get(d);
        if (owner && region.figmaRect && rectIoU(owner, region.figmaRect) < 0.9) {
          innerTaken = true;
          continue;
        }
        inner = d;
        innerArea = area;
      }
      // A caixa pintada já é de outra caixa do Figma: comparar com o invólucro daria erro falso.
      if (!inner && innerTaken) return { found: false, count: 0 };
      if (inner) {
        list = [inner];
        if (figTexts.length) contentOf.set(best, contentMatch(elementText(inner), figTexts));
      }
    }
    if (list.length) {
      const c = contentOf.get(best) ?? { found: 0, total: 0 };
      if (!region.boxHasText) matchedBy = { by: 'shape' };
      else if (c.found > 0) matchedBy = region.boxTexts ? { by: 'content', found: c.found, total: c.total } : { by: 'label' };
      else {
        const chosen = list[0];
        // Nenhum texto do Figma está na caixa, mas eles estão em outro lugar da tela: casou com a caixa errada.
        const elsewhere = figTexts.some((t) => {
          const want = normalizeForMatch(t);
          return want.length >= 3 && /[a-z]{2,}/i.test(withoutNumbers(t)) && textIndex.some((e) => containsPhrase(e.text, want) && !chosen.contains(e.el));
        });
        if (elsewhere) return { found: false, count: 0, contentElsewhere: true };
        // Texto diferente (dado de exemplo): só é a mesma caixa se os textos estão nos mesmos lugares dentro dela.
        const slots = region.boxTextSlots ?? [];
        const s = slots.length ? slotMatch(slots, screenTextSlots(chosen, rootRect, Math.max(...slots.map((sl) => sl.cy)) + 32)) : { found: 0, total: 0, dx: 0, dy: 0 };
        // Aceita com a maioria dos textos no lugar (60%, ao menos 2); com um texto só, ele precisa estar no lugar exato.
        const sameLayout = s.total === 1 ? s.found === 1 && !s.dx && !s.dy : s.found >= 2 && s.found / s.total >= 0.6;
        if (!sameLayout) return { found: false, count: 0, otherContent: true };
        matchedBy = { by: 'layout', found: s.found, total: s.total };
      }
    }
  }

  // Valem também para a linha de lista escolhida pela ordem: outro estado não se compara.
  if (region.matchMode === 'rect' && list.length) {
    // Caixa que no Figma tem texto e na tela está vazia (slot sem dado): outro estado, não dá para comparar.
    if (region.boxHasText && !normalizeForMatch(elementText(list[0]))) {
      return { found: false, count: 0, otherContent: true };
    }
    // Badge, chip ou botão com outro rótulo na tela: é outro estado (ou dado de exemplo), não dá para comparar o estilo.
    if (region.boxLabel) {
      const shown = normalizeForMatch(elementText(list[0]));
      const want = normalizeForMatch(region.boxLabel);
      if (shown && !containsPhrase(shown, want) && withoutNumbers(shown) !== withoutNumbers(want)) {
        return { found: false, count: 0, otherContent: true };
      }
    }
  }

  if (region.matchMode === 'rect' && list.length && region.figmaRect && !claimedBoxes.has(list[0])) claimedBoxes.set(list[0], region.figmaRect);
  const count = list.length;
  const index = region.index ?? 0;
  if (count === 0 || index >= count) return { found: false, count };

  const el = list[index];
  const cs = getComputedStyle(el, region.pseudo || null);
  const r = el.getBoundingClientRect();
  const style: Record<string, string> = {};
  for (const p of COLLECTED_STYLES) {
    style[p] = (cs as unknown as Record<string, string>)[p] ?? '';
  }

  const fam = primaryFontFamily(cs.fontFamily);
  let fontLoaded: boolean | null = null;
  if (fam) {
    try {
      fontLoaded = document.fonts.check(`${cs.fontWeight} ${cs.fontSize} "${fam}"`);
    } catch {
      fontLoaded = null;
    }
  }

  const rect = {
    x: r.x + scrollX,
    y: r.y + scrollY,
    width: r.width,
    height: r.height,
    relX: r.x + scrollX - rootRect.x,
    relY: r.y + scrollY - rootRect.y,
  };

  const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
  return {
    found: true,
    count,
    key: el.getAttribute('data-k'),
    matchedBy: matchedBy ?? (region.hasText ? { by: 'text' } : undefined),
    rect,
    style,
    text: elementText(el),
    placeholder: typeof inputEl.placeholder === 'string' ? inputEl.placeholder : undefined,
    value: typeof inputEl.value === 'string' ? inputEl.value : undefined,
    truncated: el.scrollWidth > el.clientWidth + 1 && cs.textOverflow === 'ellipsis',
    visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
    fontLoaded,
    effectiveBackground: effectiveBackground(el),
    dpr: window.devicePixelRatio || 1,
    visualRect: region.hasText
      ? (typeof region.expect?.lineHeight === 'number' && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
          ? textBoxWithFigmaLineHeight(el, region.expect.lineHeight, rootRect)
          : null) ?? textLineBox(el, el, rootRect) ?? pageRect(el, rootRect)
      : pageRect(el, rootRect),
    contentInset:
      region.expect?.contentInsetTop !== undefined ||
      region.expect?.contentInsetLeft !== undefined ||
      region.expect?.contentInsetRight !== undefined ||
      region.expect?.contentInsetBottom !== undefined
        ? measureContentInset(el, rootRect)
        : null,
    node: el,
  };
}

function formatReportMarkdown(report: ValidationReport): string {
  const s = report.summary;
  const icon: Record<string, string> = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
  const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    '# Figma vs Screen Validation',
    '',
    `- URL: ${report.url}`,
    `- Viewport: ${report.viewport.width}x${report.viewport.height}${
      report.viewport.expectedWidth && report.viewport.expectedWidth !== report.viewport.width
        ? ` (Figma: ${report.viewport.expectedWidth} - resize window)`
        : ''
    }`,
    report.figma?.url ? `- Figma: ${report.figma.url}` : null,
    report.precision !== undefined ? `- Precision level: ${report.precision}%` : null,
    s.score !== null
      ? typeof s.scoreVisible === 'number' && s.scoreVisible !== s.score
        ? `- Fidelity score: **${s.scoreVisible}%** (visible differences; ${s.score}% counting CSS-only)`
        : `- Fidelity score: **${s.score}%**`
      : null,
    `- Result: **${s.fail === 0 ? 'OK' : 'MISMATCHES FOUND'}** - ${s.pass} pass, ${s.fail} fail${
      s.fail && s.failCss !== undefined ? ` (${s.failVisible} visible, ${s.failCss} CSS-only)` : ''
    }, ${s.warn} warn across ${s.regions} regions${report.pendingStates.length ? `, ${report.pendingStates.length} pending states` : ''}`,
    '',
  ].filter((l): l is string => l !== null);

  const failing = report.regions.flatMap((r) =>
    r.results.filter((x) => x.status !== 'pass').map((x) => ({ ...x, region: r.name })),
  );
  const isCssOnly = (f: CheckResult) => f.status === 'fail' && f.visibility === 'css';
  const table = (title: string, rows: typeof failing, lead?: string) => {
    if (!rows.length) return;
    lines.push(title, '');
    if (lead) lines.push(lead, '');
    lines.push('| Status | Region | Property | Figma | Screen | Delta | Note |', '|---|---|---|---|---|---|---|');
    for (const f of rows) {
      lines.push(`| ${icon[f.status] ?? f.status} | ${esc(f.region)} | ${f.property} | ${esc(f.expected)} | ${esc(f.actual)} | ${esc(f.delta)} | ${esc(f.note)} |`);
    }
    lines.push('');
  };
  table('## Differences', failing.filter((f) => !isCssOnly(f)));
  table(
    '## CSS-only differences',
    failing.filter(isCssOnly),
    'Real differences in the code that are not visible on screen (color ΔE under 3, under 4 px of spacing or size, under 1 px of font size). Fix them when touching the component.',
  );

  lines.push('## By Region', '');
  for (const r of report.regions) {
    const fails = r.results.filter((x) => x.status === 'fail').length;
    const warns = r.results.filter((x) => x.status !== 'pass' && x.status !== 'fail').length;
    lines.push(
      `- [${fails ? 'FAIL' : warns ? 'WARN' : 'PASS'}] **${r.name}**${r.state ? ` (${r.state})` : ''} - \`${r.selector}\` - ${
        r.results.length - fails - warns
      }/${r.results.length} pass`,
    );
  }
  return lines.join('\n') + '\n';
}

export interface ValidateOptions {
  only?: string;
  stateApplied?: boolean;
  format?: 'full' | 'markdown';
}

export async function validateFigma(spec: FigmaSpec, opts: ValidateOptions = {}): Promise<ValidationReport | string> {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  let rootEl: Element | null = null;
  if (spec.root) {
    try {
      rootEl = document.querySelector(spec.root);
    } catch {
      rootEl = null;
    }
  }
  const rr = rootEl ? rootEl.getBoundingClientRect() : null;
  const rootRect = rr ? { x: rr.x + scrollX, y: rr.y + scrollY } : { x: 0, y: 0 };

  const regions: RegionReport[] = [];
  const pendingStates: PendingState[] = [];

  // Só faz sentido estimar o deslocamento quando a spec tem posições do Figma (spec automática ou com figmaRect).
  const spacingItems: (SpacingItem & { report: RegionReport; tolerances: ToleranceConfig })[] = [];
  const needsIndex = (spec.regions || []).some(isAutoTextRegion);
  const findsExtras = Boolean(spec.figmaLeaves?.length && spec.figmaFrame);
  const textIndex = needsIndex || findsExtras ? buildTextIndex(rootRect) : [];
  const layoutOffset = needsIndex ? estimateLayoutOffset(spec, textIndex) : { dx: 0, dy: 0 };

  const baseTolerances =
    // Rigor sempre 100% (Exato): a precision da spec (de agente ou de spec antiga) é ignorada.
    tolerancesFromPrecision(DEFAULT_PRECISION);

  // 1ª passada: textos da spec automática. Eles viram âncoras de posição para as caixas.
  const active = (spec.regions || []).filter((region) => {
    if (opts.only && !region.name.toLowerCase().includes(String(opts.only).toLowerCase())) return false;
    if (region.state && !opts.stateApplied) {
      pendingStates.push({ name: region.name, selector: region.selector, state: region.state });
      return false;
    }
    return !(!region.state && opts.stateApplied);
  });
  claimedBoxes = new Map<Element, Rect>();
  const buildResults = (region: SpecRegion, measured: MeasuredElement) => {
    const results = compareRegion(region.expect || {}, measured, {
      ...baseTolerances,
      ...spec.tolerances,
      ...region.tolerances,
    });
    if (measured.error && results[0]) results[0].note = measured.error;
    if (!measured.found && !measured.error && region.ifMissing === 'warn' && results[0]) {
      const note = measured.contentElsewhere
        ? 'box content appears elsewhere on screen (layout moved or other state)'
        : measured.otherContent
          ? 'box shows other content on screen (other state or sample data)'
          : measured.elsewhere
            ? 'Figma text appears only elsewhere on the screen'
            : region.hasText
              ? 'Figma text not on screen (may be sample data)'
              : 'no element on screen in the place of this Figma box';
      results[0] = { ...results[0], status: 'warn', note };
    }
    return results;
  };
  const spacingItemFor = (region: SpecRegion, screen: PageBox, report: RegionReport) => ({
    id: spacingItems.length,
    name: region.name,
    fig: region.figmaRect!,
    screen,
    rightIsReal: !region.hasText || Boolean(region.autoWidth),
    leftIsReal: !region.hasText || Boolean(region.startAligned || region.autoWidth),
    fixedGap: region.fixedGap,
    report,
    tolerances: { ...baseTolerances, ...spec.tolerances, ...region.tolerances },
  });
  // Itens de lista medidos (para casar pela ordem no fim).
  const listItems: { region: SpecRegion; measured: MeasuredElement; report: RegionReport; offset: Offset }[] = [];
  const measuredBy = new Map<SpecRegion, MeasuredElement>();
  const matchedEls: Element[] = [];
  const matchedTexts: { fig: PageBox; el: Element; screen: PageBox }[] = [];
  const movedTexts: PageBox[] = [];
  // Por região, para o recasamento das listas pela ordem poder trocar a âncora ou tirar a área de outro estado.
  const boxAnchorBy = new Map<SpecRegion, Anchor>();
  const otherStateBy = new Map<SpecRegion, PageBox>();
  const anchors: { fig: PageBox; screen: PageBox }[] = [];
  for (const region of active) {
    if (!isAutoTextRegion(region)) continue;
    const m = measureRegion(region, rootRect, layoutOffset, textIndex);
    measuredBy.set(region, m);
    if (m.found && region.figmaRect && region.startAligned && m.visualRect) anchors.push({ fig: region.figmaRect, screen: m.visualRect });
  }

  for (const region of active) {
    // Caixa: o deslocamento vem do primeiro texto dentro dela (em cima, à esquerda), não da tela inteira.
    // Assim um bloco que mudou de lugar ainda casa com a caixa certa.
    const offset = region.matchMode === 'rect' && region.figmaRect ? localOffset(region.figmaRect, anchors) ?? layoutOffset : layoutOffset;
    const measured = measuredBy.get(region) ?? measureRegion(region, rootRect, offset, textIndex);
    // Para achar elementos a mais: caixas casadas viram âncoras de posição; caixas em outro estado marcam a área.
    // Texto do Figma que está em outro lugar da tela: o lugar dele no Figma não fica livre para outro elemento.
    if (!measured.found && measured.elsewhere && region.figmaRect) movedTexts.push(region.figmaRect);
    // Só textos casados explicam o próprio elemento: uma caixa casada (o card inteiro) não explica o que tem dentro.
    if (measured.found && measured.node instanceof Element && region.hasText) {
      matchedEls.push(measured.node);
      if (region.figmaRect && measured.visualRect) matchedTexts.push({ fig: region.figmaRect, el: measured.node, screen: measured.visualRect });
    }
    if (region.matchMode === 'rect' && region.figmaRect) {
      if (measured.found && measured.visualRect) boxAnchorBy.set(region, { fig: region.figmaRect, screen: measured.visualRect });
      else if (measured.otherContent || measured.contentElsewhere) otherStateBy.set(region, shift(region.figmaRect, offset));
    }
    const results = buildResults(region, measured);
    const regionReport: RegionReport = {
      name: region.name,
      selector: region.selector,
      state: region.state,
      figmaNode: region.figmaNode,
      figmaRect: region.figmaRect || null,
      count: measured.count,
      key: measured.key || null,
      matchedBy: measured.matchedBy ?? null,
      rect: measured.rect ? { x: measured.rect.x, y: measured.rect.y, width: measured.rect.width, height: measured.rect.height } : null,
      results,
    };
    regions.push(regionReport);
    if (region.listGroup !== undefined && region.listIndex !== undefined) listItems.push({ region, measured, report: regionReport, offset });
    if (spec.checkSpacing && measured.found && region.figmaRect && measured.visualRect) {
      spacingItems.push(spacingItemFor(region, measured.visualRect, regionReport));
    }
  }

  // Listas (linhas de tabela, cards repetidos): a linha N do Figma é a N-ésima linha da tela, contando da primeira
  // confirmada. Sem isso, uma linha mais alta empurra as de baixo e cada uma casa com a vizinha (zebra, padding errados).
  const byGroup = new Map<string, typeof listItems>();
  for (const it of listItems) {
    const g = byGroup.get(it.region.listGroup!) ?? [];
    g.push(it);
    byGroup.set(it.region.listGroup!, g);
  }
  // Linha confirmada pelo próprio texto: o rótulo, ou a maioria dos textos do Figma (mais da metade, ao menos 2).
  // Uma ou duas palavras de dado de exemplo que se repetem ("Ready", "Active") não confirmam a linha.
  const confirmedBy = (m: MeasuredElement) => {
    const by = m.matchedBy;
    if (by?.by === 'label') return true;
    return by?.by === 'content' && (by.found ?? 0) >= 2 && (by.found ?? 0) / (by.total || 1) > 0.5;
  };
  for (const items of byGroup.values()) {
    items.sort((a, b) => a.region.listIndex! - b.region.listIndex!);
    const found = items.filter((it) => it.measured.found && it.measured.node instanceof Element);
    if (found.length < 2) continue;
    const baseEl = (found.find((it) => confirmedBy(it.measured)) ?? found[0]).measured.node as Element;
    const parent = baseEl.parentElement;
    if (!parent) continue;
    // Linhas de verdade: irmãs com a mesma tag e a mesma classe (uma divisória ou um elemento a mais entre elas não conta).
    // Na ordem em que aparecem (grade, flex invertido ou posição absoluta podem mudar a ordem do DOM), como no Figma.
    const rows = orderByLines(
      Array.from(parent.children).filter((c) => c.tagName === baseEl.tagName && classOf(c) === classOf(baseEl) && isVisible(c)),
      (c) => c.getBoundingClientRect(),
    );
    const placed = found.filter((it) => rows.includes(it.measured.node as Element));
    // Só vale quando as linhas casadas são mesmo irmãs na tela.
    if (placed.length < 2) continue;
    // Deslocamento (linha na tela − linha no Figma) que mais linhas casadas confirmam; linha casada pelo próprio texto
    // vale um pouco mais. Uma linha só fora do lugar (a destacada, que na tela está mais embaixo) não arrasta as outras.
    const votes = new Map<number, number>();
    for (const it of placed) {
      const d = rows.indexOf(it.measured.node as Element) - it.region.listIndex!;
      votes.set(d, (votes.get(d) ?? 0) + (confirmedBy(it.measured) ? 1.5 : 1));
    }
    const shiftBy = [...votes.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0];
    for (const it of items) {
      // Linha casada pelo próprio texto é a mesma linha, esteja onde estiver.
      if (it.measured.found && confirmedBy(it.measured)) continue;
      const want = rows[it.region.listIndex! + shiftBy];
      const current = it.measured.found ? (it.measured.node as Element) : null;
      if (want && want === current) continue;
      // Sem linha correspondente na lista da tela, mas casou com um bloco fora dela: fica com esse (não é vizinha roubada).
      if (!want && current && !rows.includes(current)) continue;
      // A linha que é de outra região já casada pelo texto não é reusada.
      if (want && found.some((o) => o !== it && o.measured.node === want && confirmedBy(o.measured))) continue;
      const measured: MeasuredElement = want
        ? measureRegion(it.region, rootRect, it.offset, textIndex, want)
        : { found: false, count: 0 };
      it.measured = measured;
      const results = buildResults(it.region, measured);
      Object.assign(it.report, {
        count: measured.count,
        key: measured.key || null,
        matchedBy: measured.matchedBy ?? null,
        rect: measured.rect ? { x: measured.rect.x, y: measured.rect.y, width: measured.rect.width, height: measured.rect.height } : null,
        results,
      });
      // As âncoras dos elementos a mais seguem a nova linha (e a linha em outro estado marca a área dela).
      otherStateBy.delete(it.region);
      boxAnchorBy.delete(it.region);
      if (it.region.figmaRect) {
        if (measured.found && measured.visualRect) boxAnchorBy.set(it.region, { fig: it.region.figmaRect, screen: measured.visualRect });
        else if (measured.otherContent || measured.contentElsewhere) otherStateBy.set(it.region, shift(it.region.figmaRect, it.offset));
      }
      // O espaço até os vizinhos usa a linha nova; a que só apareceu agora entra na conta.
      const sp = spacingItems.findIndex((s) => s.report === it.report);
      if (measured.found && measured.visualRect) {
        if (sp >= 0) spacingItems[sp].screen = measured.visualRect;
        else if (spec.checkSpacing && it.region.figmaRect) spacingItems.push(spacingItemFor(it.region, measured.visualRect, it.report));
      } else if (sp >= 0) spacingItems.splice(sp, 1);
    }
  }
  spacingItems.forEach((s, i) => (s.id = i));

  // Espaço entre vizinhos (gap visual): medido na tela entre as caixas, comparado com o Figma.
  if (spec.checkSpacing && spacingItems.length > 1) {
    const screenLeaves = [
      ...textIndex.map((e) => e.box),
      ...Array.from(document.querySelectorAll(REPLACED)).filter(isVisible).map((el) => pageRect(el, rootRect)),
    ];
    const groups = (spec.regions || []).filter((r) => r.matchMode === 'rect' && r.figmaRect).map((r) => r.figmaRect!);
    for (const pair of findSpacingPairs(spacingItems, spec.figmaLeaves || [], screenLeaves, 120, groups)) {
      const a = spacingItems[pair.a];
      const b = spacingItems[pair.b];
      b.report.results.push(spacingResult(pair, a.name, b.tolerances));
    }
  }

  // Elementos a mais: o que está na tela, dentro do frame, e não tem nada do Figma no mesmo lugar.
  if (spec.figmaLeaves?.length && spec.figmaFrame) {
    regions.push(
      ...findExtraElements(spec, rootRect, textIndex, matchedTexts, movedTexts, matchedEls, [...boxAnchorBy.values()], [...otherStateBy.values()], layoutOffset, rootEl),
    );
  }

  annotateVisibility(regions);
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, expectedWidth: spec.viewport?.width },
    page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    figmaFrame: spec.figmaFrame || null,
    figma: spec.figma,
    precision: DEFAULT_PRECISION,
    rootFound: spec.root ? Boolean(rootEl) : null,
    summary: summarize(regions),
    pendingStates,
    regions,
  };
  report.markdown = formatReportMarkdown(report);
  if (pendingStates.length) {
    report.next = 'Apply the state in the browser for each item in pendingStates and re-run window.__figmaValidator(spec, { only: "<name>", stateApplied: true }).';
  }
  return opts.format === 'markdown' ? report.markdown : report;
}

type ValidatorWindow = Window & {
  __figmaValidator?: typeof validateFigma;
  __figmaValidatorVersion?: string;
};

const validatorWin = window as ValidatorWindow;
validatorWin.__figmaValidator = validateFigma;
validatorWin.__figmaValidatorVersion = '3.0.0';
