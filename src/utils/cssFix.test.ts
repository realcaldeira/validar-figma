import { describe, expect, it } from 'vitest';
import { generateCssFix } from './cssFix.ts';

describe('generateCssFix', () => {
  it('converts failing CSS properties into kebab-case declarations and skips non-CSS checks', () => {
    const css = generateCssFix([
      { property: 'fontSize', expected: '24px', actual: '20px', status: 'fail' },
      { property: 'fontFamily', expected: 'DM Sans', actual: 'Arial', status: 'fail' },
      { property: 'borderColor', expected: '#141414 @0.08', actual: '#000000', status: 'fail' },
      { property: 'text', expected: 'Title', actual: 'Other', status: 'fail' },
      { property: 'color', expected: '#141414', actual: '#141414', status: 'pass' },
    ]);
    expect(css).toBe(
      [
        'font-size: 24px;',
        "font-family: 'DM Sans', sans-serif;",
        'border-color: rgba(20, 20, 20, 0.08);',
      ].join('\n'),
    );
  });
});
