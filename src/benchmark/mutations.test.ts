import { describe, expect, it } from 'vitest';
import { extractExpectedProps, parseRgbColor, prng, shiftColor } from './mutations.ts';

describe('prng', () => {
  it('produces reproducible sequences for a given seed', () => {
    const a = prng(42);
    const b = prng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(prng(1)()).not.toEqual(prng(2)());
  });
});

describe('shiftColor', () => {
  it('darkens light colors and lightens dark colors', () => {
    const light = parseRgbColor(shiftColor('rgb(255, 255, 255)'))!;
    expect(light[1]).toBeLessThan(160);
    const dark = parseRgbColor(shiftColor('rgb(20, 20, 20)'))!;
    expect(dark[1]).toBeGreaterThan(140);
  });

  it('preserves alpha and handles transparent backgrounds', () => {
    expect(shiftColor('rgba(20, 20, 20, 0.5)')).toMatch(/0\.5\)$/);
    expect(shiftColor('rgba(0, 0, 0, 0)')).toBe('rgb(255, 227, 194)');
  });
});

describe('extractExpectedProps', () => {
  it('expands shorthand properties to report property names', () => {
    const props = extractExpectedProps({ padding: 24, gap: 32, borderRadius: 16, color: '#000' });
    expect(props.has('paddingTop') && props.has('paddingLeft')).toBe(true);
    expect(props.has('rowGap') && props.has('borderBottomLeftRadius') && props.has('color')).toBe(true);
  });
});
