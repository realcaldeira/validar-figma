import { describe, expect, it } from 'vitest';
import { convertFigmaNodeToSpec, parseFigmaUrl, rgbaToHex } from './figmaParser.ts';
import type { FigmaNodeInput } from './types.ts';

describe('parseFigmaUrl', () => {
  it('extracts fileKey and nodeId from design, file, and proto URLs', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/abc123XYZ/My-App?node-id=101-202&m=dev'),
    ).toEqual({ fileKey: 'abc123XYZ', nodeId: '101:202' });

    expect(
      parseFigmaUrl('https://www.figma.com/file/key999/Screen?node-id=12%3A34'),
    ).toEqual({ fileKey: 'key999', nodeId: '12:34' });
  });

  it('uses the branch key for branch links (the frame changed in the branch only exists there)', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/MainKey123/branch/BranchKey456/Screens?node-id=4512-1098'),
    ).toEqual({ fileKey: 'BranchKey456', nodeId: '4512:1098' });
  });

  it('returns null for invalid or non-Figma URLs', () => {
    expect(parseFigmaUrl('https://example.com/design/abc?node-id=1-2')).toBeNull();
    expect(parseFigmaUrl('https://evilfigma.com/design/abc?node-id=1-2')).toBeNull();
    expect(parseFigmaUrl('javascript://figma.com/design/abc?node-id=1-2')).toBeNull();
    expect(parseFigmaUrl('https://www.figma.com/design/abc?node-id=%E0%A4%A')).toBeNull();
    expect(parseFigmaUrl('https://www.figma.com/design/abc?node-id=1%202')).toBeNull();
    expect(parseFigmaUrl('https://www.figma.com/design/abc')).toBeNull();
  });
});

describe('rgbaToHex', () => {
  it('converts opaque colors to hex and translucent colors to rgba', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe('#FFFFFF');
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)');
  });
});

describe('convertFigmaNodeToSpec', () => {
  it('creates text and optional container regions with relative figmaRect coordinates', () => {
    const node: FigmaNodeInput = {
      id: '1:1',
      name: 'Main Card',
      type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 200, width: 600, height: 300 },
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      cornerRadius: 12,
      children: [
        {
          id: '1:2',
          name: 'Heading',
          type: 'TEXT',
          characters: 'Hello World',
          absoluteBoundingBox: { x: 124, y: 224, width: 200, height: 28 },
          fills: [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.08, a: 1 } }],
          style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 600, lineHeightPx: 28 },
        },
      ],
    };

    const textOnly = convertFigmaNodeToSpec(node, {
      url: 'https://www.figma.com/design/abc/Test?node-id=1-1',
      fileKey: 'abc',
      nodeId: '1:1',
      includeContainers: false,
    });
    expect(textOnly.figmaFrame).toEqual({ width: 600, height: 300 });
    expect(textOnly.regions).toHaveLength(2);
    expect(textOnly.regions[1].matchMode).toBe('deepest');
    expect(textOnly.regions[1].figmaRect).toEqual({ x: 24, y: 24, width: 200, height: 28 });
    expect(textOnly.regions[1].expect.fontSize).toBe(20);
  });
});

describe('convertFigmaNodeToSpec (spec automática)', () => {
  const text = (id: string, characters: string, extra: Partial<FigmaNodeInput['style']> = {}): FigmaNodeInput => ({
    id,
    name: 'Text',
    type: 'TEXT',
    characters,
    absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 20 },
    style: { fontFamily: 'DM Sans', fontSize: 14, fontWeight: 400, textAlignHorizontal: 'CENTER', ...extra },
  });

  it('usa texto exato, aviso quando falta e no máximo 3 textos com o mesmo estilo', () => {
    const root: FigmaNodeInput = {
      id: '1:1',
      name: 'Tabela',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
      children: ['Ana', 'Bia', 'Caio', 'Duda', 'Edu'].map((n, i) => text(`2:${i}`, n)),
    };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1' });
    const texts = spec.regions.filter((r) => r.hasText);
    expect(texts.map((r) => r.hasText)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(texts.every((r) => r.textMatch === 'exact' && r.ifMissing === 'warn')).toBe(true);
  });

  it('ignora o alinhamento de caixas de texto com largura automática', () => {
    const root: FigmaNodeInput = {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
      children: [text('2:1', 'Auto', { textAutoResize: 'WIDTH_AND_HEIGHT' }), text('2:2', 'Fixo', { fontSize: 16 })],
    };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1' });
    const byText = Object.fromEntries(spec.regions.filter((r) => r.hasText).map((r) => [r.hasText, r.expect]));
    expect(byText.Auto.textAlign).toBeUndefined();
    expect(byText.Fixo.textAlign).toBe('center');
  });
});

describe('caixas na spec automática', () => {
  it('confere só o que aparece e o tamanho fixo; casa pela posição', () => {
    const root: FigmaNodeInput = {
      id: '1:1',
      name: 'Tela',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
      children: [
        {
          id: '2:1',
          name: 'Card',
          type: 'FRAME',
          absoluteBoundingBox: { x: 24, y: 40, width: 600, height: 123 },
          layoutMode: 'VERTICAL',
          layoutSizingHorizontal: 'FIXED',
          layoutSizingVertical: 'HUG',
          paddingTop: 24,
          itemSpacing: 16,
          cornerRadius: 16,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        },
        { id: '2:2', name: 'Só estrutura', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, paddingTop: 8 },
      ],
    };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true });
    const card = spec.regions.find((r) => r.name === 'Card')!;
    expect(card.matchMode).toBe('rect');
    expect(card.expect).toEqual({ width: 600, backgroundColor: '#FFFFFF', borderRadius: 16 });
    expect(spec.regions.some((r) => r.name === 'Só estrutura')).toBe(false);
  });
});

describe('rótulo único da caixa', () => {
  it('guarda o texto quando a caixa tem um rótulo só (badge, chip, botão)', () => {
    const badge = (id: string, label: string): FigmaNodeInput => ({
      id,
      name: 'Badge Status',
      type: 'FRAME',
      absoluteBoundingBox: { x: 10, y: 10, width: 90, height: 24 },
      cornerRadius: 12,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0.8, b: 0.6, a: 1 } }],
      children: [{ id: `${id}t`, name: 'Label', type: 'TEXT', characters: label, absoluteBoundingBox: { x: 16, y: 14, width: 70, height: 16 }, style: { fontSize: 12 } }],
    });
    const root: FigmaNodeInput = { id: '1:1', name: 'Tela', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 }, children: [badge('2:1', 'Under Review')] };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true });
    expect(spec.regions.find((r) => r.name === 'Badge Status')?.boxLabel).toBe('Under Review');
  });
});

describe('espaço interno visual no Figma', () => {
  it('mede da borda da caixa até o primeiro texto ou ícone', () => {
    const root: FigmaNodeInput = {
      id: '1:1',
      name: 'Tela',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
      children: [
        {
          id: '2:1',
          name: 'Card',
          type: 'FRAME',
          absoluteBoundingBox: { x: 100, y: 200, width: 600, height: 300 },
          cornerRadius: 16,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
          children: [
            {
              id: '3:1',
              name: 'Header',
              type: 'FRAME',
              absoluteBoundingBox: { x: 124, y: 224, width: 552, height: 40 },
              children: [
                { id: '4:1', name: 'Icon', type: 'INSTANCE', absoluteBoundingBox: { x: 124, y: 228, width: 24, height: 24 }, children: [{ id: '5:1', name: 'v', type: 'VECTOR', absoluteBoundingBox: { x: 127, y: 231, width: 18, height: 18 } }] },
                { id: '4:2', name: 'Title', type: 'TEXT', characters: 'Pending', absoluteBoundingBox: { x: 156, y: 224, width: 80, height: 28 }, style: { fontSize: 20 } },
              ],
            },
          ],
        },
      ],
    };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true });
    const card = spec.regions.find((r) => r.name === 'Card')!;
    expect(card.expect.contentInsetTop).toBe(24);
    expect(card.expect.contentInsetLeft).toBe(24);
    expect(spec.checkSpacing).toBe(true);
    expect(spec.figmaLeaves?.length).toBe(2);
  });
});

describe('padding esquerdo só quando o conteúdo começa pela esquerda', () => {
  it('não mede o padding esquerdo de uma caixa com conteúdo centralizado', async () => {
    const { startsAtLeft } = await import('./figmaParser.ts');
    const base = { id: '1', name: 'x', type: 'FRAME' };
    expect(startsAtLeft({ ...base, layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER' })).toBe(false);
    expect(startsAtLeft({ ...base, layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN' })).toBe(false);
    expect(startsAtLeft({ ...base, layoutMode: 'VERTICAL', counterAxisAlignItems: 'CENTER' })).toBe(false);
    expect(startsAtLeft({ ...base, layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'MIN' })).toBe(true);
    expect(startsAtLeft({ ...base, layoutMode: 'NONE' })).toBe(true);
  });
});

describe('anotações do designer', () => {
  it('ignora marcações roxas e camadas de anotação', async () => {
    const { isAnnotation } = await import('./figmaParser.ts');
    const roxo = { type: 'SOLID', color: { r: 0x97 / 255, g: 0x47 / 255, b: 1, a: 1 } };
    expect(isAnnotation({ id: '1', name: 'Dot · 2', type: 'FRAME' })).toBe(true);
    expect(isAnnotation({ id: '2', name: 'Frame 12', type: 'FRAME', strokes: [roxo] })).toBe(true);
    expect(isAnnotation({ id: '3', name: 'Card', type: 'FRAME', strokes: [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.08, a: 1 } }] })).toBe(false);
    const root: FigmaNodeInput = {
      id: '0',
      name: 'Tela',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 400 },
      children: [{ id: '9', name: 'Dot · 1', type: 'FRAME', strokes: [roxo], absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 }, children: [{ id: '10', name: 'nota', type: 'TEXT', characters: 'Padding 24', absoluteBoundingBox: { x: 12, y: 12, width: 60, height: 16 }, style: { fontSize: 12 } }] }],
    };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '0', includeContainers: true });
    expect(spec.regions.some((r) => r.hasText === 'Padding 24' || r.name.startsWith('Dot'))).toBe(false);
  });
});

describe('textos da caixa', () => {
  it('guarda os textos de dentro da caixa, sem repetir, para confirmar o casamento', () => {
    const text = (id: string, characters: string, y: number): FigmaNodeInput => ({
      id,
      name: characters,
      type: 'TEXT',
      characters,
      absoluteBoundingBox: { x: 20, y, width: 120, height: 16 },
      style: { fontSize: 14 },
    });
    const card: FigmaNodeInput = {
      id: '2:1',
      name: 'Card',
      type: 'FRAME',
      absoluteBoundingBox: { x: 10, y: 10, width: 300, height: 120 },
      cornerRadius: 16,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [text('2:2', 'Pending review', 20), text('2:3', 'Due date', 44), text('2:4', 'Due date', 68), text('2:5', '12', 92)],
    };
    const root: FigmaNodeInput = { id: '1:1', name: 'Tela', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 }, children: [card] };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true });
    const region = spec.regions.find((r) => r.name === 'Card');
    expect(region?.boxTexts).toEqual(['Pending review', 'Due date', '12']);
    expect(region?.boxLabel).toBeUndefined();
    expect(region?.boxTextSlots?.[0]).toEqual({ x: 10, right: 130, cy: 18, align: 'L' });
  });
});

describe('anotação dentro da caixa', () => {
  it('não entra nos textos da caixa nem no rótulo', () => {
    const card: FigmaNodeInput = {
      id: '2:1',
      name: 'Card',
      type: 'FRAME',
      absoluteBoundingBox: { x: 10, y: 10, width: 300, height: 120 },
      cornerRadius: 16,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [
        { id: '2:2', name: 'Title', type: 'TEXT', characters: 'Pending review', absoluteBoundingBox: { x: 20, y: 20, width: 120, height: 16 }, style: { fontSize: 14 } },
        {
          id: '2:3',
          name: 'Redline',
          type: 'FRAME',
          absoluteBoundingBox: { x: 10, y: 60, width: 60, height: 16 },
          children: [{ id: '2:4', name: 'Note', type: 'TEXT', characters: 'padding 24', absoluteBoundingBox: { x: 12, y: 60, width: 50, height: 16 }, style: { fontSize: 10 } }],
        },
      ],
    };
    const root: FigmaNodeInput = { id: '1:1', name: 'Tela', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 }, children: [card] };
    const spec = convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true });
    const region = spec.regions.find((r) => r.name === 'Card');
    expect(region?.boxLabel).toBe('Pending review');
    expect(region?.boxTexts).toBeUndefined();
  });
});

describe('espaço da direita e de baixo', () => {
  const text = (id: string, x: number, y: number, w: number, extra: Record<string, unknown> = {}): FigmaNodeInput => ({
    id,
    name: id,
    type: 'TEXT',
    characters: 'Texto',
    absoluteBoundingBox: { x, y, width: w, height: 20 },
    style: { fontSize: 14, lineHeightPx: 20, ...extra },
  });
  const icon = (id: string, x: number, y: number): FigmaNodeInput => ({ id, name: 'Icon', type: 'INSTANCE', absoluteBoundingBox: { x, y, width: 16, height: 16 }, children: [] });
  const spec = (box: FigmaNodeInput) =>
    convertFigmaNodeToSpec(
      { id: '1:1', name: 'Tela', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 400 }, children: [box] },
      { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true },
    ).regions.find((r) => r.name === 'Linha');

  it('mede onde o Figma define o fim (space-between, Hug)', () => {
    const row: FigmaNodeInput = {
      id: '2:1',
      name: 'Linha',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      layoutSizingVertical: 'HUG',
      absoluteBoundingBox: { x: 10, y: 10, width: 300, height: 44 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [text('2:2', 26, 22, 120), icon('2:3', 268, 24)],
    };
    const r = spec(row);
    expect(r?.expect?.contentInsetRight).toBe(26);
    expect(r?.expect?.contentInsetBottom).toBe(12);
    expect(r?.expect?.contentCenterBottom).toBe(22);
  });

  it('não mede a direita quando o fim depende do tamanho do texto', () => {
    const row: FigmaNodeInput = {
      id: '2:1',
      name: 'Linha',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'MIN',
      layoutSizingHorizontal: 'FIXED',
      absoluteBoundingBox: { x: 10, y: 10, width: 300, height: 44 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [text('2:2', 26, 22, 200, { textAlignHorizontal: 'LEFT', textAutoResize: 'HEIGHT' })],
    };
    expect(spec(row)?.expect?.contentInsetRight).toBeUndefined();
    expect(spec(row)?.expect?.contentInsetBottom).toBeUndefined();
  });
});

describe('itens de lista', () => {
  const row = (id: string, name: string, y: number): FigmaNodeInput => ({
    id,
    name,
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y, width: 600, height: 44 },
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
  });
  const frame = (children: FigmaNodeInput[], layoutMode?: 'VERTICAL'): FigmaNodeInput => ({
    id: '1:1',
    name: 'Tela',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
    children: [{ id: '2:0', name: 'Tabela', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 132 }, ...(layoutMode ? { layoutMode } : {}), children }],
  });
  const indexes = (root: FigmaNodeInput) =>
    Object.fromEntries(
      convertFigmaNodeToSpec(root, { url: 'u', fileKey: 'k', nodeId: '1:1', includeContainers: true })
        .regions.filter((r) => r.listGroup)
        .map((r) => [r.name, r.listIndex]),
    );

  it('fora do auto-layout, a ordem é a posição na tela, não a das camadas', () => {
    const root = frame([row('3:1', 'Row 1', 0), row('3:3', 'Row 3', 88), row('3:2', 'Row 2', 44)]);
    expect(indexes(root)).toEqual({ 'Row 1': 0, 'Row 2': 1, 'Row 3': 2 });
  });

  it('no auto-layout em grade, também vale a posição (o filho pode estar em qualquer célula)', () => {
    const root = frame([row('3:2', 'Row 2', 44), row('3:1', 'Row 1', 0)], 'VERTICAL');
    expect(indexes(root)).toEqual({ 'Row 1': 0, 'Row 2': 1 });
  });

  it('nomes padrão do Figma só viram lista dentro de um auto-layout', () => {
    expect(indexes(frame([row('3:1', 'Frame 4521', 0), row('3:2', 'Frame 4522', 44)]))).toEqual({});
    expect(Object.keys(indexes(frame([row('3:1', 'Frame 4521', 0), row('3:2', 'Frame 4522', 44)], 'VERTICAL')))).toHaveLength(2);
  });
});
