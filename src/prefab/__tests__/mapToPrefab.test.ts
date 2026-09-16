import { describe, it, expect } from 'vitest';
import { mapToPrefab } from '../mapToPrefab';

/**
 * Build a base64-encoded 16x16 chunk where each tile is 6 bytes (format 6):
 *   int32 LE tileIndex + uint8 flags (0) + uint8 variant (0).
 */
function makeChunkBase64(tileAssignments: Record<number, number>): string {
  const BYTES_PER_TILE = 6;
  const buf = new Uint8Array(256 * BYTES_PER_TILE);
  const view = new DataView(buf.buffer);
  for (const [idx, tileIndex] of Object.entries(tileAssignments)) {
    const offset = Number(idx) * BYTES_PER_TILE;
    view.setInt32(offset, tileIndex, true);
  }
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function buildTestMap(): string {
  const chunk00 = makeChunkBase64({ 0: 1, 1: 2 });
  return `meta:
  format: 6
  postmapinit: false

tilemap:
  0: Space
  1: FloorSteel
  2: Plating

entities:
- proto: ""
  entities:
  - uid: 0
    components:
    - type: MetaData
      name: Map Entity
    - type: Transform
    - type: Map
      mapPaused: True
  - uid: 1
    components:
    - type: MetaData
      name: Station
    - type: Transform
      parent: 0
    - type: MapGrid
      chunks:
        0,0:
          ind: 0,0
          tiles: ${chunk00}
          version: 6
- proto: APCBasic
  entities:
  - uid: 100
    components:
    - type: Transform
      pos: 0.5,0.5
      parent: 1
    - type: Battery
      startingCharge: 25000
`;
}

describe('mapToPrefab', () => {
  it('converts a whole map into a prefab covering its full grid bounds', () => {
    const prefab = mapToPrefab(buildTestMap(), 'MyStation');
    expect(prefab.name).toBe('MyStation');
    expect(prefab.width).toBe(16);
    expect(prefab.height).toBe(16);
  });

  it('captures tiles from the map as sparse prefab tiles', () => {
    const prefab = mapToPrefab(buildTestMap(), 'MyStation');
    expect(prefab.tiles).toContainEqual({ dx: 0, dy: 0, tileId: 'FloorSteel' });
    expect(prefab.tiles).toContainEqual({ dx: 1, dy: 0, tileId: 'Plating' });
  });

  it('captures entities from the map as prefab entities', () => {
    const prefab = mapToPrefab(buildTestMap(), 'MyStation');
    expect(prefab.entities).toHaveLength(1);
    expect(prefab.entities[0].prototype).toBe('APCBasic');
    expect(prefab.entities[0].dx).toBe(0);
    expect(prefab.entities[0].dy).toBe(0);
  });
});
