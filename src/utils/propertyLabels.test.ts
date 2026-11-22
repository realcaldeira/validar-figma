import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../engine/types.ts';
import {
  extractCssColor,
  formatFriendlyDelta,
  formatShortUrl,
  getFriendlyPropertyLabel,
  getPropertyCategory,
  groupRegionResults,
} from './propertyLabels.ts';

describe('getFriendlyPropertyLabel', () => {
  it('mapeia propriedades comuns em português e inglês', () => {
    expect(getFriendlyPropertyLabel('backgroundColor', 'pt')).toBe('Cor de fundo');
    expect(getFriendlyPropertyLabel('backgroundColor', 'en')).toBe('Background color');
    expect(getFriendlyPropertyLabel('fontSize', 'pt')).toBe('Tamanho da fonte');
    expect(getFriendlyPropertyLabel('fontSize', 'en')).toBe('Font size');
    expect(getFriendlyPropertyLabel('borderTopLeftRadius', 'pt')).toBe('Arredondamento superior esquerdo');
    expect(getFriendlyPropertyLabel('rowGap', 'en')).toBe('Vertical gap');
    expect(getFriendlyPropertyLabel('spaceAbove', 'pt')).toBe('Espaço acima (gap)');
    expect(getFriendlyPropertyLabel('textDecorationLine', 'en')).toBe('Text decoration');
    expect(getFriendlyPropertyLabel('fontStyle', 'pt')).toBe('Estilo da fonte');
  });

  it('converte propriedades desconhecidas em texto legível', () => {
    expect(getFriendlyPropertyLabel('customBorderStyle', 'pt')).toBe('Custom border style');
    expect(getFriendlyPropertyLabel('grid-auto-flow', 'en')).toBe('Grid auto flow');
  });
});

describe('getPropertyCategory', () => {
  it('categoriza propriedades de cor, tipografia, espaçamento, borda e layout', () => {
    expect(getPropertyCategory('backgroundColor')).toBe('color');
    expect(getPropertyCategory('borderTopColor')).toBe('color');
    expect(getPropertyCategory('fontSize')).toBe('typography');
    expect(getPropertyCategory('textDecorationLine')).toBe('typography');
    expect(getPropertyCategory('fontStyle')).toBe('typography');
    expect(getPropertyCategory('text')).toBe('typography');
    expect(getPropertyCategory('paddingTop')).toBe('spacing');
    expect(getPropertyCategory('spaceAbove')).toBe('spacing');
    expect(getPropertyCategory('width')).toBe('spacing');
    expect(getPropertyCategory('borderTopLeftRadius')).toBe('border');
    expect(getPropertyCategory('boxShadow')).toBe('border');
    expect(getPropertyCategory('display')).toBe('layout');
    expect(getPropertyCategory('visible')).toBe('layout');
    expect(getPropertyCategory('somethingElse')).toBe('other');
  });
});

describe('groupRegionResults', () => {
  it('agrupa 4 lados ou 4 cantos idênticos em uma única linha legível', () => {
    const results: CheckResult[] = [
      { property: 'paddingTop', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'paddingRight', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'paddingBottom', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'paddingLeft', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'backgroundColor', expected: '#E0F3FF', actual: '#CFE8FF', delta: 'ΔE 4.8', status: 'fail' },
      { property: 'borderTopLeftRadius', expected: '16px', actual: '12px', delta: '-4px', status: 'fail' },
      { property: 'borderTopRightRadius', expected: '16px', actual: '12px', delta: '-4px', status: 'fail' },
      { property: 'borderBottomRightRadius', expected: '16px', actual: '12px', delta: '-4px', status: 'fail' },
      { property: 'borderBottomLeftRadius', expected: '16px', actual: '12px', delta: '-4px', status: 'fail' },
    ];

    const groupedPt = groupRegionResults(results, 'pt');
    expect(groupedPt).toHaveLength(3);
    expect(groupedPt[0]).toMatchObject({
      codeTag: 'padding',
      friendlyLabel: 'Espaçamento interno (4 lados)',
      groupedCount: 4,
      category: 'spacing',
    });
    expect(groupedPt[1]).toMatchObject({
      codeTag: 'backgroundColor',
      friendlyLabel: 'Cor de fundo',
      groupedCount: 1,
      category: 'color',
    });
    expect(groupedPt[2]).toMatchObject({
      codeTag: 'borderRadius',
      friendlyLabel: 'Arredondamento (4 cantos)',
      groupedCount: 4,
      category: 'border',
    });

    const groupedEn = groupRegionResults(results, 'en');
    expect(groupedEn[0].friendlyLabel).toBe('Inner padding (all 4 sides)');
    expect(groupedEn[2].friendlyLabel).toBe('Corner radius (all 4 corners)');
  });

  it('mantém lados separados quando os valores diferem ou faltam lados', () => {
    const partial: CheckResult[] = [
      { property: 'paddingTop', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'paddingRight', expected: '24px', actual: '16px', delta: '-8px', status: 'fail' },
      { property: 'paddingBottom', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
      { property: 'paddingLeft', expected: '24px', actual: '20px', delta: '-4px', status: 'fail' },
    ];
    const rows = groupRegionResults(partial, 'pt');
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.groupedCount === 1)).toBe(true);
  });
});

describe('formatFriendlyDelta', () => {
  it('traduz deltas de tamanho e ΔE em linguagem humana', () => {
    expect(formatFriendlyDelta('-4px', 'pt')).toBe('4px menor');
    expect(formatFriendlyDelta('+6px', 'en')).toBe('6px larger');
    expect(formatFriendlyDelta('ΔE 2.1', 'pt')).toBe('diferença sutil (ΔE 2.1)');
    expect(formatFriendlyDelta('ΔE 4.8', 'pt')).toBe('tom diferente (ΔE 4.8)');
    expect(formatFriendlyDelta('ΔE 14.6', 'en')).toBe('clear color diff (ΔE 14.6)');
    expect(formatFriendlyDelta(undefined, 'pt')).toBeNull();
  });
});

describe('extractCssColor', () => {
  it('extrai cores hex, rgb e rgba', () => {
    expect(extractCssColor('#E0F3FF')).toBe('#E0F3FF');
    expect(extractCssColor('#fff')).toBe('#fff');
    expect(extractCssColor('#11223380')).toBe('#11223380');
    expect(extractCssColor('solid 1px rgb(20, 20, 20)')).toBe('rgb(20, 20, 20)');
    expect(extractCssColor('rgba(37, 99, 235, 0.25)')).toBe('rgba(37, 99, 235, 0.25)');
    expect(extractCssColor('#141414 @0.08')).toBe('rgba(20, 20, 20, 0.08)');
  });

  it('retorna null quando não há cor', () => {
    expect(extractCssColor('24px')).toBeNull();
    expect(extractCssColor('none')).toBeNull();
    expect(extractCssColor('#12345')).toBeNull();
    expect(extractCssColor(null)).toBeNull();
  });
});

describe('formatShortUrl', () => {
  it('mantém URLs curtas limpas e compacta caminhos longos', () => {
    expect(formatShortUrl('http://localhost:3000/')).toBe('localhost:3000');
    expect(formatShortUrl('http://localhost:5199/demo/sample-screen')).toBe('localhost:5199/demo/sample-screen');
    expect(
      formatShortUrl('http://localhost:3010/workspace-app/projects/c0000000-0000-4000-8000-000000000001/overview/releases'),
    ).toBe('localhost:3010/workspace-app/…/releases');
  });

  it('retorna a string original para entradas que não são URLs', () => {
    expect(formatShortUrl('tela-checkout.png')).toBe('tela-checkout.png');
  });
});
