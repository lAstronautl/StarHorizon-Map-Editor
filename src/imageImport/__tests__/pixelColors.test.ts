import { describe, it, expect } from 'vitest';
import { extractUniquePixelColors, extractPixelGrid, quantizeImageData } from '../pixelColors';

function makeImageData(width: number, height: number, pixels: number[][]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b, a] = pixels[i];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('extractUniquePixelColors', () => {
  it('dedupes identical colors and counts occurrences', () => {
    const imageData = makeImageData(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
    const colors = extractUniquePixelColors(imageData);
    expect(colors).toContainEqual({ hex: '#ff0000ff', count: 3 });
    expect(colors).toContainEqual({ hex: '#00ff00ff', count: 1 });
    expect(colors).toHaveLength(2);
  });

  it('excludes fully transparent pixels entirely', () => {
    const imageData = makeImageData(2, 1, [
      [10, 20, 30, 0],
      [255, 255, 255, 255],
    ]);
    const colors = extractUniquePixelColors(imageData);
    expect(colors).toEqual([{ hex: '#ffffffff', count: 1 }]);
  });

  it('treats different alpha values on the same RGB as distinct colors', () => {
    const imageData = makeImageData(2, 1, [
      [10, 20, 30, 255],
      [10, 20, 30, 128],
    ]);
    const colors = extractUniquePixelColors(imageData);
    expect(colors).toHaveLength(2);
  });
});

describe('extractPixelGrid', () => {
  it('produces a row-major grid with null for transparent pixels', () => {
    const imageData = makeImageData(2, 2, [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]);
    const grid = extractPixelGrid(imageData);
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(2);
    expect(grid.pixels).toEqual(['#ff0000ff', null, '#00ff00ff', '#0000ffff']);
  });
});

describe('quantizeImageData', () => {
  it('merges nearby colors together when reduced to few levels', () => {
    const imageData = makeImageData(2, 1, [
      [10, 10, 10, 255],
      [12, 9, 11, 255], // very close to the first pixel, should collapse to the same bucket
    ]);
    const quantized = quantizeImageData(imageData, 2);
    const colors = extractUniquePixelColors(quantized);
    expect(colors).toHaveLength(1);
  });

  it('keeps alpha untouched', () => {
    const imageData = makeImageData(1, 1, [[100, 150, 200, 128]]);
    const quantized = quantizeImageData(imageData, 4);
    expect(quantized.data[3]).toBe(128);
  });

  it('preserves width/height', () => {
    const imageData = makeImageData(3, 2, new Array(6).fill([0, 0, 0, 255]));
    const quantized = quantizeImageData(imageData, 8);
    expect(quantized.width).toBe(3);
    expect(quantized.height).toBe(2);
  });
});
