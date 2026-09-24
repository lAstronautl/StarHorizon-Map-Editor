import { describe, it, expect } from 'vitest';
import { getPeerColor } from '../peerColors';

describe('getPeerColor', () => {
  it('is deterministic for a given peerIndex', () => {
    expect(getPeerColor(0)).toBe(getPeerColor(0));
    expect(getPeerColor(3)).toBe(getPeerColor(3));
  });

  it('gives distinct colors to the first several peers', () => {
    const colors = [0, 1, 2, 3].map(getPeerColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('cycles the palette for peer counts beyond palette size', () => {
    const first = getPeerColor(0);
    const paletteSize = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(getPeerColor)).size;
    expect(getPeerColor(paletteSize)).toBe(first);
  });
});
