export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  relX?: number;
  relY?: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface ToleranceConfig {
  size: number;
  position: number;
  spacing: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  radius: number;
  borderWidth: number;
  color: number;
  alpha: number;
  opacity: number;
  shadow: number;
}

export type BoxShorthand =
  | number
  | [number]
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | { top?: number; right?: number; bottom?: number; left?: number };

export type ColorBoxShorthand =
  | string
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string]
  | { top?: string; right?: string; bottom?: string; left?: string };

export interface GapExpect {
  row?: number;
  column?: number;
}

export interface RegionExpect {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** Espaço visual da borda de cima da caixa até o primeiro conteúdo (texto, ícone, imagem). */
  contentInsetTop?: number;
  /** Espaço visual da borda esquerda da caixa até o primeiro conteúdo. */
  /** Da borda direita da caixa até o fim do último conteúdo (só onde o Figma define o fim). */
  contentInsetRight?: number;
  /** Da borda de baixo da caixa até o fim do último conteúdo, e até o centro da última linha. */
  contentInsetBottom?: number;
  contentCenterBottom?: number;
  contentInsetLeft?: number;
  /** Centro da primeira linha do primeiro conteúdo, a partir da borda de cima (para medir sem a entrelinha). */
  contentCenterTop?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  padding?: BoxShorthand;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  margin?: BoxShorthand;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  gap?: number | GapExpect;
  backgroundColor?: string;
  color?: string;
  borderColor?: ColorBoxShorthand;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  outlineColor?: string;
  fill?: string;
  stroke?: string;
  borderWidth?: BoxShorthand;
  borderRadius?: BoxShorthand;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textAlign?: string;
  textTransform?: string;
  textDecorationLine?: string;
  fontStyle?: string;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  whiteSpace?: string;
  overflow?: string;
  textOverflow?: string;
  cursor?: string;
  opacity?: number;
  boxShadow?: string;
  text?: string;
  placeholder?: string;
  value?: string;
  count?: number;
  visible?: boolean;
  [cssProperty: string]: unknown;
}

export interface BoxTextSlot {
  x: number;
  right: number;
  cy: number;
  align: 'L' | 'C' | 'R';
}

export interface SpecRegion {
  name: string;
  selector: string;
  /** 'rect': escolhe o elemento cuja caixa mais se sobrepõe ao figmaRect (usado para caixas da spec automática). */
  matchMode?: 'selector' | 'deepest' | 'rect';
  hasText?: string;
  /** 'contains' (padrão) aceita o texto dentro de um texto maior; 'exact' exige o texto inteiro igual. */
  textMatch?: 'contains' | 'exact';
  /** O que fazer se o elemento não aparece na tela: 'fail' (padrão) ou 'warn' (ex.: dado de exemplo do Figma). */
  ifMissing?: 'fail' | 'warn';
  /** Texto do único rótulo dentro da caixa no Figma (badge, chip, botão): outro texto na tela = outro estado. */
  boxLabel?: string;
  /** A caixa do Figma tem algum texto dentro (uma caixa vazia na tela é outro estado). */
  boxHasText?: boolean;
  /** Textos dentro da caixa no Figma (até 12, sem repetir): confirmam que o elemento casado é a mesma caixa. */
  boxTexts?: string[];
  /** Caixa repetida numa lista do Figma (mesmo pai e nome-base) e a posição dela na lista: casada pela ordem. */
  listGroup?: string;
  listIndex?: number;
  /** Posição de cada texto dentro da caixa no Figma (relativa à caixa): começo, fim, centro da 1ª linha e alinhamento. */
  boxTextSlots?: BoxTextSlot[];
  /** Texto do Figma com largura automática (a caixa tem a largura do texto). */
  autoWidth?: boolean;
  /** Texto do Figma alinhado à esquerda (a borda esquerda da caixa é o começo do texto). */
  startAligned?: boolean;
  /** O espaço até o vizinho de cima/da esquerda é fixo no Figma (não depende do tamanho do conteúdo). */
  fixedGap?: { vertical: boolean; horizontal: boolean };
  index?: number;
  pseudo?: string;
  state?: string;
  figmaNode?: string;
  figmaRect?: Rect | null;
  tolerances?: Partial<ToleranceConfig>;
  expect: RegionExpect;
}

export interface FigmaReferenceMeta {
  url?: string;
  fileKey?: string;
  nodeId?: string;
}

export interface FigmaSpec {
  name?: string;
  figma?: FigmaReferenceMeta;
  url?: string;
  viewport?: Dimensions;
  figmaFrame?: Dimensions | null;
  root?: string;
  precision?: number;
  tolerances?: Partial<ToleranceConfig>;
  regions: SpecRegion[];
  /** Spec automática: confere também o espaço entre elementos vizinhos (medido na tela, não no CSS). */
  checkSpacing?: boolean;
  /** Caixas de todo conteúdo visível do frame (textos, ícones, imagens), relativas ao frame. */
  /** Conteúdo do frame (textos, ícones, imagens), relativo ao frame; `text` marca os textos. */
  figmaLeaves?: (Rect & { text?: boolean })[];
}

export interface MeasuredElement {
  found: boolean;
  count?: number;
  key?: string | null;
  rect?: Rect | null;
  style?: Record<string, string>;
  text?: string;
  placeholder?: string;
  value?: string;
  truncated?: boolean;
  visible?: boolean;
  fontLoaded?: boolean | null;
  /** Cor que aparece atrás do elemento quando o fundo dele é transparente (vem do ancestral). */
  effectiveBackground?: string | null;
  /** Caixa visual: para texto, a caixa das linhas com a entrelinha (como o Figma desenha). */
  visualRect?: Rect | null;
  /** Distância da borda da caixa até o primeiro conteúdo dentro dela. */
  contentInset?: { top: number | null; left: number | null; centerTop?: number | null; right?: number | null; bottom?: number | null; centerBottom?: number | null } | null;
  /** Elemento medido (só durante a medição; não vai para o relatório). */
  node?: unknown;
  /** devicePixelRatio da tela medida (bordas são desenhadas em pixels inteiros do dispositivo). */
  dpr?: number;
  /** O texto existe na tela, mas só longe de onde o Figma o desenha. */
  elsewhere?: boolean;
  /** A caixa existe no lugar, mas mostra outro rótulo (outro estado ou dado de exemplo). */
  otherContent?: boolean;
  /** Os textos da caixa do Figma estão em outro lugar da tela, não na caixa casada pela posição. */
  contentElsewhere?: boolean;
  /** Como o elemento foi confirmado: pelo texto, pelo conteúdo da caixa ou só pela posição. */
  matchedBy?: MatchedBy;
  error?: string;
}

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckResult {
  property: string;
  expected: string;
  actual: string;
  delta?: string;
  status: CheckStatus;
  note?: string;
  visibility?: 'visible' | 'css';
}

/**
 * Como o elemento da tela foi ligado ao do Figma.
 * text: mesmo texto; content: a caixa tem os mesmos textos dentro; label: mesmo rótulo;
 * shape: caixa sem texto, casada pela posição e pelo tamanho;
 * layout: texto de exemplo diferente, mas cada texto do Figma está no mesmo lugar dentro da caixa (mesmo componente);
 * order: item de lista casado pela ordem (a linha N do Figma é a N-ésima linha da tela, contando da primeira confirmada).
 */
export interface MatchedBy {
  by: 'text' | 'content' | 'label' | 'shape' | 'layout' | 'order';
  found?: number;
  total?: number;
}

export interface RegionReport {
  name: string;
  selector: string;
  state?: string;
  figmaNode?: string;
  figmaRect?: Rect | null;
  count?: number;
  key?: string | null;
  rect?: Rect | null;
  matchedBy?: MatchedBy | null;
  /** Elemento que está na tela e não existe no Figma. */
  extra?: boolean;
  results: CheckResult[];
}

export interface ReportSummary {
  regions: number;
  checks: number;
  pass: number;
  fail: number;
  warn: number;
  score: number | null;
  failVisible?: number;
  failCss?: number;
  scoreVisible?: number | null;
}

export interface PendingState {
  name: string;
  selector: string;
  state: string;
}

export interface ValidationReport {
  generatedAt: string;
  url: string;
  viewport: { width: number; height: number; expectedWidth?: number };
  page: Dimensions;
  figmaFrame: Dimensions | null;
  figma?: FigmaReferenceMeta;
  precision?: number;
  rootFound: boolean | null;
  summary: ReportSummary;
  pendingStates: PendingState[];
  regions: RegionReport[];
  markdown?: string;
  next?: string;
}

export interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}

export interface FigmaEffect {
  type?: string;
  visible?: boolean;
  color?: { r: number; g: number; b: number; a?: number };
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercentFontSize?: number;
  textAlignHorizontal?: string;
  textAutoResize?: string;
  textCase?: string;
  italic?: boolean;
}

export interface FigmaNodeInput {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  style?: FigmaTypeStyle;
  effects?: FigmaEffect[];
  children?: FigmaNodeInput[];
}
