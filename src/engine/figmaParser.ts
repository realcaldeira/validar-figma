import { orderByLines } from './compare.ts';
import type { FigmaNodeInput, FigmaPaint, FigmaSpec, Rect, RegionExpect, SpecRegion } from './types.ts';

export function parseFigmaUrl(rawUrl: string): { fileKey: string; nodeId: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/(?:^|\.)figma\.com$/i.test(url.hostname)) return null;
  // Link de branch (/design/<arquivo>/branch/<branch>/…): o frame mexido na branch só existe no arquivo da branch.
  const match = url.pathname.match(/\/(?:design|file|proto|board)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const branch = url.pathname.match(/\/(?:design|file|proto|board)\/[a-zA-Z0-9]+\/branch\/([a-zA-Z0-9]+)/);
  const nodeParam = url.searchParams.get('node-id')?.trim();
  if (!nodeParam) return null;
  const nodeId = nodeParam.replace(/-/g, ':');
  if (!/^[0-9A-Za-z:;._-]+$/.test(nodeId)) return null;
  return { fileKey: branch ? branch[1] : match[1], nodeId };
}

export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }, opacity = 1): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const hex =
    '#' +
    [toByte(color.r), toByte(color.g), toByte(color.b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  const alpha = Math.max(0, Math.min(1, (color.a ?? 1) * opacity));
  if (alpha >= 0.995) return hex;
  const r = toByte(color.r);
  const g = toByte(color.g);
  const b = toByte(color.b);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

function firstSolidPaint(paints: FigmaPaint[] | undefined): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false && p.type === 'SOLID' && p.color);
}

function buildTextExpect(node: FigmaNodeInput): RegionExpect {
  const expect: RegionExpect = {};
  if (node.characters) expect.text = node.characters.trim();
  if (node.style) {
    if (node.style.fontFamily) expect.fontFamily = node.style.fontFamily;
    if (node.style.fontSize) expect.fontSize = Math.round(node.style.fontSize * 100) / 100;
    if (node.style.fontWeight) expect.fontWeight = node.style.fontWeight;
    if (node.style.lineHeightPx) expect.lineHeight = Math.round(node.style.lineHeightPx * 100) / 100;
    if (node.style.letterSpacing) expect.letterSpacing = Math.round(node.style.letterSpacing * 100) / 100;
    if (node.style.italic) expect.fontStyle = 'italic';
    // Caixa de texto com largura automática: o alinhamento não muda nada no desenho, então não vira regra.
    if (node.style.textAlignHorizontal && node.style.textAutoResize !== 'WIDTH_AND_HEIGHT') {
      const map: Record<string, string> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
      const mapped = map[node.style.textAlignHorizontal];
      if (mapped) expect.textAlign = mapped;
    }
    if (node.style.textCase === 'UPPER') expect.textTransform = 'uppercase';
    else if (node.style.textCase === 'LOWER') expect.textTransform = 'lowercase';
    else if (node.style.textCase === 'TITLE') expect.textTransform = 'capitalize';
  }
  const solid = firstSolidPaint(node.fills);
  if (solid?.color) expect.color = rgbaToHex(solid.color, solid.opacity ?? 1);
  if (node.opacity !== undefined && node.opacity < 0.995) expect.opacity = Math.round(node.opacity * 100) / 100;
  return expect;
}

/**
 * Regras de uma caixa do Figma: só o que aparece na tela (tamanho fixo, fundo, borda, raio, sombra).
 * Padding, gap e tipo de layout ficam de fora: o código pode montar a mesma aparência com outra estrutura,
 * e comparar isso no elemento casado gera falha falsa.
 */
function buildContainerExpect(node: FigmaNodeInput): RegionExpect {
  const expect: RegionExpect = {};
  if (node.absoluteBoundingBox) {
    // Tamanho que depende do conteúdo (HUG) ou do espaço (FILL) muda com os dados: só confere o fixo.
    if (node.layoutSizingHorizontal !== 'HUG' && node.layoutSizingHorizontal !== 'FILL') {
      expect.width = Math.round(node.absoluteBoundingBox.width);
    }
    if (node.layoutSizingVertical !== 'HUG' && node.layoutSizingVertical !== 'FILL') {
      expect.height = Math.round(node.absoluteBoundingBox.height);
    }
  }
  const bg = firstSolidPaint(node.fills);
  if (bg?.color) expect.backgroundColor = rgbaToHex(bg.color, bg.opacity ?? 1);
  const stroke = firstSolidPaint(node.strokes);
  // Borda com opacidade 0 não aparece no desenho: não vira regra. Bordas por lado usam o peso de cada lado.
  const strokeAlpha = (stroke?.opacity ?? 1) * (stroke?.color?.a ?? 1);
  if (stroke?.color && node.strokeWeight && strokeAlpha > 0.01) {
    const w = node.individualStrokeWeights;
    const sides: [number, number, number, number] = w
      ? [w.top, w.right, w.bottom, w.left]
      : [node.strokeWeight, node.strokeWeight, node.strokeWeight, node.strokeWeight];
    expect.borderWidth = sides.every((v) => v === sides[0]) ? sides[0] : sides;
    const color = rgbaToHex(stroke.color, stroke.opacity ?? 1);
    expect.borderColor = w
      ? (sides.map((v) => (v > 0 ? color : null)) as unknown as RegionExpect['borderColor'])
      : color;
  }
  if (node.rectangleCornerRadii) {
    expect.borderRadius = node.rectangleCornerRadii;
  } else if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    expect.borderRadius = node.cornerRadius;
  }
  if (node.effects?.length) {
    const shadows = node.effects
      .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') && e.color)
      .map((e) => {
        const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
        const x = Math.round(e.offset?.x ?? 0);
        const y = Math.round(e.offset?.y ?? 0);
        const blur = Math.round(e.radius ?? 0);
        const spread = Math.round(e.spread ?? 0);
        return `${inset}${x}px ${y}px ${blur}px ${spread}px ${rgbaToHex(e.color!)}`;
      });
    if (shadows.length) expect.boxShadow = shadows.join(', ');
  }
  return expect;
}

/** Textos visíveis dentro de um node do Figma, sem anotações do designer (rótulo único e conteúdo da caixa). */
function descendantTexts(node: FigmaNodeInput, out: string[] = []): string[] {
  for (const child of node.children ?? []) {
    // Anotação do designer (redline, "Dot ·", roxo #9747FF) não é conteúdo da tela.
    if (child.visible === false || isAnnotation(child)) continue;
    if (child.type === 'TEXT' && child.characters?.trim()) out.push(child.characters.trim());
    else descendantTexts(child, out);
  }
  return out;
}

const ICON_MAX = 48;
const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'LINE', 'STAR', 'REGULAR_POLYGON']);

interface Leaf {
  box: { x: number; y: number; width: number; height: number };
  text: boolean;
  /** Centro vertical da primeira linha (texto) ou da forma (ícone): não muda com a entrelinha. */
  centerY: number;
  /** A borda esquerda é o começo do conteúdo (texto alinhado à esquerda, ícone, imagem). */
  startAligned: boolean;
  /** Alinhamento horizontal do texto (só textos). */
  align?: 'L' | 'C' | 'R';
  /** A borda direita é o fim real do conteúdo (ícone, imagem, texto de largura automática ou alinhado à direita). */
  endAligned: boolean;
  /** Centro vertical da última linha (texto) ou da forma: para o espaço de baixo sem contar a entrelinha. */
  centerYLast: number;
}

function hasTextDescendant(node: FigmaNodeInput): boolean {
  return (node.children ?? []).some((c) => c.visible !== false && (c.type === 'TEXT' || hasTextDescendant(c)));
}

/** Conteúdo visível dentro de um node do Figma: textos, ícones (até 48px, sem texto), vetores e imagens. */
function contentLeaves(node: FigmaNodeInput, out: Leaf[] = []): Leaf[] {
  for (const child of node.children ?? []) {
    if (child.visible === false || !child.absoluteBoundingBox || isAnnotation(child)) continue;
    const box = child.absoluteBoundingBox;
    if (child.type === 'TEXT') {
      if (child.characters?.trim()) {
        const align = child.style?.textAlignHorizontal;
        const lh = child.style?.lineHeightPx && child.style.lineHeightPx < box.height + 0.5 ? child.style.lineHeightPx : box.height;
        out.push({
          box,
          text: true,
          centerY: box.y + lh / 2,
          centerYLast: box.y + box.height - lh / 2,
          endAligned: child.style?.textAutoResize === 'WIDTH_AND_HEIGHT' || align === 'RIGHT',
          startAligned: !align || align === 'LEFT' || child.style?.textAutoResize === 'WIDTH_AND_HEIGHT',
          align: child.style?.textAutoResize === 'WIDTH_AND_HEIGHT' || !align || align === 'LEFT' || align === 'JUSTIFIED' ? 'L' : align === 'RIGHT' ? 'R' : 'C',
        });
      }
      continue;
    }
    const isIcon =
      ['INSTANCE', 'COMPONENT', 'FRAME', 'GROUP'].includes(child.type) &&
      box.width <= ICON_MAX &&
      box.height <= ICON_MAX &&
      !hasTextDescendant(child);
    const hasImage = (child.fills ?? []).some((f) => f.visible !== false && f.type === 'IMAGE');
    if (isIcon || VECTOR_TYPES.has(child.type) || hasImage) {
      out.push({ box, text: false, centerY: box.y + box.height / 2, centerYLast: box.y + box.height / 2, startAligned: true, endAligned: true });
      continue;
    }
    contentLeaves(child, out);
  }
  return out;
}

/** Roxo #9747FF: a cor que o Figma e os kits de anotação usam para marcações do designer. */
const ANNOTATION_RGB = { r: 0x97 / 255, g: 0x47 / 255, b: 0xff / 255 };
const ANNOTATION_NAME = /^(?:(?:annotation|annot|redline|red line|spec|measure|measurement|spacing|note|sticky)\b|dot\s*·)/i;

function isAnnotationPaint(p: FigmaPaint): boolean {
  if (p.visible === false || p.type !== 'SOLID' || !p.color) return false;
  const c = p.color;
  return Math.abs(c.r - ANNOTATION_RGB.r) < 0.02 && Math.abs(c.g - ANNOTATION_RGB.g) < 0.02 && Math.abs(c.b - ANNOTATION_RGB.b) < 0.02;
}

/** Anotação do designer por cima do layout (contorno roxo, "Dot ·", "Redline"…): não é tela e não entra na spec. */
export function isAnnotation(node: FigmaNodeInput): boolean {
  if (node.type === 'TEXT') return false;
  if (ANNOTATION_NAME.test(node.name.trim())) return true;
  return [...(node.strokes ?? []), ...(node.fills ?? [])].some(isAnnotationPaint);
}

/**
 * O conteúdo começa pela esquerda? Com auto-layout centralizado, à direita ou espalhado, a distância até a borda
 * esquerda depende do tamanho do conteúdo (texto, contador) e não é um padding.
 */
export function startsAtLeft(node: FigmaNodeInput): boolean {
  if (node.layoutMode === 'HORIZONTAL') return !node.primaryAxisAlignItems || node.primaryAxisAlignItems === 'MIN';
  if (node.layoutMode === 'VERTICAL') return !node.counterAxisAlignItems || node.counterAxisAlignItems === 'MIN';
  return true;
}

/**
 * O conteúdo termina num lugar definido pelo Figma à direita? Caixa que abraça o conteúdo (Hug), auto-layout
 * horizontal espalhado (space-between) ou alinhado ao fim, ou vertical alinhado à direita. Numa caixa de largura fixa
 * com conteúdo à esquerda, o espaço da direita depende do tamanho do texto e não é padding.
 */
export function endsAtRight(node: FigmaNodeInput): boolean {
  if (node.layoutMode === 'HORIZONTAL') {
    return node.layoutSizingHorizontal === 'HUG' || node.primaryAxisAlignItems === 'SPACE_BETWEEN' || node.primaryAxisAlignItems === 'MAX';
  }
  if (node.layoutMode === 'VERTICAL') return node.layoutSizingHorizontal === 'HUG' || node.counterAxisAlignItems === 'MAX';
  return false;
}

/** O mesmo embaixo: caixa que abraça a altura, auto-layout vertical espalhado/no fim, ou horizontal alinhado embaixo. */
export function endsAtBottom(node: FigmaNodeInput): boolean {
  if (node.layoutMode === 'VERTICAL') {
    return node.layoutSizingVertical === 'HUG' || node.primaryAxisAlignItems === 'SPACE_BETWEEN' || node.primaryAxisAlignItems === 'MAX';
  }
  if (node.layoutMode === 'HORIZONTAL') return node.layoutSizingVertical === 'HUG' || node.counterAxisAlignItems === 'MAX';
  return false;
}

/** Nome-base de um item de lista: "Table Line 3" e "Table Line (2)" viram "table line". */
export function listStem(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s_-]*\d+$/, '')
    .trim();
}

/** Nomes que o Figma dá sozinho às camadas: irmãos com esses nomes não são, por si, itens de uma lista. */
const GENERIC_LAYER_NAMES = new Set(['frame', 'group', 'rectangle', 'ellipse', 'vector', 'component', 'instance', 'section', 'container', 'div']);

/**
 * Ordem em que os irmãos aparecem na tela: de cima para baixo e, na mesma altura, da esquerda para a direita.
 * A ordem das camadas não serve: fora do auto-layout é a de empilhamento (uma linha duplicada vai para cima na lista
 * de camadas) e no auto-layout em grade cada filho pode estar em qualquer célula.
 */
export function visualOrder<T extends { absoluteBoundingBox?: { x: number; y: number } | null }>(nodes: T[]): T[] {
  return orderByLines(nodes, (n) => n.absoluteBoundingBox);
}

/** Linha fina (divisória) ou forma do tamanho da caixa (fundo): não é conteúdo para medir espaço interno. */
export function isDividerOrBackdrop(
  leaf: { width: number; height: number },
  box: { width: number; height: number },
): boolean {
  // Fundo é o que cobre a caixa inteira (largura e altura); um banner de imagem da largura toda é conteúdo.
  return leaf.width <= 2 || leaf.height <= 2 || (leaf.height >= box.height * 0.9 && leaf.width >= box.width * 0.9);
}

function toRelativeRect(
  box: { x: number; y: number; width: number; height: number } | null | undefined,
  origin: { x: number; y: number },
): Rect | null {
  if (!box) return null;
  return {
    x: Math.round(box.x - origin.x),
    y: Math.round(box.y - origin.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

export function convertFigmaNodeToSpec(
  rootNode: FigmaNodeInput,
  options: { url: string; fileKey: string; nodeId: string; includeContainers?: boolean },
): FigmaSpec {
  const rootBox = rootNode.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };
  const figmaFrame = { width: Math.round(rootBox.width), height: Math.round(rootBox.height) };
  const origin = { x: rootBox.x, y: rootBox.y };
  const regions: SpecRegion[] = [];
  const usedNames = new Map<string, number>();

  const uniqueName = (raw: string): string => {
    const base = raw.trim() || 'Region';
    const count = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  };

  // Textos repetidos com o mesmo estilo (linhas de tabela, itens de lista) entram só nas primeiras vezes.
  const styleCount = new Map<string, number>();
  const MAX_SAME_STYLE = 3;
  const MAX_REGIONS = 250;

  type Flow = { vertical: boolean; horizontal: boolean };
  // O espaço entre irmãos é o gap do auto-layout, a não ser que ele espalhe os itens (space-between).
  const flowOf = (node: FigmaNodeInput, parent: Flow): Flow => {
    const fixedMain = node.primaryAxisAlignItems !== 'SPACE_BETWEEN';
    if (node.layoutMode === 'VERTICAL') return { vertical: fixedMain, horizontal: parent.horizontal };
    if (node.layoutMode === 'HORIZONTAL') return { vertical: parent.vertical, horizontal: fixedMain };
    return parent;
  };

  const walk = (node: FigmaNodeInput, isRoot: boolean, flow: Flow = { vertical: true, horizontal: true }, parent?: FigmaNodeInput) => {
    if (node.visible === false) return;
    if (!isRoot && isAnnotation(node)) return;
    if (regions.length >= MAX_REGIONS) return;

    if (node.type === 'TEXT' && node.characters?.trim()) {
      const text = node.characters.trim();
      const expect = buildTextExpect(node);
      const signature = JSON.stringify({ ...expect, text: undefined });
      const seen = styleCount.get(signature) ?? 0;
      styleCount.set(signature, seen + 1);
      if (seen >= MAX_SAME_STYLE) return;
      if (Object.keys(expect).length > 0) {
        const align = node.style?.textAlignHorizontal;
        regions.push({
          name: uniqueName(node.name || text.slice(0, 32)),
          selector: '*',
          matchMode: 'deepest',
          hasText: text,
          textMatch: 'exact',
          ifMissing: 'warn',
          autoWidth: node.style?.textAutoResize === 'WIDTH_AND_HEIGHT',
          fixedGap: flow,
          startAligned: !align || align === 'LEFT',
          figmaNode: node.id,
          figmaRect: toRelativeRect(node.absoluteBoundingBox, origin),
          expect,
        });
      }
      return;
    }

    const isContainer = ['FRAME', 'COMPONENT', 'INSTANCE', 'RECTANGLE', 'SECTION'].includes(node.type);
    if ((isRoot || options.includeContainers) && isContainer) {
      const expect = buildContainerExpect(node);
      // Só vira regra a caixa que desenha algo (fundo, borda, raio, sombra, padding ou espaçamento).
      const visualKeys = Object.keys(expect).filter((k) => k !== 'width' && k !== 'height');
      const signature = `box:${JSON.stringify({ ...expect, width: undefined, height: undefined })}`;
      const seen = styleCount.get(signature) ?? 0;
      if (isRoot ? Object.keys(expect).length > 1 : visualKeys.length > 0 && seen < MAX_SAME_STYLE) {
        if (!isRoot) styleCount.set(signature, seen + 1);
        // Espaço interno visual: da borda da caixa até o primeiro conteúdo (em cima e à esquerda).
        // Caixas da largura da página dependem do menu do host e ficam de fora.
        const nb = node.absoluteBoundingBox;
        if (!isRoot && nb && nb.width < figmaFrame.width * 0.95) {
          const leaves = contentLeaves(node).filter(
            (l) =>
              l.box.x >= nb.x - 0.5 &&
              l.box.y >= nb.y - 0.5 &&
              l.box.x + l.box.width <= nb.x + nb.width + 0.5 &&
              (l.text || !isDividerOrBackdrop(l.box, nb)),
          );
          if (leaves.length) {
            // O primeiro conteúdo é o de centro mais alto; a medida na tela compara esse centro (sem a entrelinha).
            const first = leaves.reduce((a, b) => (b.centerY < a.centerY ? b : a));
            expect.contentInsetTop = Math.round((first.box.y - nb.y) * 100) / 100;
            expect.contentCenterTop = Math.round((first.centerY - nb.y) * 100) / 100;
            const starts = leaves.filter((l) => l.startAligned);
            if (starts.length && startsAtLeft(node)) expect.contentInsetLeft = Math.round((Math.min(...starts.map((l) => l.box.x)) - nb.x) * 100) / 100;
            // Direita e embaixo: só onde o Figma define onde o conteúdo termina, e só se o último conteúdo termina
            // num lugar fixo (texto de largura fixa alinhado à esquerda termina onde o texto acabar).
            const right = leaves.reduce((a, b) => (b.box.x + b.box.width > a.box.x + a.box.width ? b : a));
            if (endsAtRight(node) && right.endAligned) {
              expect.contentInsetRight = Math.round((nb.x + nb.width - (right.box.x + right.box.width)) * 100) / 100;
            }
            const within = leaves.filter((l) => l.box.y + l.box.height <= nb.y + nb.height + 0.5);
            if (endsAtBottom(node) && within.length) {
              const last = within.reduce((a, b) => (b.centerYLast > a.centerYLast ? b : a));
              expect.contentInsetBottom = Math.round((nb.y + nb.height - (last.box.y + last.box.height)) * 100) / 100;
              expect.contentCenterBottom = Math.round((nb.y + nb.height - last.centerYLast) * 100) / 100;
            }
          }
        }
        // Onde ficam os textos dentro da caixa: com dado de exemplo diferente, o mesmo componente tem os textos nos mesmos lugares.
        const slots =
          !isRoot && nb
            ? contentLeaves(node)
                .filter((l) => l.text && l.box.x >= nb.x - 0.5 && l.box.y >= nb.y - 0.5 && l.box.x + l.box.width <= nb.x + nb.width + 0.5 && l.box.y + l.box.height <= nb.y + nb.height + 0.5)
                .slice(0, 12)
                .map((l) => ({
                  x: Math.round((l.box.x - nb.x) * 10) / 10,
                  right: Math.round((l.box.x + l.box.width - nb.x) * 10) / 10,
                  cy: Math.round((l.centerY - nb.y) * 10) / 10,
                  align: l.align ?? ('L' as const),
                }))
            : [];
        regions.push({
          name: uniqueName(node.name),
          // Irmão numa lista (mesmo pai, mesmo nome-base, ex.: "Table Line 1…6"): a tela casa essas caixas pela ordem.
          ...(() => {
            if (isRoot || !parent) return {};
            const stem = listStem(node.name);
            // Nome padrão do Figma ("Frame 4521", "Group 12") só é lista dentro de um auto-layout; fora dele são blocos soltos.
            if (!stem || (GENERIC_LAYER_NAMES.has(stem) && !parent.layoutMode)) return {};
            const siblings = (parent.children ?? []).filter((c) => c.visible !== false && listStem(c.name) === stem && c.type === node.type);
            if (siblings.length < 2) return {};
            return { listGroup: `${parent.id}::${stem}`, listIndex: visualOrder(siblings).indexOf(node) };
          })(),
          selector: isRoot ? 'main, #root > *, body > *' : '*',
          ...(slots.length ? { boxTextSlots: slots } : {}),
          ...(isRoot ? {} : { matchMode: 'rect' as const, ifMissing: 'warn' as const, fixedGap: flow }),
          ...(() => {
            const texts = isRoot ? [] : descendantTexts(node);
            const distinct = [...new Set(texts)].slice(0, 12);
            return {
              ...(texts.length === 1 ? { boxLabel: texts[0] } : {}),
              ...(texts.length ? { boxHasText: true } : {}),
              ...(distinct.length > 1 ? { boxTexts: distinct } : {}),
            };
          })(),
          figmaNode: node.id,
          figmaRect: toRelativeRect(node.absoluteBoundingBox, origin),
          expect,
        });
      }
    }

    const childFlow = flowOf(node, flow);
    for (const child of node.children ?? []) {
      walk(child, false, childFlow, node);
    }
  };

  walk(rootNode, true);

  const figmaLeaves = contentLeaves(rootNode)
    .map((l) => {
      const r = toRelativeRect(l.box, origin);
      return r ? { ...r, ...(l.text ? { text: true } : {}) } : null;
    })
    .filter((r): r is Rect & { text?: boolean } => Boolean(r));

  return {
    name: rootNode.name || 'Figma Frame',
    figma: { url: options.url, fileKey: options.fileKey, nodeId: options.nodeId },
    viewport: figmaFrame,
    figmaFrame,
    regions,
    checkSpacing: true,
    figmaLeaves,
  };
}
