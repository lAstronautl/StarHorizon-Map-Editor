import type { TileGrid } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import type { DecalInstance } from '../import/decalParser';
import type { PrefabData, PrefabTile, PrefabEntity, PrefabDeviceLink, PrefabDecal } from './prefabTypes';
import { getCell } from '../state/editorState';

export interface SerializePrefabInput {
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  grid: TileGrid;
  entities: ImportedEntity[];
  /** Entities inside containers of `entities`, keyed by container uid; they go into the prefab too. */
  containedEntities?: Record<number, ImportedEntity[]>;
  /** @deprecated Raw YAML lines are no longer stored: they carry the source map's uids and positions. */
  entityRawComponents?: Record<number, string[]>;
  /** Only the tiles in this set ("x,y") are part of the prefab; absent = the whole rectangle. */
  selectedTiles?: ReadonlySet<string>;
  decals?: DecalInstance[];
}

export function serializePrefab(input: SerializePrefabInput): PrefabData {
  const { name, minX, minY, maxX, maxY, grid, entities, containedEntities, selectedTiles, decals } = input;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  const covers = (tileX: number, tileY: number): boolean =>
    tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY
    && (!selectedTiles || selectedTiles.has(`${tileX},${tileY}`));

  // 1. Sparse tile capture: iterate (minX..maxX, minY..maxY), skip Space tiles
  const tiles: PrefabTile[] = [];
  for (let wy = minY; wy <= maxY; wy++) {
    for (let wx = minX; wx <= maxX; wx++) {
      if (!covers(wx, wy)) continue;
      const cell = getCell(grid, wx, wy);
      if (cell && cell.tileId !== 'Space') {
        tiles.push({ dx: wx - minX, dy: wy - minY, tileId: cell.tileId });
      }
    }
  }

  // 2. Entity capture: entities whose tile (floor of position) is covered
  const insideEntities: ImportedEntity[] = entities.filter(
    ent => covers(Math.floor(ent.position.x), Math.floor(ent.position.y)),
  );

  // 3. Prefab entity list: each entity, then (depth-first) whatever is inside it
  const prefabEntities: PrefabEntity[] = [];
  const indexOfUid = new Map<number, number>();
  const capture = (ent: ImportedEntity, containerIdx?: number): void => {
    const idx = prefabEntities.length;
    indexOfUid.set(ent.uid, idx);
    const pe: PrefabEntity = containerIdx === undefined
      // Exact offset from the prefab corner, so an entity keeps its place inside the tile.
      ? { dx: ent.position.x - minX, dy: ent.position.y - minY, prototype: ent.prototype, rotation: ent.rotation, components: ent.components.map(c => ({ ...c })), srcUid: ent.uid }
      : { dx: 0, dy: 0, prototype: ent.prototype, rotation: ent.rotation, components: ent.components.map(c => ({ ...c })), srcUid: ent.uid, containerIdx };
    if (ent.spriteStateOverride) {
      pe.spriteStateOverride = ent.spriteStateOverride;
    }
    prefabEntities.push(pe);
    for (const child of containedEntities?.[ent.uid] ?? []) capture(child, idx);
  };
  for (const ent of insideEntities) capture(ent);

  // 4. Capture device links: DeviceLinkSource linkedPorts (only if both source and target inside)
  const deviceLinks: PrefabDeviceLink[] = [];
  prefabEntities.forEach((pe, i) => {
    for (const comp of pe.components) {
      const c = comp as Record<string, unknown>;
      if (c.type === 'DeviceLinkSource' && c.linkedPorts && typeof c.linkedPorts === 'object') {
        const ports = c.linkedPorts as Record<string, unknown>;
        for (const [targetUidStr, pairs] of Object.entries(ports)) {
          if (!Array.isArray(pairs)) continue; // defensive: malformed/non-array linkedPorts entry
          const targetIdx = indexOfUid.get(Number(targetUidStr));
          if (targetIdx === undefined) continue;
          for (const pair of pairs) {
            if (!Array.isArray(pair) || pair.length < 2) continue;
            const [port, sink] = pair;
            deviceLinks.push({ sourceIdx: i, targetIdx, port, sink });
          }
        }
      }
    }
  });

  // 5. Decal capture: decals whose tile is covered
  const prefabDecals: PrefabDecal[] = [];
  for (const d of decals ?? []) {
    if (!covers(Math.floor(d.position.x), Math.floor(d.position.y))) continue;
    prefabDecals.push({
      dx: d.position.x - minX,
      dy: d.position.y - minY,
      prototypeId: d.prototypeId,
      color: d.color,
      angle: d.angle,
      zIndex: d.zIndex,
      cleanable: d.cleanable,
    });
  }

  return {
    version: 2,
    name, width, height, tiles, entities: prefabEntities, deviceLinks,
    ...(prefabDecals.length > 0 ? { decals: prefabDecals } : {}),
  };
}
