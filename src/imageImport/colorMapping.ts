import type { PrefabData, PrefabTile, PrefabEntity } from '../prefab/prefabTypes';
import type { PixelGrid } from './pixelColors';

/** What a single pixel color has been mapped to: a tile, any number of entities stacked
 *  on that tile's center, or both. `tileId: null` means "no tile" (Space/skip). */
export interface ColorAssignment {
  tileId: string | null;
  entityIds: string[];
}

export function createEmptyAssignment(): ColorAssignment {
  return { tileId: null, entityIds: [] };
}

/**
 * Turns a decoded image's pixel grid + per-color tile/entity assignments into a stampable
 * PrefabData, exactly like any other prefab (see prefabSerializer.ts for the analogous path
 * from a map selection). Colors with no assignment (or fully transparent pixels) are simply
 * skipped — PrefabTile only ever stores non-Space tiles, so there's nothing special to do
 * for "no tile" beyond not pushing an entry.
 *
 * The image's row 0 is its top row, but world Y increases upward, so pixel row `y` maps to
 * `dy = height - 1 - y` (same inversion as map-converter-ss14's ImageReader).
 */
export function buildPrefabFromColorGrid(
  grid: PixelGrid,
  assignments: Record<string, ColorAssignment>,
  name: string,
): PrefabData {
  const { width, height, pixels } = grid;
  const tiles: PrefabTile[] = [];
  const entities: PrefabEntity[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = pixels[y * width + x];
      if (!hex) continue;
      const assignment = assignments[hex];
      if (!assignment) continue;

      const dx = x;
      const dy = height - 1 - y;

      if (assignment.tileId) {
        tiles.push({ dx, dy, tileId: assignment.tileId });
      }
      for (const prototype of assignment.entityIds) {
        entities.push({
          dx: dx + 0.5,
          dy: dy + 0.5,
          prototype,
          rotation: 0,
          components: [],
        });
      }
    }
  }

  return { name, width, height, tiles, entities, deviceLinks: [] };
}
