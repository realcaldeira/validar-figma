import { describe, expect, it } from 'vitest';
import { buildCaptureBundle, buildValidatorBundle } from './scripts.ts';

describe('server script bundles', () => {
  it('compiles /validator.js as valid JavaScript', async () => {
    const code = await buildValidatorBundle();
    expect(code).toContain('__figmaValidator');
    expect(() => new Function(code)).not.toThrow();
  });

  it('compiles /capture.js as valid JavaScript', async () => {
    const code = await buildCaptureBundle();
    expect(code).toContain('__figmaCapture');
    expect(code).toContain('__figmaCaptureSession');
    expect(() => new Function(code)).not.toThrow();
  });
});
