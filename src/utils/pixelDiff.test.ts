import { describe, expect, it } from 'vitest';
import { diffRgbaBuffers, precisionToPixelThreshold } from './pixelDiff.ts';

describe('precisionToPixelThreshold', () => {
  it('maps 100% precision to 0 threshold and 0% precision to 40', () => {
    expect(precisionToPixelThreshold(100)).toBe(0);
    expect(precisionToPixelThreshold(0)).toBe(40);
    expect(precisionToPixelThreshold(85)).toBe(6);
  });
});

describe('diffRgbaBuffers', () => {
  it('returns 100% match for identical buffers', () => {
    const a = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const b = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const res = diffRgbaBuffers(a, b, 2, 1, 12);
    expect(res.diffPixels).toBe(0);
    expect(res.matchPercent).toBe(100);
  });

  it('detects changed pixels and respects threshold', () => {
    const figma = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const screen = new Uint8ClampedArray([0, 0, 0, 255, 253, 253, 253, 255]);
    const res = diffRgbaBuffers(figma, screen, 2, 1, 10);
    expect(res.diffPixels).toBe(1);
    expect(res.matchPercent).toBe(50);
  });

  it('never returns 100% when at least one pixel differs', () => {
    const n = 50000;
    const figma = new Uint8ClampedArray(n * 4).fill(255);
    const screen = new Uint8ClampedArray(n * 4).fill(255);
    screen[0] = 0;
    screen[1] = 0;
    screen[2] = 0;
    const res = diffRgbaBuffers(figma, screen, n, 1, 0);
    expect(res.diffPixels).toBe(1);
    expect(res.matchPercent).toBe(99.99);
  });
});
