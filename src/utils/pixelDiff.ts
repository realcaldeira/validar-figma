import type { Dimensions } from '../engine/types.ts';

export interface BufferDiffResult {
  diffBuffer: Uint8ClampedArray;
  diffPixels: number;
  totalPixels: number;
  matchPercent: number;
}

export interface PixelDiffResult {
  matchPercent: number;
  diffPixels: number;
  totalPixels: number;
  figmaSize: Dimensions;
  screenSize: Dimensions;
  dimensionMismatch: boolean;
  diffDataUrl: string;
}

function rgbToYiq(r: number, g: number, b: number): [number, number, number] {
  return [
    r * 0.29889531 + g * 0.58662247 + b * 0.11448223,
    r * 0.59597799 - g * 0.2741761 - b * 0.32180189,
    r * 0.21147017 - g * 0.52261711 + b * 0.31114694,
  ];
}

export function precisionToPixelThreshold(precision: number): number {
  const clamped = Number.isFinite(precision) ? Math.max(0, Math.min(100, Math.round(precision))) : 85;
  return Math.round(((100 - clamped) / 100) * 40);
}

export function diffRgbaBuffers(
  figma: Uint8ClampedArray,
  screen: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 12,
): BufferDiffResult {
  const totalPixels = width * height;
  const diffBuffer = new Uint8ClampedArray(totalPixels * 4);
  const maxDelta = Math.max(0, threshold) * 2.5;
  let diffPixels = 0;

  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const dr = Math.abs(figma[o] - screen[o]);
    const dg = Math.abs(figma[o + 1] - screen[o + 1]);
    const db = Math.abs(figma[o + 2] - screen[o + 2]);
    const da = Math.abs(figma[o + 3] - screen[o + 3]);

    let isDiff = false;
    if (dr > 0 || dg > 0 || db > 0 || da > 0) {
      const [y1, i1, q1] = rgbToYiq(figma[o], figma[o + 1], figma[o + 2]);
      const [y2, i2, q2] = rgbToYiq(screen[o], screen[o + 1], screen[o + 2]);
      const delta = Math.abs(y1 - y2) * 0.5053 + Math.abs(i1 - i2) * 0.299 + Math.abs(q1 - q2) * 0.1957 + da * 0.35;
      isDiff = delta > maxDelta;
    }

    if (isDiff) {
      diffPixels++;
      diffBuffer[o] = 220;
      diffBuffer[o + 1] = 38;
      diffBuffer[o + 2] = 38;
      diffBuffer[o + 3] = 235;
    } else {
      const gray = Math.round(figma[o] * 0.299 + figma[o + 1] * 0.587 + figma[o + 2] * 0.114);
      const faded = Math.min(255, Math.round(gray * 0.35 + 255 * 0.65));
      diffBuffer[o] = faded;
      diffBuffer[o + 1] = faded;
      diffBuffer[o + 2] = faded;
      diffBuffer[o + 3] = 255;
    }
  }

  let matchPercent = 100;
  if (totalPixels > 0 && diffPixels > 0) {
    const raw = Math.round(((totalPixels - diffPixels) / totalPixels) * 10000) / 100;
    matchPercent = Math.min(99.99, Math.max(0, raw));
  }
  return { diffBuffer, diffPixels, totalPixels, matchPercent };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for pixel diff'));
    img.src = src;
  });
}

export async function computeImagePixelDiff(
  figmaSrc: string,
  screenSrc: string,
  threshold = 12,
): Promise<PixelDiffResult> {
  const [figmaImg, screenImg] = await Promise.all([loadImage(figmaSrc), loadImage(screenSrc)]);
  const width = figmaImg.naturalWidth || figmaImg.width;
  const height = figmaImg.naturalHeight || figmaImg.height;
  const screenWidth = screenImg.naturalWidth || screenImg.width;
  const screenHeight = screenImg.naturalHeight || screenImg.height;
  if (width <= 0 || height <= 0 || screenWidth <= 0 || screenHeight <= 0) {
    throw new Error('Failed to load image for pixel diff');
  }

  const figmaCanvas = document.createElement('canvas');
  figmaCanvas.width = width;
  figmaCanvas.height = height;
  const figmaCtx = figmaCanvas.getContext('2d');
  if (!figmaCtx) throw new Error('Failed to load image for pixel diff');
  figmaCtx.fillStyle = '#ffffff';
  figmaCtx.fillRect(0, 0, width, height);
  figmaCtx.drawImage(figmaImg, 0, 0, width, height);

  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = width;
  screenCanvas.height = height;
  const screenCtx = screenCanvas.getContext('2d');
  if (!screenCtx) throw new Error('Failed to load image for pixel diff');
  screenCtx.fillStyle = '#ffffff';
  screenCtx.fillRect(0, 0, width, height);
  screenCtx.drawImage(screenImg, 0, 0, screenWidth, screenHeight);

  const figmaData = figmaCtx.getImageData(0, 0, width, height).data;
  const screenData = screenCtx.getImageData(0, 0, width, height).data;
  const res = diffRgbaBuffers(figmaData, screenData, width, height, threshold);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Failed to load image for pixel diff');
  const outImageData = outCtx.createImageData(width, height);
  outImageData.data.set(res.diffBuffer);
  outCtx.putImageData(outImageData, 0, 0);

  return {
    matchPercent: res.matchPercent,
    diffPixels: res.diffPixels,
    totalPixels: res.totalPixels,
    figmaSize: { width, height },
    screenSize: { width: screenWidth, height: screenHeight },
    dimensionMismatch: width !== screenWidth || height !== screenHeight,
    diffDataUrl: outCanvas.toDataURL('image/png'),
  };
}
