import { classifyVisibility, type Visibility } from '../engine/compare.ts';
import type { CheckResult, CheckStatus } from '../engine/types.ts';
import type { Locale } from '../i18n/types.ts';

export type PropertyCategory = 'color' | 'typography' | 'spacing' | 'border' | 'layout' | 'other';

export interface DisplayCheckRow {
  key: string;
  property: string;
  codeTag: string;
  friendlyLabel: string;
  category: PropertyCategory;
  status: CheckStatus;
  expected: string;
  actual: string;
  delta?: string;
  note?: string;
  groupedCount: number;
  visibility?: Visibility;
}

const PROPERTY_LABELS: Record<string, { pt: string; en: string }> = {
  color: { pt: 'Cor do texto', en: 'Text color' },
  backgroundColor: { pt: 'Cor de fundo', en: 'Background color' },
  fontSize: { pt: 'Tamanho da fonte', en: 'Font size' },
  fontWeight: { pt: 'Peso da fonte', en: 'Font weight' },
  fontFamily: { pt: 'Família da fonte', en: 'Font family' },
  lineHeight: { pt: 'Altura da linha', en: 'Line height' },
  letterSpacing: { pt: 'Espaçamento entre letras', en: 'Letter spacing' },
  text: { pt: 'Texto exibido', en: 'Displayed text' },
  textAlign: { pt: 'Alinhamento do texto', en: 'Text alignment' },
  textTransform: { pt: 'Maiúsculas / minúsculas', en: 'Text case transform' },
  textDecoration: { pt: 'Decoração do texto', en: 'Text decoration' },
  textDecorationLine: { pt: 'Decoração do texto', en: 'Text decoration' },
  fontStyle: { pt: 'Estilo da fonte', en: 'Font style' },
  whiteSpace: { pt: 'Quebra de linha', en: 'White space' },
  textOverflow: { pt: 'Reticências no texto', en: 'Text overflow' },
  width: { pt: 'Largura', en: 'Width' },
  height: { pt: 'Altura', en: 'Height' },
  minWidth: { pt: 'Largura mínima', en: 'Minimum width' },
  maxWidth: { pt: 'Largura máxima', en: 'Maximum width' },
  minHeight: { pt: 'Altura mínima', en: 'Minimum height' },
  maxHeight: { pt: 'Altura máxima', en: 'Maximum height' },
  paddingTop: { pt: 'Espaçamento interno superior', en: 'Top inner padding' },
  paddingRight: { pt: 'Espaçamento interno direito', en: 'Right inner padding' },
  paddingBottom: { pt: 'Espaçamento interno inferior', en: 'Bottom inner padding' },
  paddingLeft: { pt: 'Espaçamento interno esquerdo', en: 'Left inner padding' },
  marginTop: { pt: 'Margem superior', en: 'Top margin' },
  marginRight: { pt: 'Margem direita', en: 'Right margin' },
  marginBottom: { pt: 'Margem inferior', en: 'Bottom margin' },
  marginLeft: { pt: 'Margem esquerda', en: 'Left margin' },
  rowGap: { pt: 'Espaço vertical entre itens', en: 'Vertical gap' },
  columnGap: { pt: 'Espaço horizontal entre itens', en: 'Horizontal gap' },
  gap: { pt: 'Espaço entre itens', en: 'Gap between items' },
  spaceAbove: { pt: 'Espaço acima (gap)', en: 'Space above (gap)' },
  spaceLeft: { pt: 'Espaço à esquerda (gap)', en: 'Space to the left (gap)' },
  borderTopLeftRadius: { pt: 'Arredondamento superior esquerdo', en: 'Top-left corner radius' },
  borderTopRightRadius: { pt: 'Arredondamento superior direito', en: 'Top-right corner radius' },
  borderBottomRightRadius: { pt: 'Arredondamento inferior direito', en: 'Bottom-right corner radius' },
  borderBottomLeftRadius: { pt: 'Arredondamento inferior esquerdo', en: 'Bottom-left corner radius' },
  borderRadius: { pt: 'Arredondamento dos cantos', en: 'Corner radius' },
  borderTopWidth: { pt: 'Espessura da borda superior', en: 'Top border width' },
  borderRightWidth: { pt: 'Espessura da borda direita', en: 'Right border width' },
  borderBottomWidth: { pt: 'Espessura da borda inferior', en: 'Bottom border width' },
  borderLeftWidth: { pt: 'Espessura da borda esquerda', en: 'Left border width' },
  borderTopColor: { pt: 'Cor da borda superior', en: 'Top border color' },
  borderRightColor: { pt: 'Cor da borda direita', en: 'Right border color' },
  borderBottomColor: { pt: 'Cor da borda inferior', en: 'Bottom border color' },
  borderLeftColor: { pt: 'Cor da borda esquerda', en: 'Left border color' },
  borderTopStyle: { pt: 'Estilo da borda superior', en: 'Top border style' },
  borderRightStyle: { pt: 'Estilo da borda direita', en: 'Right border style' },
  borderBottomStyle: { pt: 'Estilo da borda inferior', en: 'Bottom border style' },
  borderLeftStyle: { pt: 'Estilo da borda esquerda', en: 'Left border style' },
  boxShadow: { pt: 'Sombra', en: 'Drop shadow' },
  opacity: { pt: 'Opacidade / transparência', en: 'Opacity' },
  display: { pt: 'Tipo de exibição', en: 'Layout display' },
  flexDirection: { pt: 'Direção do layout', en: 'Layout direction' },
  flexWrap: { pt: 'Quebra de linha no flex', en: 'Flex wrap' },
  overflow: { pt: 'Transbordamento', en: 'Overflow' },
  justifyContent: { pt: 'Distribuição principal', en: 'Main-axis alignment' },
  alignItems: { pt: 'Alinhamento cruzado', en: 'Cross-axis alignment' },
  alignSelf: { pt: 'Alinhamento próprio', en: 'Self alignment' },
  fill: { pt: 'Cor de preenchimento', en: 'Fill color' },
  stroke: { pt: 'Cor do contorno', en: 'Stroke color' },
  outlineColor: { pt: 'Cor do contorno externo', en: 'Outline color' },
  count: { pt: 'Quantidade de itens', en: 'Element count' },
  exists: { pt: 'Presença na tela', en: 'Presence on screen' },
  element: { pt: 'Elemento na tela', en: 'Element on screen' },
  visible: { pt: 'Visibilidade', en: 'Visibility' },
  placeholder: { pt: 'Texto de exemplo do campo', en: 'Input placeholder' },
  value: { pt: 'Valor do campo', en: 'Field value' },
  objectFit: { pt: 'Ajuste da imagem', en: 'Image fit' },
  zIndex: { pt: 'Ordem de camada', en: 'Layer order' },
  position: { pt: 'Posição na tela', en: 'Screen position' },
  x: { pt: 'Posição horizontal (X)', en: 'Horizontal position (X)' },
  y: { pt: 'Posição vertical (Y)', en: 'Vertical position (Y)' },
  contentInsetTop: { pt: 'Recuo superior do conteúdo', en: 'Top content inset' },
  contentInsetLeft: { pt: 'Recuo esquerdo do conteúdo', en: 'Left content inset' },
  contentInsetRight: { pt: 'Recuo direito do conteúdo', en: 'Right content inset' },
  contentInsetBottom: { pt: 'Recuo inferior do conteúdo', en: 'Bottom content inset' },
  contentCenterTop: { pt: 'Alinhamento vertical do conteúdo', en: 'Vertical content center' },
};

const COLOR_PROPS = new Set([
  'color',
  'backgroundColor',
  'fill',
  'stroke',
  'outlineColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderColor',
  'opacity',
]);

const TYPOGRAPHY_PROPS = new Set([
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'text',
  'textAlign',
  'textTransform',
  'textDecoration',
  'textDecorationLine',
  'whiteSpace',
  'textOverflow',
  'placeholder',
  'value',
]);

const SPACING_PROPS = new Set([
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'padding',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'margin',
  'rowGap',
  'columnGap',
  'gap',
  'spaceAbove',
  'spaceLeft',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'x',
  'y',
  'position',
  'contentInsetTop',
  'contentInsetLeft',
  'contentCenterTop',
  'contentInsetRight',
  'contentInsetBottom',
  'contentCenterBottom',
]);

const BORDER_PROPS = new Set([
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'borderRadius',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderStyle',
  'boxShadow',
]);

const LAYOUT_PROPS = new Set([
  'display',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'overflow',
  'objectFit',
  'zIndex',
  'count',
  'exists',
  'element',
  'visible',
]);

export function getPropertyCategory(property: string): PropertyCategory {
  if (COLOR_PROPS.has(property)) return 'color';
  if (TYPOGRAPHY_PROPS.has(property)) return 'typography';
  if (SPACING_PROPS.has(property)) return 'spacing';
  if (BORDER_PROPS.has(property)) return 'border';
  if (LAYOUT_PROPS.has(property)) return 'layout';
  return 'other';
}

export function getFriendlyPropertyLabel(property: string, locale: Locale): string {
  const entry = PROPERTY_LABELS[property];
  if (entry) return entry[locale];
  const spaced = property
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!spaced) return property;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

interface BoxGroupSpec {
  codeTag: string;
  members: readonly [string, string, string, string];
  label: { pt: string; en: string };
  category: PropertyCategory;
}

const BOX_GROUPS: readonly BoxGroupSpec[] = [
  {
    codeTag: 'padding',
    members: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
    label: { pt: 'Espaçamento interno (4 lados)', en: 'Inner padding (all 4 sides)' },
    category: 'spacing',
  },
  {
    codeTag: 'margin',
    members: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
    label: { pt: 'Margem externa (4 lados)', en: 'Outer margin (all 4 sides)' },
    category: 'spacing',
  },
  {
    codeTag: 'borderRadius',
    members: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
    label: { pt: 'Arredondamento (4 cantos)', en: 'Corner radius (all 4 corners)' },
    category: 'border',
  },
  {
    codeTag: 'borderWidth',
    members: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
    label: { pt: 'Espessura da borda (4 lados)', en: 'Border width (all 4 sides)' },
    category: 'border',
  },
  {
    codeTag: 'borderColor',
    members: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
    label: { pt: 'Cor da borda (4 lados)', en: 'Border color (all 4 sides)' },
    category: 'color',
  },
  {
    codeTag: 'borderStyle',
    members: ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'],
    label: { pt: 'Estilo da borda (4 lados)', en: 'Border style (all 4 sides)' },
    category: 'border',
  },
];

const PROP_TO_GROUP = new Map<string, BoxGroupSpec>(
  BOX_GROUPS.flatMap((group) => group.members.map((m) => [m, group] as const)),
);

function signatureOf(r: CheckResult): string {
  return `${r.status}\u0000${r.expected}\u0000${r.actual}\u0000${r.delta ?? ''}\u0000${r.note ?? ''}`;
}

export function groupRegionResults(results: CheckResult[], locale: Locale): DisplayCheckRow[] {
  const byProp = new Map<string, CheckResult[]>();
  for (const item of results) {
    const bucket = byProp.get(item.property);
    if (bucket) bucket.push(item);
    else byProp.set(item.property, [item]);
  }

  const collapsible = new Set<BoxGroupSpec>();
  for (const group of BOX_GROUPS) {
    const items = group.members.map((m) => byProp.get(m));
    if (items.every((list) => list && list.length === 1)) {
      const sig = signatureOf(items[0]![0]);
      if (items.every((list) => signatureOf(list![0]) === sig)) {
        collapsible.add(group);
      }
    }
  }

  const emittedGroups = new Set<BoxGroupSpec>();
  const rows: DisplayCheckRow[] = [];

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const group = PROP_TO_GROUP.get(item.property);
    if (group && collapsible.has(group)) {
      if (emittedGroups.has(group)) continue;
      emittedGroups.add(group);
      rows.push({
        key: `group-${group.codeTag}-${i}`,
        property: group.codeTag,
        codeTag: group.codeTag,
        friendlyLabel: group.label[locale],
        category: group.category,
        status: item.status,
        expected: item.expected,
        actual: item.actual,
        delta: item.delta,
        note: item.note,
        visibility: item.status === 'fail' ? (item.visibility ?? classifyVisibility(item)) : undefined,
        groupedCount: 4,
      });
      continue;
    }

    rows.push({
      key: `${item.property}-${i}`,
      property: item.property,
      codeTag: item.property,
      friendlyLabel: getFriendlyPropertyLabel(item.property, locale),
      category: getPropertyCategory(item.property),
      status: item.status,
      expected: item.expected,
      actual: item.actual,
      delta: item.delta,
      note: item.note,
      visibility: item.status === 'fail' ? (item.visibility ?? classifyVisibility(item)) : undefined,
      groupedCount: 1,
    });
  }

  return rows;
}

const DELTA_E_RE = /^ΔE\s*([0-9]+(?:[.,][0-9]+)?)$/i;
const SIZE_DELTA_RE = /^([+-])([0-9]+(?:[.,][0-9]+)?)(px|%)$/i;

export function formatFriendlyDelta(delta: string | undefined, locale: Locale): string | null {
  if (!delta) return null;
  const trimmed = delta.trim();
  if (!trimmed) return null;

  const deMatch = DELTA_E_RE.exec(trimmed);
  if (deMatch) {
    const num = Number(deMatch[1].replace(',', '.'));
    if (Number.isFinite(num)) {
      if (num < 3) {
        return locale === 'pt' ? `diferença sutil (ΔE ${deMatch[1]})` : `subtle tint diff (ΔE ${deMatch[1]})`;
      }
      if (num < 10) {
        return locale === 'pt' ? `tom diferente (ΔE ${deMatch[1]})` : `noticeable shade diff (ΔE ${deMatch[1]})`;
      }
      return locale === 'pt' ? `cor bem diferente (ΔE ${deMatch[1]})` : `clear color diff (ΔE ${deMatch[1]})`;
    }
  }

  const sizeMatch = SIZE_DELTA_RE.exec(trimmed);
  if (sizeMatch) {
    const [, sign, num, unit] = sizeMatch;
    if (sign === '-') return locale === 'pt' ? `${num}${unit} menor` : `${num}${unit} smaller`;
    return locale === 'pt' ? `${num}${unit} maior` : `${num}${unit} larger`;
  }

  return trimmed;
}

const COLOR_RE = /rgba?\(\s*[^)]+\s*\)|#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/;
const ALPHA_TAG_RE = /^#([0-9a-fA-F]{6})\s*@([\d.]+)$/;

export function extractCssColor(value: string | undefined | null): string | null {
  if (!value) return null;
  const alphaMatch = ALPHA_TAG_RE.exec(value.trim());
  if (alphaMatch) {
    const hex = alphaMatch[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alphaMatch[2]})`;
  }
  const match = COLOR_RE.exec(value);
  return match ? match[0] : null;
}

export function formatShortUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const full = `${parsed.host}${path}`;
    if (full.length <= 48) return full;
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 3) {
      const compact = `${parsed.host}/${segments[0]}/…/${segments[segments.length - 1]}`;
      if (compact.length <= 54) return compact;
    }
    return `${full.slice(0, 45)}…`;
  } catch {
    return trimmed;
  }
}
