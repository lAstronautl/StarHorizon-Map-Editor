import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAverageTileColor, findClosestTileByColor, hexToRgba } from '../tileColorAverages';

describe('hexToRgba', () => {
  it('parses 8-digit hex with alpha', () => {
    expect(hexToRgba('#ff804020')).toEqual({ r: 255, g: 128, b: 64, a: 32 });
  });

  it('defaults alpha to 255 for 6-digit hex', () => {
    expect(hexToRgba('#ff8040')).toEqual({ r: 255, g: 128, b: 64, a: 255 });
  });
});

describe('findClosestTileByColor', () => {
  it('picks the tile with the smallest Euclidean RGBA distance', () => {
    const cache = new Map([
      ['FloorSteel', { r: 200, g: 200, b: 200, a: 255 }],
      ['FloorWood', { r: 150, g: 100, b: 50, a: 255 }],
      ['Plating', { r: 210, g: 195, b: 205, a: 255 }],
    ]);
    // Closest to a light grey should be Plating, not the exact-ish FloorSteel or the
    // clearly-distant FloorWood.
    expect(findClosestTileByColor('#d0c8caff', cache)).toBe('Plating');
  });

  it('returns null for an empty cache', () => {
    expect(findClosestTileByColor('#ffffffff', new Map())).toBeNull();
  });
});

describe('computeAverageTileColor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvas(fakeData: Uint8ClampedArray) {
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({ data: fakeData, width: 0, height: 0, colorSpace: 'srgb' }) as ImageData,
      }),
    };
    vi.stubGlobal('document', { createElement: () => fakeCanvas });
  }

  it('averages only non-transparent pixels', () => {
    // 2x1 image: one opaque red pixel, one fully transparent pixel that must be ignored.
    stubCanvas(new Uint8ClampedArray([
      255, 0, 0, 255,
      10, 20, 30, 0,
    ]));

    const fakeImg = { width: 2, height: 1 } as HTMLImageElement;
    const result = computeAverageTileColor(fakeImg, 1);
    expect(result).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('returns null when every pixel is fully transparent', () => {
    stubCanvas(new Uint8ClampedArray([0, 0, 0, 0]));

    const fakeImg = { width: 1, height: 1 } as HTMLImageElement;
    expect(computeAverageTileColor(fakeImg, 1)).toBeNull();
  });
});
