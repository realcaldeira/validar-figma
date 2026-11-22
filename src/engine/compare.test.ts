import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCES,
  annotateVisibility,
  classifyVisibility,
  headlineScore,
  clampPrecision,
  compareRegion,
  contentMatch,
  containsPhrase,
  slotMatch,
  pairLeaves,
  isRepeatedRow,
  computeMatchScore,
  deltaE2000,
  parseColor,
  parseFontWeight,
  parsePx,
  parseShadows,
  summarize,
  tolerancesFromPrecision,
} from './compare.ts';
import type { RegionReport } from './types.ts';

describe('parseColor', () => {
  it('parses hex, rgb, rgba, hsl, and color(srgb)', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#14141480')).toEqual([20, 20, 20, 0.502]);
    expect(parseColor('rgb(20, 20, 20)')).toEqual([20, 20, 20, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.16)')).toEqual([0, 0, 0, 0.16]);
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual([0, 255, 0, 1]);
    expect(parseColor('color(srgb 1 0 0 / 0.5)')).toEqual([255, 0, 0, 0.5]);
  });
});

describe('deltaE2000', () => {
  it('computes 0 for identical colors and higher values for distinct colors', () => {
    expect(deltaE2000([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(deltaE2000([20, 20, 20], [21, 21, 21])).toBeLessThan(2.3);
    expect(deltaE2000([255, 0, 0], [0, 0, 255])).toBeGreaterThan(10);
  });
});

describe('parseFontWeight and parsePx', () => {
  it('normalizes font weights and unit conversions', () => {
    expect(parseFontWeight('Semi Bold')).toBe(600);
    expect(parseFontWeight('700')).toBe(700);
    expect(parsePx('24px')).toBe(24);
    expect(parsePx('150%', 16)).toBe(24);
    expect(parsePx('1.5rem')).toBe(24);
    expect(parsePx('.')).toBeNull();
    expect(parsePx('-.px')).toBeNull();
    expect(parsePx('1.2.3px')).toBeNull();
    expect(parsePx('px')).toBeNull();
  });
});

describe('opacity and contentInset validation', () => {
  it('supports percentage opacity and rejects invalid contentInset values cleanly', () => {
    const ok = compareRegion({ opacity: '50%' as unknown as number }, { found: true, style: { opacity: '0.5' } });
    expect(ok[0].status).toBe('pass');
    const warn = compareRegion(
      { contentInsetTop: 'auto' as unknown as number, contentCenterTop: 12 },
      { found: true, style: {}, contentInset: { top: 10, left: null, centerTop: 14 } },
    );
    expect(warn[0].status).toBe('warn');
  });
});

describe('parseShadows', () => {
  it('parses computed and Figma shadow formats identically', () => {
    const computed = parseShadows('rgba(0, 0, 0, 0.16) 0px 2px 4px 0px');
    const figma = parseShadows('0 2px 4px rgba(0,0,0,0.16)');
    expect(computed).toHaveLength(1);
    expect(computed[0]).toEqual(figma[0]);
  });
});

describe('compareRegion', () => {
  it('flags only mismatching properties', () => {
    const res = compareRegion(
      {
        width: 320,
        fontSize: 16,
        fontWeight: 'SemiBold',
        lineHeight: 24,
        color: '#141414',
        fontFamily: 'Inter',
        text: 'Releases',
      },
      {
        found: true,
        count: 1,
        rect: { x: 0, y: 0, width: 320, height: 24 },
        text: 'Releases',
        style: {
          fontSize: '14px',
          fontWeight: '600',
          lineHeight: '24px',
          color: 'rgb(20, 20, 20)',
          fontFamily: '"Inter", sans-serif',
        },
        fontLoaded: true,
      },
    );
    expect(res.filter((r) => r.status === 'fail').map((r) => r.property)).toEqual(['fontSize']);
  });

  it('resolves percentage lineHeight against expected fontSize', () => {
    const res = compareRegion(
      { fontSize: 24, lineHeight: '120%' },
      {
        found: true,
        rect: { x: 0, y: 0, width: 100, height: 30 },
        style: { fontSize: '16px', lineHeight: '19.2px' },
      },
    );
    const lh = res.find((r) => r.property === 'lineHeight');
    expect(lh?.status).toBe('fail');
    expect(lh?.expected).toBe('28.8px');
  });

  it('detects single-side border color mismatch', () => {
    const res = compareRegion(
      { borderColor: '#141414' },
      {
        found: true,
        style: {
          borderTopWidth: '1px',
          borderRightWidth: '1px',
          borderBottomWidth: '1px',
          borderLeftWidth: '1px',
          borderTopColor: 'rgb(20, 20, 20)',
          borderRightColor: 'rgb(20, 20, 20)',
          borderBottomColor: 'rgb(255, 0, 0)',
          borderLeftColor: 'rgb(20, 20, 20)',
        },
      },
    );
    expect(res[0].status).toBe('fail');
    expect(res[0].note).toContain('bottom');
  });

  it('validates placeholder and value on inputs', () => {
    const res = compareRegion(
      { placeholder: 'Filter releases...', value: 'Web' },
      { found: true, placeholder: 'Filter releases...', value: 'iOS', style: {} },
    );
    expect(res.find((r) => r.property === 'placeholder')?.status).toBe('pass');
    expect(res.find((r) => r.property === 'value')?.status).toBe('fail');
  });

  it('reports missing element and minHeight auto as failures', () => {
    const missing = compareRegion({ width: 10 }, { found: false });
    expect(missing[0].status).toBe('fail');

    const minH = compareRegion({ minHeight: 500 }, { found: true, rect: { x: 0, y: 0, width: 10, height: 10 }, style: { minHeight: 'auto' } });
    expect(minH[0].status).toBe('fail');
    expect(minH[0].actual).toBe('0px');
  });

  it('summarizes regions accurately', () => {
    const summary = summarize([
      {
        name: 'Card',
        selector: '.card',
        results: [
          { property: 'width', expected: '100px', actual: '100px', status: 'pass' },
          { property: 'color', expected: '#000', actual: '#fff', status: 'fail' },
          { property: 'fontFamily', expected: 'Inter', actual: 'Inter', status: 'warn' },
        ],
      },
    ]);
    expect(summary).toEqual({ regions: 1, checks: 3, pass: 1, fail: 1, warn: 1, score: 50, failVisible: 1, failCss: 0, scoreVisible: 50 });
  });
});

describe('precision levels and match scoring', () => {
  it('clamps precision levels into 0..100', () => {
    expect(clampPrecision(-10)).toBe(0);
    expect(clampPrecision(120)).toBe(100);
    expect(clampPrecision(Number.NaN)).toBe(100);
    expect(clampPrecision(92.6)).toBe(93);
  });

  it('keeps only rounding noise at 100%, standard defaults at 85%, and relaxes smoothly below 85%', async () => {
    const { ROUNDING_FLOOR } = await import('./compare.ts');
    const exact = tolerancesFromPrecision(100);
    expect(exact).toEqual(ROUNDING_FLOOR);
    // 0,09px de fração não aparece; 1,39px aparece.
    const fracao = compareRegion({ height: 48 }, { found: true, style: {}, rect: { x: 0, y: 0, width: 10, height: 48.09 } }, exact);
    const real = compareRegion({ height: 48 }, { found: true, style: {}, rect: { x: 0, y: 0, width: 10, height: 49.39 } }, exact);
    expect(fracao[0].status).toBe('pass');
    expect(real[0].status).toBe('fail');
    expect(tolerancesFromPrecision(85)).toEqual(DEFAULT_TOLERANCES);
    const relaxed = tolerancesFromPrecision(55);
    expect(relaxed.size).toBe(3);
    expect(relaxed.spacing).toBe(6);
    expect(relaxed.color).toBe(6.9);
    const widest = tolerancesFromPrecision(0);
    expect(widest.alpha).toBeLessThanOrEqual(0.5);
    expect(widest.opacity).toBeLessThanOrEqual(0.5);
  });

  it('computes 0..100 match score without falsely rounding non-perfect results to 100', () => {
    expect(computeMatchScore(0, 0, 0)).toBeNull();
    expect(computeMatchScore(20, 0, 0)).toBe(100);
    expect(computeMatchScore(999, 1, 0)).toBe(99.9);
    expect(computeMatchScore(2, 1, 1)).toBe(62.5);
  });
});

describe('geometria das caixas', () => {
  it('calcula a sobreposição e escolhe a caixa que mais cobre o alvo', async () => {
    const { rectIoU, pickBestRect, centerDistance } = await import('./compare.ts');
    const alvo = { x: 100, y: 100, width: 200, height: 100 };
    expect(rectIoU(alvo, alvo)).toBe(1);
    expect(rectIoU(alvo, { x: 400, y: 400, width: 10, height: 10 })).toBe(0);
    expect(centerDistance(alvo, { x: 110, y: 100, width: 200, height: 100 })).toBe(10);
    const caixas = [
      { x: 0, y: 0, width: 1440, height: 900 }, // a página inteira cobre, mas sobra muito
      { x: 104, y: 102, width: 196, height: 96 }, // quase igual
      { x: 100, y: 100, width: 100, height: 50 }, // só um pedaço
    ];
    expect(pickBestRect(caixas, alvo)).toBe(1);
    // Contêiner maior que começa em outro lugar não casa, mesmo cobrindo o alvo.
    expect(pickBestRect([{ x: 100, y: 0, width: 200, height: 220 }], alvo)).toBe(-1);
    expect(pickBestRect([caixas[0], caixas[2]], alvo)).toBe(-1);
  });
});

describe('fundo transparente', () => {
  it('usa a cor que aparece atrás quando o elemento é transparente', () => {
    const r = compareRegion(
      { backgroundColor: '#FFFFFF' },
      { found: true, style: { backgroundColor: 'rgba(0, 0, 0, 0)' }, effectiveBackground: 'rgb(255, 255, 255)' },
    );
    expect(r[0].status).toBe('pass');
    expect(r[0].note).toMatch(/transparent/);
    const errado = compareRegion(
      { backgroundColor: '#FFFFFF' },
      { found: true, style: { backgroundColor: 'rgba(0, 0, 0, 0)' }, effectiveBackground: 'rgb(0, 0, 0)' },
    );
    expect(errado[0].status).toBe('fail');
  });
});

describe('deslocamento entre Figma e tela', () => {
  it('usa a mediana e ignora pares fora da curva', async () => {
    const { estimateOffset } = await import('./compare.ts');
    const caixa = (x: number, y: number) => ({ x, y, width: 40, height: 20 });
    const pares = [
      { figma: caixa(100, 146), screen: caixa(60, 70) },
      { figma: caixa(100, 337), screen: caixa(60, 241) },
      { figma: caixa(100, 474), screen: caixa(60, 386) },
      { figma: caixa(100, 508), screen: caixa(60, 434) },
      { figma: caixa(100, 90), screen: caixa(500, 608) }, // par errado: não pode puxar o resultado
    ];
    expect(estimateOffset(pares)).toEqual({ dx: -40, dy: -76 });
    expect(estimateOffset(pares.slice(0, 2))).toEqual({ dx: 0, dy: 0 });
  });
});

describe('espaço entre caixas', () => {
  it('é zero quando se sobrepõem e mede a folga quando estão separadas', async () => {
    const { boxGap } = await import('./compare.ts');
    const texto = { x: 160, y: 434, width: 456, height: 20 };
    const paragrafoLargo = { x: 120, y: 430, width: 1200, height: 24 };
    expect(boxGap(texto, paragrafoLargo)).toBe(0);
    expect(boxGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 13, y: 14, width: 5, height: 5 })).toBe(5);
  });
});

describe('textos parecidos', () => {
  it('casa ignorando aspas tipográficas e ponto final, mas a checagem de texto continua estrita', async () => {
    const { normalizeForMatch, textSimilarity } = await import('./compare.ts');
    const figma = 'Review/Update your team’s active project milestones below';
    const tela = "Review/Update your team's active project milestones below.";
    expect(normalizeForMatch(figma)).toBe(normalizeForMatch(tela));
    const r = compareRegion({ text: figma }, { found: true, style: {}, text: tela });
    expect(r[0].status).toBe('fail');
    expect(r[0].note).toMatch(/punctuation/);
    expect(textSimilarity('Last Update', 'Last Updated')).toBeGreaterThan(0.6);
    expect(textSimilarity('Filter releases or owners...', 'Filter releases...')).toBeGreaterThan(0.6);
    expect(textSimilarity('Hello Alice Morgan', 'Hello David')).toBeLessThan(0.6);
    expect(textSimilarity('77.0%', 'v2.1 (82.4%)')).toBeLessThan(0.6);
  });
});

describe('cor com transparência', () => {
  it('compara a cor que aparece sobre o fundo, não a opacidade', () => {
    const r = compareRegion(
      { backgroundColor: 'rgba(20, 20, 20, 0.04)' },
      { found: true, style: { backgroundColor: 'rgb(245, 245, 245)' }, effectiveBackground: 'rgb(255, 255, 255)' },
    );
    expect(r[0].status).toBe('pass');
    const longe = compareRegion(
      { backgroundColor: 'rgba(20, 20, 20, 0.04)' },
      { found: true, style: { backgroundColor: 'rgb(200, 230, 255)' }, effectiveBackground: 'rgb(255, 255, 255)' },
    );
    expect(longe[0].status).toBe('fail');
  });
  it('no desempate, prefere a caixa que pinta algo', async () => {
    const { pickBestRect } = await import('./compare.ts');
    const alvo = { x: 0, y: 0, width: 420, height: 36 };
    expect(pickBestRect([alvo, alvo], alvo, 0.6, 24, [0, 0.05])).toBe(1);
  });
});

describe('raio de pílula', () => {
  it('trata 512px e 9999px como iguais numa caixa de 36px de altura', () => {
    const r = compareRegion(
      { borderRadius: 512 },
      { found: true, rect: { x: 0, y: 0, width: 420, height: 36 }, style: { borderTopLeftRadius: '9999px', borderTopRightRadius: '9999px', borderBottomRightRadius: '9999px', borderBottomLeftRadius: '9999px' } },
    );
    expect(r.every((x) => x.status === 'pass')).toBe(true);
    const r2 = compareRegion(
      { borderRadius: 512 },
      { found: true, rect: { x: 0, y: 0, width: 420, height: 36 }, style: { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px' } },
    );
    expect(r2.every((x) => x.status === 'fail')).toBe(true);
  });
});

describe('regras de comparação realistas', () => {
  it('trata diferença só de números como dado de exemplo', () => {
    for (const [fig, tela] of [['5 Open', '2 Open'], ['9+ Alerts', '2 Alerts'], ['In Progress', 'In Progress (32)'], ['$2,000,000.00', '$250,000.00'], ['02/02/2026 - 06/06/2026', '12/10/2026 - 02/08/2027']]) {
      const r = compareRegion({ text: fig }, { found: true, style: {}, text: tela });
      expect(r[0].status, `${fig} × ${tela}`).toBe('warn');
    }
    expect(compareRegion({ text: 'Last Update' }, { found: true, style: {}, text: 'Last Updated' })[0].status).toBe('fail');
  });
  it('aceita maiúsculas vindas do text-transform pedido pelo Figma', () => {
    const ok = compareRegion({ text: 'Under Review', textTransform: 'uppercase' }, { found: true, style: { textTransform: 'uppercase' }, text: 'UNDER REVIEW' });
    expect(ok.find((x) => x.property === 'text')!.status).toBe('pass');
    const errado = compareRegion({ text: 'Under Review' }, { found: true, style: { textTransform: 'uppercase' }, text: 'UNDER REVIEW' });
    expect(errado.find((x) => x.property === 'text')!.status).toBe('fail');
  });
  it('compara borda translúcida pela cor que aparece', () => {
    const r = compareRegion({ borderColor: 'rgba(0, 0, 0, 0.08)' }, { found: true, style: { borderTopWidth: '1px', borderTopColor: 'rgba(20, 20, 20, 0.08)', backgroundColor: 'rgb(255, 255, 255)' }, effectiveBackground: 'rgb(255, 255, 255)' });
    expect(r[0].status).toBe('pass');
  });
  it('entende raio em porcentagem', () => {
    const r = compareRegion({ borderRadius: 32 }, { found: true, rect: { x: 0, y: 0, width: 64, height: 64 }, style: { borderTopLeftRadius: '50%', borderTopRightRadius: '50%', borderBottomRightRadius: '50%', borderBottomLeftRadius: '50%' } });
    expect(r.every((x) => x.status === 'pass')).toBe(true);
  });
});

describe('borda em pixels inteiros', () => {
  it('aceita 1px na tela para 1,2px do Figma, mas não 2px', async () => {
    const { tolerancesFromPrecision } = await import('./compare.ts');
    const exact = tolerancesFromPrecision(100);
    const ok = compareRegion({ borderWidth: 1.2 }, { found: true, dpr: 1, style: { borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px' } }, exact);
    expect(ok.every((x) => x.status === 'pass')).toBe(true);
    const errado = compareRegion({ borderWidth: 1.2 }, { found: true, dpr: 1, style: { borderTopWidth: '2px', borderRightWidth: '2px', borderBottomWidth: '2px', borderLeftWidth: '2px' } }, exact);
    expect(errado.every((x) => x.status === 'fail')).toBe(true);
  });
});

describe('espaço entre vizinhos (gap visual)', () => {
  const item = (id: number, fig: [number, number, number, number], screen: [number, number, number, number], extra = {}) => ({
    id,
    name: `R${id}`,
    fig: { x: fig[0], y: fig[1], width: fig[2], height: fig[3] },
    screen: { x: screen[0], y: screen[1], width: screen[2], height: screen[3] },
    rightIsReal: true,
    leftIsReal: true,
    ...extra,
  });

  it('compara o espaço entre um título e o subtítulo logo abaixo', async () => {
    const { findSpacingPairs } = await import('./compare.ts');
    const pairs = findSpacingPairs([item(0, [24, 24, 300, 28], [10, 10, 320, 28]), item(1, [24, 60, 400, 20], [10, 54, 400, 20])], [], []);
    expect(pairs).toEqual([{ a: 0, b: 1, axis: 'vertical', figGap: 8, screenGap: 16 }]);
  });

  it('não compara quando há conteúdo entre os dois (no Figma ou na tela)', async () => {
    const { findSpacingPairs } = await import('./compare.ts');
    const items = [item(0, [24, 24, 300, 28], [10, 10, 300, 28]), item(1, [24, 160, 300, 20], [10, 146, 300, 20])];
    expect(findSpacingPairs(items, [{ x: 30, y: 80, width: 100, height: 20 }], [])).toEqual([]);
    expect(findSpacingPairs(items, [], [{ x: 20, y: 90, width: 100, height: 20 }])).toEqual([]);
  });

  it('só mede na horizontal quando as bordas fazem sentido (caixa ou texto de largura automática)', async () => {
    const { findSpacingPairs } = await import('./compare.ts');
    const fixo = findSpacingPairs([item(0, [0, 0, 200, 20], [0, 0, 200, 20], { rightIsReal: false }), item(1, [216, 0, 80, 20], [0 + 216, 0, 80, 20])], [], []);
    expect(fixo.filter((p) => p.axis === 'horizontal')).toEqual([]);
    const auto = findSpacingPairs([item(0, [0, 0, 60, 20], [0, 0, 60, 20]), item(1, [72, 0, 80, 20], [70, 0, 80, 20])], [], []);
    expect(auto).toEqual([{ a: 0, b: 1, axis: 'horizontal', figGap: 12, screenGap: 10 }]);
  });

  it('usa o padding medido na tela, não o CSS', () => {
    const r = compareRegion({ contentInsetTop: 24, contentInsetLeft: 24 }, { found: true, style: { paddingTop: '0px' }, contentInset: { top: 24.3, left: 16 } });
    expect(r.map((x) => [x.property, x.status])).toEqual([['paddingTop', 'pass'], ['paddingLeft', 'fail']]);
  });
});

describe('pares só dentro do mesmo bloco', () => {
  it('não mede de um texto de fora para um texto de dentro de outra caixa', async () => {
    const { findSpacingPairs } = await import('./compare.ts');
    const busca = { id: 0, name: 'busca', fig: { x: 160, y: 568, width: 300, height: 24 }, screen: { x: 117, y: 157, width: 300, height: 24 }, rightIsReal: true, leftIsReal: true };
    const colHeader = { id: 1, name: 'Owner', fig: { x: 188, y: 628, width: 60, height: 20 }, screen: { x: 134, y: 206, width: 60, height: 20 }, rightIsReal: true, leftIsReal: true };
    const cabecalho = { x: 160, y: 616, width: 1208, height: 44 };
    expect(findSpacingPairs([busca, colHeader], [], [], 120, [cabecalho])).toEqual([]);
    expect(findSpacingPairs([busca, colHeader], [], [], 120, []).length).toBe(1);
  });
});

describe('padding de cima pelo centro da linha', () => {
  it('não cobra de novo a entrelinha diferente (texto no mesmo lugar visual)', () => {
    // Badge de 24px: no Figma o texto tem entrelinha 10 (topo 7, centro 12); na tela, entrelinha 16,8 (topo 3,6, centro 12).
    const igual = compareRegion({ contentInsetTop: 7, contentCenterTop: 12 }, { found: true, style: {}, contentInset: { top: 3.6, left: null, centerTop: 12 } });
    expect(igual[0].status).toBe('pass');
    const deslocado = compareRegion({ contentInsetTop: 7, contentCenterTop: 12 }, { found: true, style: {}, contentInset: { top: 6, left: null, centerTop: 16 } });
    expect(deslocado[0].status).toBe('fail');
    expect(deslocado[0].actual).toBe('11px');
  });
});

describe('gap só quando é fixo no Figma e a ordem se mantém', () => {
  const it2 = (id: number, fig: number[], screen: number[], extra = {}) => ({ id, name: `R${id}`, fig: { x: fig[0], y: fig[1], width: fig[2], height: fig[3] }, screen: { x: screen[0], y: screen[1], width: screen[2], height: screen[3] }, rightIsReal: true, leftIsReal: true, ...extra });
  it('ignora linha com itens espalhados e pares com a ordem invertida', async () => {
    const { findSpacingPairs } = await import('./compare.ts');
    const espalhado = findSpacingPairs([it2(0, [0, 0, 100, 20], [0, 0, 120, 20]), it2(1, [154, 0, 60, 20], [194, 0, 60, 20], { fixedGap: { vertical: true, horizontal: false } })], [], []);
    expect(espalhado).toEqual([]);
    const invertido = findSpacingPairs([it2(0, [0, 0, 200, 100], [0, 200, 200, 100]), it2(1, [0, 116, 200, 100], [0, 0, 200, 100])], [], []);
    expect(invertido).toEqual([]);
  });
});

describe('mesma cópia com mudança × outro dado', () => {
  it('aceita cópia estendida ou cortada e recusa nomes de exemplo parecidos', async () => {
    const { isSameCopy, withoutNumbers } = await import('./compare.ts');
    expect(isSameCopy('Last Updated', 'Last Update')).toBe(true);
    expect(isSameCopy('Filter releases...', 'Filter releases or owners...')).toBe(true);
    expect(isSameCopy('Select target workspace', 'Select all target workspace')).toBe(true);
    expect(isSameCopy('Release Plan 2026', 'Release Plan Archive')).toBe(false);
    expect(withoutNumbers('25.5K requests')).toBe(withoutNumbers('3.2M requests'));
  });
});

describe('contentMatch', () => {
  it('conta os textos do Figma que estão dentro do elemento', () => {
    expect(contentMatch('Pending review\nDue date 12/10', ['Pending review', 'Due date', 'Owner'])).toEqual({ found: 2, total: 3 });
  });
  it('ignora textos só de números e aceita o mesmo texto com outros números', () => {
    expect(contentMatch('3 tasks', ['12 tasks', '12', 'R$ 1.200'])).toEqual({ found: 1, total: 1 });
  });
  it('não confunde com outro conteúdo', () => {
    expect(contentMatch('Archived by admin', ['Pending review', 'Due date'])).toMatchObject({ found: 0, total: 2 });
  });
  it('ignora maiúsculas do text-transform', () => {
    expect(contentMatch('UNDER REVIEW', ['Under Review'])).toEqual({ found: 1, total: 1 });
  });
});

describe('slotMatch', () => {
  const slots = [
    { x: 52, right: 300, cy: 28, align: 'L' as const },
    { x: 360, right: 380, cy: 28, align: 'R' as const },
  ];
  it('aceita o mesmo componente com outro texto nos mesmos lugares', () => {
    expect(slotMatch(slots, [{ left: 54, right: 210, cy: 27 }, { left: 372, right: 381, cy: 29 }])).toMatchObject({ found: 2, total: 2 });
  });
  it('aceita o conteúdo inteiro deslocado (padding errado) para o erro aparecer', () => {
    expect(slotMatch(slots, [{ left: 52, right: 200, cy: 35 }, { left: 370, right: 380, cy: 35 }])).toEqual({ found: 2, total: 2, dx: 0, dy: 7 });
  });
  it('recusa outra caixa com textos em outros lugares (linha de tabela × paginação)', () => {
    expect(slotMatch(slots, [{ left: 16, right: 120, cy: 36 }, { left: 200, right: 260, cy: 36 }])).toMatchObject({ found: 0, total: 2 });
  });
  it('um texto da tela vale para um texto do Figma só', () => {
    const twoOnOneLine = [
      { x: 10, right: 60, cy: 20, align: 'L' as const },
      { x: 14, right: 40, cy: 22, align: 'L' as const },
    ];
    expect(slotMatch(twoOnOneLine, [{ left: 12, right: 50, cy: 21 }])).toMatchObject({ found: 1, total: 2 });
  });
  it('texto centralizado vale pelo centro', () => {
    expect(slotMatch([{ x: 100, right: 200, cy: 20, align: 'C' }], [{ left: 130, right: 172, cy: 21 }])).toMatchObject({ found: 1, total: 1 });
  });
});

describe('containsPhrase', () => {
  it('só aceita palavra ou frase inteira', () => {
    expect(containsPhrase('monolith app', 'on')).toBe(false);
    expect(containsPhrase('allocation', 'all')).toBe(false);
    expect(containsPhrase('status: on', 'on')).toBe(true);
    expect(containsPhrase('pending review due date', 'due date')).toBe(true);
    expect(containsPhrase('# tasks', '# tasks')).toBe(true);
  });
  it('contentMatch não confirma a caixa por pedaço de palavra', () => {
    expect(contentMatch('Monolith App', ['On'])).toEqual({ found: 0, total: 1 });
  });
});

describe('elementos a mais (pairLeaves)', () => {
  const box = (x: number, y: number, w = 80, h = 20) => ({ x, y, width: w, height: h });
  it('dado de exemplo no mesmo lugar tem par; um filtro a mais não', () => {
    const figma = [{ box: box(100, 100), text: true }, { box: box(200, 100), text: true }];
    const screen = [
      { box: box(102, 100, 60), text: true, offsets: [{ dx: 0, dy: 0 }] },
      { box: box(203, 101), text: true, offsets: [{ dx: 0, dy: 0 }] },
      { box: box(300, 100), text: true, offsets: [{ dx: 0, dy: 0 }] },
    ];
    expect(pairLeaves(screen, figma)).toEqual([0, 1, -1]);
  });
  it('o lugar de um texto do Figma que já casou (ou foi para outro lugar) não serve de par', () => {
    const figma = [{ box: box(100, 100), text: true, taken: true }];
    expect(pairLeaves([{ box: box(100, 100), text: true, offsets: [{ dx: 0, dy: 0 }] }], figma)).toEqual([-1]);
  });
  it('texto não faz par com ícone, nem com uma caixa de texto larga logo abaixo', () => {
    const figma = [{ box: box(100, 100, 20, 20), text: false }, { box: box(80, 140, 570, 20), text: true }];
    expect(pairLeaves([{ box: box(100, 100), text: true, offsets: [{ dx: 0, dy: 0 }] }], figma)).toEqual([-1]);
  });
  it('tenta os deslocamentos candidatos em ordem', () => {
    const figma = [{ box: box(150, 300), text: true }];
    expect(pairLeaves([{ box: box(100, 100), text: true, offsets: [{ dx: 0, dy: 0 }, { dx: 50, dy: 200 }] }], figma)).toEqual([0]);
  });
});

describe('isRepeatedRow', () => {
  it('linha a mais na mesma coluna é dado; item lado a lado não', () => {
    const paired = [{ box: { x: 100, y: 100, width: 80, height: 20 }, sig: 'SPAN<TD<TR' }];
    expect(isRepeatedRow({ box: { x: 101, y: 160, width: 70, height: 20 }, sig: 'SPAN<TD<TR' }, paired)).toBe(true);
    expect(isRepeatedRow({ box: { x: 220, y: 100, width: 70, height: 20 }, sig: 'SPAN<TD<TR' }, paired)).toBe(false);
  });
});

describe('padding da direita e de baixo', () => {
  it('compara a direita pela borda e embaixo pelo centro da última linha', () => {
    const ok = compareRegion(
      { contentInsetRight: 26, contentInsetBottom: 12, contentCenterBottom: 22 },
      { found: true, style: {}, contentInset: { top: 0, left: 0, right: 26.4, bottom: 9, centerBottom: 22 } },
    );
    expect(ok.map((r) => [r.property, r.status])).toEqual([
      ['paddingRight', 'pass'],
      ['paddingBottom', 'pass'],
    ]);
    const errado = compareRegion(
      { contentInsetRight: 26, contentInsetBottom: 12, contentCenterBottom: 22 },
      { found: true, style: {}, contentInset: { top: 0, left: 0, right: 14, bottom: 4, centerBottom: 14 } },
    );
    expect(errado.map((r) => [r.property, r.status, r.actual])).toEqual([
      ['paddingRight', 'fail', '14px'],
      ['paddingBottom', 'fail', '4px'],
    ]);
  });
});

describe('fim da caixa muito longe do Figma', () => {
  it('vira aviso (conteúdo faltando ou outro estado), não erro', () => {
    const r = compareRegion({ contentInsetBottom: 34 }, { found: true, style: {}, contentInset: { top: 0, left: 0, right: 0, bottom: 323, centerBottom: null } });
    expect(r[0].status).toBe('warn');
  });
});

describe('orderByLines', () => {
  it('junta na mesma linha o que está até 4px abaixo do primeiro item e lê da esquerda para a direita', async () => {
    const { orderByLines } = await import('./compare.ts');
    const items = [
      { id: 'c', x: 200, y: 6 },
      { id: 'b', x: 100, y: 3 },
      { id: 'a', x: 300, y: 0 },
      { id: 'd', x: 0, y: 50 },
    ];
    // a (0) e b (3) são a 1ª linha; c (6) passa de 4px do topo dela e abre a 2ª; d é a 3ª.
    expect(orderByLines(items, (i) => i).map((i) => i.id)).toEqual(['b', 'a', 'c', 'd']);
    // A ordem de entrada não muda o resultado.
    expect(orderByLines([...items].reverse(), (i) => i).map((i) => i.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('deixa no fim, na ordem em que vieram, os itens sem posição', async () => {
    const { orderByLines } = await import('./compare.ts');
    const items = [{ id: 'x', p: null }, { id: 'y', p: { x: 0, y: 0 } }, { id: 'z', p: null }];
    expect(orderByLines(items, (i) => i.p).map((i) => i.id)).toEqual(['y', 'x', 'z']);
  });
});

describe('classifyVisibility', () => {
  const fail = (property: string, expected: string, actual: string, delta?: string) =>
    classifyVisibility({ property, expected, actual, delta, status: 'fail' });

  it('colors: under ΔE 3 is CSS-only, from 3 up is visible; a big alpha change is always visible', () => {
    expect(fail('color', '#0A0A0A', '#141414', 'ΔE 0.7')).toBe('css');
    expect(fail('color', '#000000 @0.36', '#141414 @0.36', 'ΔE 2.1')).toBe('css');
    expect(fail('backgroundColor', '#FFF4E6', '#FFF3EB', 'ΔE 3')).toBe('visible');
    expect(fail('backgroundColor', '#EFFFEB', '#FFF3EB', 'ΔE 14.5')).toBe('visible');
    expect(fail('borderColor', '#000000', '#000000 @0.2', 'ΔE 0 · α -0.8')).toBe('visible');
  });

  it('spacing, size, line height and radius: under 4 px is CSS-only', () => {
    expect(fail('paddingBottom', '8px', '9.4px', '+1.4px')).toBe('css');
    expect(fail('paddingTop', '40px', '41.5px', '+1.5px')).toBe('css');
    expect(fail('lineHeight', '20.8px', '22.4px', '+1.6px')).toBe('css');
    expect(fail('height', '48px', '49.39px', '+1.39px')).toBe('css');
    expect(fail('spaceAbove', '26px', '16px', '-10px')).toBe('visible');
    expect(fail('paddingLeft', '24px', '0px', '-24px')).toBe('visible');
    expect(fail('borderTopLeftRadius', '16px', '0px', '-16px')).toBe('visible');
    expect(fail('width', '24px', '28px', '+4px')).toBe('visible');
  });

  it('font size: 1 px or more is visible', () => {
    expect(fail('fontSize', '14px', '14.5px', '+0.5px')).toBe('css');
    expect(fail('fontSize', '14px', '16px', '+2px')).toBe('visible');
  });

  it('a border that appears or disappears is visible even at 1 px', () => {
    expect(fail('borderTopWidth', '0px', '1px', '+1px')).toBe('visible');
    expect(fail('borderTopWidth', '1px', '1.5px', '+0.5px')).toBe('css');
  });

  it('font family, weight, text and alignment are always visible', () => {
    expect(fail('fontFamily', 'Inter', 'Roboto')).toBe('visible');
    expect(fail('fontWeight', '500', '600')).toBe('visible');
    expect(fail('text', 'Moderate Low', 'Moderate')).toBe('visible');
    expect(fail('textAlign', 'left', 'center')).toBe('visible');
  });

  it('unknown or unmeasurable values count as visible, and non-errors are never CSS-only', () => {
    expect(fail('somethingNew', 'a', 'b')).toBe('visible');
    expect(classifyVisibility({ property: 'color', expected: '#000', actual: '#111', delta: 'ΔE 0.4', status: 'pass' })).toBe('visible');
    expect(classifyVisibility({ property: 'paddingTop', expected: '8px', actual: '9px', delta: '+1px', status: 'warn' })).toBe('visible');
  });

  it('works without delta (older reports) by reading the values', () => {
    expect(fail('paddingTop', '24px', '25px')).toBe('css');
    expect(fail('paddingTop', '24px', '32px')).toBe('visible');
  });

  it('annotateVisibility marks only errors, and summarize splits them', () => {
    const regions: RegionReport[] = [
      {
        name: 'Card',
        selector: '.card',
        results: [
          { property: 'paddingTop', expected: '24px', actual: '25px', delta: '+1px', status: 'fail' as const },
          { property: 'fontSize', expected: '14px', actual: '18px', delta: '+4px', status: 'fail' as const },
          { property: 'color', expected: '#000000', actual: '#000000', delta: 'ΔE 0', status: 'pass' as const },
        ],
      },
    ];
    annotateVisibility(regions);
    expect(regions[0].results.map((r) => r.visibility)).toEqual(['css', 'visible', undefined]);
    const s = summarize(regions);
    expect(s.fail).toBe(2);
    expect(s.failVisible).toBe(1);
    expect(s.failCss).toBe(1);
  });
});

describe('headlineScore', () => {
  it('counts CSS-only errors as matching, so the headline score only drops for visible errors', () => {
    const s = { pass: 8, fail: 2, warn: 0, score: 80, failCss: 1, scoreVisible: 90 };
    expect(headlineScore(s)).toBe(90);
  });

  it('computes it for old reports from the CSS-only count, and falls back to the strict score', () => {
    expect(headlineScore({ pass: 8, fail: 2, warn: 0, score: 80 }, 1)).toBe(90);
    expect(headlineScore({ pass: 8, fail: 2, warn: 0, score: 80 }, 2)).toBe(100);
    expect(headlineScore({ pass: 8, fail: 2, warn: 0, score: 80 })).toBe(80);
  });

  it('summarize gives both scores', () => {
    const regions: RegionReport[] = [
      {
        name: 'Card',
        selector: '.card',
        results: [
          { property: 'width', expected: '100px', actual: '100px', status: 'pass' },
          { property: 'paddingTop', expected: '24px', actual: '25px', delta: '+1px', status: 'fail' },
          { property: 'fontSize', expected: '14px', actual: '18px', delta: '+4px', status: 'fail' },
          { property: 'height', expected: '40px', actual: '40px', status: 'pass' },
        ],
      },
    ];
    const s = summarize(regions);
    expect(s.score).toBe(50);
    expect(s.scoreVisible).toBe(75);
  });
});
