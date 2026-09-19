import { describe, it, expect } from 'vitest';
import { getSymmetricPositions, getSymmetricWorldPositions } from '../symmetrySettings';
import type { SymmetrySettings } from '../symmetrySettings';

describe('getSymmetricPositions (discrete tile indices)', () => {
  it('returns only the original position when mode is none', () => {
    expect(getSymmetricPositions(5, 3, { mode: 'none', axis: 'vertical' })).toEqual([{ x: 5, y: 3 }]);
  });

  it('mirrors vertically: tile x -> -1-x, y unchanged', () => {
    const settings: SymmetrySettings = { mode: 'mirror', axis: 'vertical' };
    expect(getSymmetricPositions(0, 3, settings)).toEqual([{ x: 0, y: 3 }, { x: -1, y: 3 }]);
    expect(getSymmetricPositions(5, 3, settings)).toEqual([{ x: 5, y: 3 }, { x: -6, y: 3 }]);
    expect(getSymmetricPositions(-1, 3, settings)).toEqual([{ x: -1, y: 3 }, { x: 0, y: 3 }]);
  });

  it('mirrors horizontally: tile y -> -1-y, x unchanged', () => {
    const settings: SymmetrySettings = { mode: 'mirror', axis: 'horizontal' };
    expect(getSymmetricPositions(5, 0, settings)).toEqual([{ x: 5, y: 0 }, { x: 5, y: -1 }]);
    expect(getSymmetricPositions(5, 4, settings)).toEqual([{ x: 5, y: 4 }, { x: 5, y: -5 }]);
  });

  it('fourWay reflects across both axes, producing 4 distinct tiles', () => {
    const settings: SymmetrySettings = { mode: 'fourWay', axis: 'vertical' };
    const result = getSymmetricPositions(5, 3, settings);
    expect(result).toHaveLength(4);
    expect(result).toEqual(expect.arrayContaining([
      { x: 5, y: 3 }, { x: -6, y: 3 }, { x: 5, y: -4 }, { x: -6, y: -4 },
    ]));
  });

  it('fourWay dedups when a coordinate is its own mirror is not possible for integers, but never produces duplicates regardless', () => {
    // No integer tile index equals its own mirror (-1-x = x => x = -0.5, never an integer),
    // so fourWay always yields exactly 4 distinct tiles for any integer input.
    const settings: SymmetrySettings = { mode: 'fourWay', axis: 'vertical' };
    const result = getSymmetricPositions(0, 0, settings);
    expect(result).toHaveLength(4);
    const keys = new Set(result.map(p => `${p.x},${p.y}`));
    expect(keys.size).toBe(4);
  });
});

describe('getSymmetricWorldPositions (continuous coordinates)', () => {
  it('returns only the original position when mode is none', () => {
    expect(getSymmetricWorldPositions(5.5, 3.5, { mode: 'none', axis: 'vertical' })).toEqual([{ x: 5.5, y: 3.5 }]);
  });

  it('mirrors vertically: world x -> -x, consistent with tile-index mirroring', () => {
    const settings: SymmetrySettings = { mode: 'mirror', axis: 'vertical' };
    // Tile 0 (world center 0.5) mirrors to tile -1 (world center -0.5) — matches
    // getSymmetricPositions(0, y) -> tile -1 above.
    expect(getSymmetricWorldPositions(0.5, 3.5, settings)).toEqual([{ x: 0.5, y: 3.5 }, { x: -0.5, y: 3.5 }]);
  });

  it('mirrors horizontally: world y -> -y', () => {
    const settings: SymmetrySettings = { mode: 'mirror', axis: 'horizontal' };
    expect(getSymmetricWorldPositions(5.5, 0.5, settings)).toEqual([{ x: 5.5, y: 0.5 }, { x: 5.5, y: -0.5 }]);
  });

  it('dedups when a world coordinate is exactly on the mirror line (x=0)', () => {
    const settings: SymmetrySettings = { mode: 'mirror', axis: 'vertical' };
    // Free (shift) placement can land exactly on x=0; mirroring gives the same point back.
    expect(getSymmetricWorldPositions(0, 3.5, settings)).toEqual([{ x: 0, y: 3.5 }]);
  });

  it('fourWay reflects across both axes for free/fractional positions', () => {
    const settings: SymmetrySettings = { mode: 'fourWay', axis: 'vertical' };
    const result = getSymmetricWorldPositions(2.3, 1.7, settings);
    expect(result).toHaveLength(4);
    expect(result).toEqual(expect.arrayContaining([
      { x: 2.3, y: 1.7 }, { x: -2.3, y: 1.7 }, { x: 2.3, y: -1.7 }, { x: -2.3, y: -1.7 },
    ]));
  });
});
