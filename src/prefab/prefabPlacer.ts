/**
 * Converts a PrefabData + placement position into a Command that can be
 * dispatched as APPLY_COMMAND to the editor reducer.
 */

import type { TileGrid, TileChange, EntityChange, ContainedEntityChange, DecalChange, Command, TileCell } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import type { DecalInstance } from '../import/decalParser';
import type { PrefabData } from './prefabTypes';
import { getCell } from '../state/editorState';
import { cloneComponentsWithPosRot } from '../tools/entityHelpers';
import { remapEntityRefs } from '../grid/entityRefs';

export interface PlacePrefabInput {
  prefab: PrefabData;
  placeX: number;
  placeY: number;
  grid: TileGrid;
  entities: ImportedEntity[];
  nextEntityId: number;
  nextDecalId?: number;
  /** Uid of the grid the prefab is placed on; placed entities become its children. */
  gridUid?: number;
}

export interface ResolvedDeviceLink {
  sourceUid: number;
  targetUid: number;
  port: string;
  sink: string;
}

export interface PlacePrefabResult {
  command: Command;
  rawComponentsMap: Record<number, string[]>;
  resolvedDeviceLinks: ResolvedDeviceLink[];
  nextEntityId: number;
}

const SPACE_CELL: TileCell = { tileId: 'Space' };

export function placePrefab(input: PlacePrefabInput): PlacePrefabResult {
  const { prefab, placeX, placeY, grid, entities, nextEntityId, nextDecalId = 0 } = input;

  // 1. Tile changes
  const tileChanges: TileChange[] = [];
  for (const tile of prefab.tiles) {
    const wx = placeX + tile.dx;
    const wy = placeY + tile.dy;
    const before = getCell(grid, wx, wy) ?? { ...SPACE_CELL };
    const after: TileCell = { tileId: tile.tileId };
    tileChanges.push({ x: wx, y: wy, before, after });
  }

  // 2. Entity removals, find existing entities within the prefab footprint
  const entityRemovals: EntityChange[] = [];
  const minX = placeX;
  const maxX = placeX + prefab.width - 1;
  const minY = placeY;
  const maxY = placeY + prefab.height - 1;

  for (const ent of entities) {
    const tileX = Math.floor(ent.position.x);
    const tileY = Math.floor(ent.position.y);
    if (tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY) {
      entityRemovals.push({ action: 'remove', entity: ent });
    }
  }

  // 3. Entity additions, assign fresh UIDs
  const entityAdditions: EntityChange[] = [];
  const containedAdditions: ContainedEntityChange[] = [];
  const rawComponentsMap: Record<number, string[]> = {};
  let uid = nextEntityId;

  // New uid per prefab entity (by index) and per uid the entity had where the prefab was saved.
  const indexToUid: number[] = prefab.entities.map(() => uid++);
  const srcToNew = new Map<number, number>();
  prefab.entities.forEach((pe, i) => { if (pe.srcUid !== undefined) srcToNew.set(pe.srcUid, indexToUid[i]); });

  // Version 2 prefabs store exact offsets; older ones store whole tiles (entity centered on the tile).
  const exactOffsets = (prefab.version ?? 1) >= 2;
  const placed: ImportedEntity[] = [];

  prefab.entities.forEach((pe, i) => {
    const newUid = indexToUid[i];
    const isContained = pe.containerIdx !== undefined;
    const newPos = isContained
      ? { x: 0, y: 0 }
      : exactOffsets
        ? { x: placeX + pe.dx, y: placeY + pe.dy }
        : { x: placeX + pe.dx + 0.5, y: placeY + pe.dy + 0.5 };

    let components = isContained
      ? pe.components.map(c => ({ ...c }))
      : cloneComponentsWithPosRot(pe.components, newPos, pe.rotation);

    // References between prefab entities follow them to their new uids; anything pointing outside
    // the prefab is dropped (its uid means something else in this map).
    components = remapEntityRefs(components, old => srcToNew.get(old));

    // The Transform parent in the file is from the map the prefab was saved on: reattach.
    const parentUid = isContained ? indexToUid[pe.containerIdx!] : input.gridUid;
    if (parentUid !== undefined) {
      components = components.map(c => (c.type === 'Transform' ? { ...c, parent: parentUid } : c));
    }

    const newEntity: ImportedEntity = {
      uid: newUid,
      prototype: pe.prototype,
      position: newPos,
      rotation: pe.rotation,
      components,
      ...(pe.spriteStateOverride ? { spriteStateOverride: pe.spriteStateOverride } : {}),
    };
    placed.push(newEntity);

    if (isContained) {
      containedAdditions.push({ action: 'add', parentUid: indexToUid[pe.containerIdx!], entity: newEntity, skipParentUpdate: true });
    } else {
      entityAdditions.push({ action: 'add', entity: newEntity });
    }

    // Note: raw YAML lines from the prefab template are NOT preserved here because
    // entity positions have changed, the exporter must re-serialize from components
  });

  // 5. Device link resolution
  const resolvedDeviceLinks: ResolvedDeviceLink[] = prefab.deviceLinks.map((dl) => ({
    sourceUid: indexToUid[dl.sourceIdx],
    targetUid: indexToUid[dl.targetIdx],
    port: dl.port,
    sink: dl.sink,
  }));
  applyDeviceLinks(placed, resolvedDeviceLinks);

  // 6. Decal additions, assign fresh IDs
  const decalChanges: DecalChange[] = [];
  let decalId = nextDecalId;
  for (const pd of prefab.decals ?? []) {
    const decal: DecalInstance = {
      id: decalId++,
      prototypeId: pd.prototypeId,
      position: { x: placeX + pd.dx, y: placeY + pd.dy },
      color: pd.color,
      angle: pd.angle,
      zIndex: pd.zIndex,
      cleanable: pd.cleanable,
    };
    decalChanges.push({ action: 'add', decal });
  }

  // 7. Build command
  const command: Command = {
    label: `Place prefab "${prefab.name}"`,
    tileChanges,
    entityChanges: [...entityRemovals, ...entityAdditions],
    ...(containedAdditions.length > 0 ? { containedEntityChanges: containedAdditions } : {}),
    decalChanges: decalChanges.length > 0 ? decalChanges : undefined,
  };

  return {
    command,
    rawComponentsMap,
    resolvedDeviceLinks,
    nextEntityId: uid,
  };
}

/**
 * Make sure each link is recorded on its source (`DeviceLinkSource.linkedPorts`). Prefabs saved
 * before entities carried their source uid have no other record of which devices were linked.
 */
function applyDeviceLinks(placed: ImportedEntity[], links: ResolvedDeviceLink[]): void {
  const byUid = new Map(placed.map(e => [e.uid, e]));
  for (const link of links) {
    const source = byUid.get(link.sourceUid);
    if (!source) continue;
    const idx = source.components.findIndex(c => c.type === 'DeviceLinkSource');
    if (idx < 0) continue;
    const comp = source.components[idx];
    const ports = { ...((comp.linkedPorts as Record<string, unknown[]> | undefined) ?? {}) };
    const key = String(link.targetUid);
    const pairs = [...(ports[key] ?? [])];
    if (!pairs.some(p => Array.isArray(p) && p[0] === link.port && p[1] === link.sink)) pairs.push([link.port, link.sink]);
    ports[key] = pairs;
    source.components = source.components.map((c, i) => (i === idx ? { ...comp, linkedPorts: ports } : c));
  }
}
