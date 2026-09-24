import { describe, it, expect } from 'vitest';
import { buildPrefabFromColorGrid, createEmptyAssignment } from '../colorMapping';
import type { PixelGrid } from '../pixelColors';
import type { ColorAssignment } from '../colorMapping';

describe('buildPrefabFromColorGrid', () => {
  it('inverts the Y axis: top row of the image becomes the highest dy', () => {
    const grid: PixelGrid = {
      width: 1,
      height: 2,
      pixels: ['#ff0000ff', '#00ff00ff'], // row 0 (top) = red, row 1 (bottom) = green
    };
    const assignments: Record<string, ColorAssignment> = {
      '#ff0000ff': { tileId: 'FloorSteel', entityIds: [] },
      '#00ff00ff': { tileId: 'FloorWood', entityIds: [] },
    };
    const prefab = buildPrefabFromColorGrid(grid, assignments, 'test');

    expect(prefab.width).toBe(1);
    expect(prefab.height).toBe(2);
    expect(prefab.tiles).toContainEqual({ dx: 0, dy: 1, tileId: 'FloorSteel' }); // top row -> dy=height-1
    expect(prefab.tiles).toContainEqual({ dx: 0, dy: 0, tileId: 'FloorWood' }); // bottom row -> dy=0
  });

  it('skips pixels with no assignment and fully transparent pixels', () => {
    const grid: PixelGrid = {
      width: 2,
      height: 1,
      pixels: ['#ff0000ff', null],
    };
    const prefab = buildPrefabFromColorGrid(grid, {}, 'test');
    expect(prefab.tiles).toHaveLength(0);
    expect(prefab.entities).toHaveLength(0);
  });

  it('does not emit a tile for an assignment with tileId: null (Space/skip)', () => {
    const grid: PixelGrid = { width: 1, height: 1, pixels: ['#ff0000ff'] };
    const assignments = { '#ff0000ff': createEmptyAssignment() };
    const prefab = buildPrefabFromColorGrid(grid, assignments, 'test');
    expect(prefab.tiles).toHaveLength(0);
  });

  it('stacks multiple entities for one color at the same tile center, preserving order', () => {
    const grid: PixelGrid = { width: 1, height: 1, pixels: ['#ff0000ff'] };
    const assignments: Record<string, ColorAssignment> = {
      '#ff0000ff': { tileId: null, entityIds: ['SpawnPointLatejoin', 'CrateGenericSteel'] },
    };
    const prefab = buildPrefabFromColorGrid(grid, assignments, 'test');

    expect(prefab.entities).toEqual([
      { dx: 0.5, dy: 0.5, prototype: 'SpawnPointLatejoin', rotation: 0, components: [] },
      { dx: 0.5, dy: 0.5, prototype: 'CrateGenericSteel', rotation: 0, components: [] },
    ]);
  });

  it('combines a tile and entities for the same color', () => {
    const grid: PixelGrid = { width: 1, height: 1, pixels: ['#ff0000ff'] };
    const assignments: Record<string, ColorAssignment> = {
      '#ff0000ff': { tileId: 'FloorSteel', entityIds: ['TableSteel'] },
    };
    const prefab = buildPrefabFromColorGrid(grid, assignments, 'test');

    expect(prefab.tiles).toEqual([{ dx: 0, dy: 0, tileId: 'FloorSteel' }]);
    expect(prefab.entities).toEqual([{ dx: 0.5, dy: 0.5, prototype: 'TableSteel', rotation: 0, components: [] }]);
  });
});
