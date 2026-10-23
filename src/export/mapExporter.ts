/**
 * Export an ImportedMap back to SS14 map YAML (format 6 or 7).
 *
 * This is the counterpart to mapImporter, it takes the in-memory ImportedMap
 * representation and produces a valid YAML string that SS14 can load.
 *
 * Key steps:
 *  1. Build tilemap (index <-> tileId mappings)
 *  2. Encode 16x16 tile chunks to base64 (6 or 7 bytes/tile)
 *  3. Emit structural entities (map + grid) with preserved components
 *  4. Group non-structural entities by prototype and emit verbatim components
 */

import type { ImportedMap, ImportedEntity } from '../import/mapImporter';
import type { GridData } from '../state/gridData';
import type { TileGrid } from '../types';
import type { DecalInstance } from '../import/decalParser';
import { serializeDecalGrid } from './decalExporter';
import { remapEntityRefs } from '../grid/entityRefs';
import {
  ENGINE_VERSION,
  collectUsedUids,
  defaultMapComponents,
  findComponent,
  makeTransform,
  nextFreeUid,
  synthesizeGridComponents,
} from './gridStructure';

// ---- Constants ----

const CHUNK_SIZE = 16;
const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

// ---- Main entry point ----

/** A structural (prototype-less) entity about to be written: the map or a grid. */
interface StructuralEntry {
  uid: number;
  components: Record<string, unknown>[];
  /** Replay the entity's raw YAML lines (only for entities that came from the file and were not restructured). */
  raw: boolean;
  /** Not in the file: its DecalGrid must be written from the editor's decal state. */
  synthesized?: boolean;
}

export function exportMap(input: ImportedMap, decalsDirty?: Set<number>): string {
  const full = withGridDataList(input);
  const format = full.meta.format;
  const { tilemap, reverseTilemap } = buildTilemap(full);
  const allChunks = buildGridChunksMap(full, reverseTilemap);

  // The game deletes a grid that has no tiles left (game.delete_empty_grids), so it never saves
  // one, and an empty `chunks:` would not load. Mirror that: grids without tiles (and their
  // entities) are left out.
  const liveGrids = full.gridDataList!.filter(g => (allChunks.get(g.gridUid)?.length ?? 0) > 0);
  const map: ImportedMap = liveGrids.length === full.gridDataList!.length ? full : { ...full, gridDataList: liveGrids };

  const entries = buildStructuralEntries(map);
  const decalsByGrid = buildGridDecalsMap(map, decalsDirty, new Set(entries.filter(e => e.synthesized).map(e => e.uid)));
  const structuralUids = new Set(entries.map(e => e.uid));
  const entityGroups = buildEntityGroupsYaml(map, structuralUids);
  const header = computeHeaderLists(entries, map);

  const lines: string[] = [];

  // Meta
  lines.push('meta:');
  lines.push(`  format: ${format}`);
  // Format 7+ files must always declare a category: the engine only infers
  // category from map count for format < 7 (EntityDeserializer.InferCategory
  // is gated on Version < 7); an absent category on a v7+ file stays
  // FileCategory.Unknown and loadmap's expected-category checks misbehave.
  if (format >= 7) {
    lines.push(`  category: ${resolveCategory(map.meta.category, header)}`);
  } else if (map.meta.category) {
    lines.push(`  category: ${map.meta.category}`);
  }
  const engineVersion = map.meta.engineVersion ?? (format >= 7 ? ENGINE_VERSION : undefined);
  if (engineVersion) lines.push(`  engineVersion: ${engineVersion}`);
  const forkId = map.meta.forkId ?? (format >= 7 ? '' : undefined);
  if (forkId !== undefined) lines.push(`  forkId: ${formatPrimitive(forkId)}`);
  const forkVersion = map.meta.forkVersion ?? (format >= 7 ? '' : undefined);
  if (forkVersion !== undefined) lines.push(`  forkVersion: ${formatPrimitive(forkVersion)}`);
  const time = map.meta.time ?? (format >= 7 ? formatSaveTime(new Date()) : undefined);
  if (time) lines.push(`  time: ${time}`);
  if (map.meta.entityCount !== undefined || format >= 7) {
    lines.push(`  entityCount: ${entries.length + entityGroups.count}`);
  }
  // postmapinit only exists before format 7 (the v7 loader ignores it). Keep it where the file had it.
  if (format < 7 && map.meta.postmapinit !== undefined) {
    lines.push(`  postmapinit: ${map.meta.postmapinit ? 'true' : 'false'}`);
  }

  // Format 7+ top-level keys. Derived from what is actually emitted so the lists can never
  // disagree with the entities (the engine reads them with Get<SequenceDataNode>, so an
  // empty list must be `[]`, never a bare `key:`).
  if (format >= 7) {
    emitIdList(lines, 'maps', header.maps);
    emitIdList(lines, 'grids', header.grids);
    emitIdList(lines, 'orphans', header.orphans);
    emitIdList(lines, 'nullspace', header.nullspace);
  }

  // Tilemap in ascending engine tile id: Space first, then the rest ordinal by name.
  lines.push('tilemap:');
  const tilemapEntries = Object.entries(tilemap).map(([k, v]) => [Number(k), v] as [number, string]);
  tilemapEntries.sort((a, b) => {
    if (a[1] === 'Space') return -1;
    if (b[1] === 'Space') return 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  for (const [idx, name] of tilemapEntries) {
    lines.push(`  ${idx}: ${name}`);
  }

  // Entities section: the prototype-less group (map + grids) comes first, in uid order.
  lines.push('entities:');
  lines.push('- proto: ""');
  lines.push('  entities:');
  for (const entry of entries) {
    emitStructuralEntry(lines, entry, map, allChunks.get(entry.uid) ?? [], decalsByGrid.get(entry.uid));
  }

  // Entity groups, use a loop to avoid stack overflow with large arrays
  for (const line of entityGroups.lines) {
    lines.push(line);
  }

  // The engine always terminates format 7+ documents with `...`; older files keep what they had.
  if (map.hasDocumentTerminator || format >= 7) {
    lines.push('...');
  }

  const eol = map.lineEnding === '\r\n' ? '\r\n' : '\n';
  return lines.join(eol) + eol;
}

/** `MM/dd/yyyy HH:mm:ss` (UTC), the format of `meta.time`. */
function formatSaveTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Maps built without `gridDataList` (single legacy grid) get one, so there is a single export path. */
function withGridDataList(map: ImportedMap): ImportedMap {
  if (map.gridDataList) return map;
  return {
    ...map,
    gridDataList: [{
      gridUid: map.gridUid,
      name: 'Station',
      grid: map.grid,
      entities: map.entities,
      containedEntities: map.containedEntities ?? {},
      worldPosition: { x: 0, y: 0 },
      structuralComponents: [],
      chunkKeyOrder: map.chunkKeyOrder ?? [],
      decals: { decals: [], nextDecalId: 0 },
    } satisfies GridData],
  };
}

/**
 * Work out the map and grid entities of the file. Entities that came from the file are kept as
 * they are (their raw YAML is replayed); everything the editor added is built the way the game
 * saves it: a map entity if the file had none, and a full grid entity for every grid without one.
 */
function buildStructuralEntries(map: ImportedMap): StructuralEntry[] {
  const grids = map.gridDataList ?? [];
  const liveUids = new Set(grids.map(g => g.gridUid));
  const existing = map.structuralEntityData ?? {};
  const used = collectUsedUids(map);

  const entries: StructuralEntry[] = [];
  for (const [k, components] of Object.entries(existing)) {
    const uid = Number(k);
    if (findComponent(components, 'MapGrid') && !liveUids.has(uid)) continue; // emptied or removed grid
    entries.push({ uid, components, raw: true });
  }

  const byUid = (uid: number) => entries.find(e => e.uid === uid);
  const hasMap = entries.some(e => findComponent(e.components, 'Map'));

  // A grid file: no map, one grid saved as an orphan (`parent: invalid`).
  let isGridFile = false;
  if (!hasMap && grids.length === 1) {
    const only = byUid(grids[0].gridUid);
    if (only) {
      // A lone grid with no map and no parent is what a grid file looks like (v6 omits `parent: invalid`).
      const parent = findComponent(only.components, 'Transform')?.parent;
      isGridFile = parent === 'invalid' || parent == null;
    } else {
      isGridFile = map.meta.category === 'Grid';
    }
  }

  let mapUid = entries.find(e => findComponent(e.components, 'Map'))?.uid ?? map.mapUid;
  if (!hasMap && !isGridFile) {
    mapUid = map.mapUid > 0 && !used.has(map.mapUid) ? map.mapUid : nextFreeUid(used);
    entries.push({ uid: mapUid, components: defaultMapComponents(), raw: false });
    // Grids that were the root of a grid file now hang off the new map.
    for (const entry of entries) {
      if (!findComponent(entry.components, 'MapGrid')) continue;
      const parent = findComponent(entry.components, 'Transform')?.parent;
      if (parent === 'invalid' || parent == null) {
        entry.components = entry.components.map(c => (c.type === 'Transform' ? { ...c, parent: mapUid } : c));
        if (!findComponent(entry.components, 'Transform')) entry.components.splice(1, 0, makeTransform(mapUid));
        entry.raw = false;
      }
    }
  }

  // A grid built in the editor may carry components copied from another grid; references they hold
  // to entities that are not in this file would point at nothing (or at something unrelated).
  const inFile = new Set<number>([...used, mapUid]);
  for (const gd of grids) {
    if (byUid(gd.gridUid)) continue;
    entries.push({
      uid: gd.gridUid,
      components: remapEntityRefs(synthesizeGridComponents(gd, isGridFile ? 'invalid' : mapUid), uid => (inFile.has(uid) ? uid : undefined)),
      raw: false,
      synthesized: true,
    });
  }

  return entries.sort((a, b) => a.uid - b.uid);
}

function emitStructuralEntry(
  lines: string[],
  entry: StructuralEntry,
  map: ImportedMap,
  chunkLines: string[],
  decalLines: string[] | undefined,
): void {
  const { uid } = entry;
  lines.push(`  - uid: ${uid}`);
  // Entity-level preamble lines (mapInit, paused) are only known for entities from the file.
  if (entry.raw) {
    for (const pl of map.entityRawPreamble?.[uid] ?? []) lines.push(pl);
  }
  lines.push('    components:');

  const rawLines = entry.raw ? map.entityRawComponents?.[uid] : undefined;
  if (rawLines) {
    // Replay the raw lines, swapping in the rebuilt MapGrid chunks and (if dirty) DecalGrid.
    emitStructuralEntityRawWithReplacements(lines, rawLines, chunkLines, decalLines);
    return;
  }

  let hasDecalGrid = false;
  for (const comp of entry.components) {
    const stripped = stripInternalTags(comp) as Record<string, unknown>;
    if (stripped.type === 'MapGrid') {
      lines.push('    - type: MapGrid');
      for (const [k, v] of Object.entries(stripped)) {
        if (k === 'type') continue;
        emitValue(lines, k, v, 6);
      }
      if (chunkLines.length > 0) {
        lines.push('      chunks:');
        for (const cl of chunkLines) lines.push(cl);
      }
    } else if (stripped.type === 'DecalGrid' && decalLines) {
      hasDecalGrid = true;
      for (const dl of decalLines) lines.push(dl);
    } else {
      emitComponent(lines, stripped);
    }
  }
  // A grid without a DecalGrid that now has decals gets one.
  if (!hasDecalGrid && decalLines) {
    for (const dl of decalLines) lines.push(dl);
  }
}

// ---- Header lists (maps / grids / orphans / nullspace) ----

interface HeaderLists {
  maps: number[];
  grids: number[];
  orphans: number[];
  nullspace: number[];
}

function emitIdList(lines: string[], key: string, ids: number[]): void {
  if (ids.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  for (const uid of ids) lines.push(`- ${uid}`);
}

/**
 * Derive the format 7 header lists from the entities that are about to be written, the same
 * way EntitySerializer does: `maps` = entities with Map, `grids` = entities with MapGrid,
 * `orphans` = entities saved with `parent: invalid`, `nullspace` = entities that were loaded
 * from the file's nullspace list and are still present.
 */
function computeHeaderLists(entries: StructuralEntry[], map: ImportedMap): HeaderLists {
  const maps: number[] = [];
  const grids: number[] = [];
  const orphans: number[] = [];
  const parentOf = new Map<number, unknown>();

  for (const { uid, components } of entries) {
    if (findComponent(components, 'Map')) maps.push(uid);
    if (findComponent(components, 'MapGrid')) grids.push(uid);
    const parent = findComponent(components, 'Transform')?.parent;
    parentOf.set(uid, parent);
    if (parent === 'invalid') orphans.push(uid);
  }

  const emitted = new Set<number>(entries.map(e => e.uid));
  const all: ImportedEntity[] = [...getAllEntities(map), ...Object.values(getAllContainedEntities(map)).flat()];
  for (const e of all) {
    emitted.add(e.uid);
    const parent = findComponent(e.components, 'Transform')?.parent;
    parentOf.set(e.uid, parent);
    if (parent === 'invalid') orphans.push(e.uid);
  }

  // Keep orphans the file declared even if their Transform omits `parent:` (hand-edited maps do this
  // and the engine accepts it), as long as they still exist and haven't been given a real parent.
  for (const uid of map.orphans ?? []) {
    if (emitted.has(uid) && parentOf.get(uid) == null) orphans.push(uid);
  }
  const nullspace = (map.nullspace ?? []).filter(uid => emitted.has(uid));

  return { maps, grids, orphans: [...new Set(orphans)], nullspace };
}

/**
 * Pick the `meta.category` for the exported lists. The original category is kept when it
 * is consistent with the content (engine: EntitySerializer.InferCategory / TrySave*);
 * otherwise it is inferred the same way the engine does.
 */
function resolveCategory(original: string | undefined, h: HeaderLists): string {
  const isGrid = h.maps.length === 0 && h.grids.length === 1 && h.orphans.length === 1 && h.orphans[0] === h.grids[0];
  const isMap = h.maps.length === 1;
  const isEntity = h.maps.length === 0 && h.grids.length === 0 && h.orphans.length === 1;
  if (original === 'Save') return 'Save';
  if (original === 'Grid' && isGrid) return 'Grid';
  if (original === 'Map' && isMap) return 'Map';
  if (original === 'Entity' && isEntity) return 'Entity';
  if (isMap) return 'Map';
  if (isGrid) return 'Grid';
  if (isEntity) return 'Entity';
  return original && original !== 'Unknown' ? original : 'Unknown';
}

// ---- Tilemap building ----

/** Collect all grid cells across all grids (or fall back to legacy single grid). */
function getAllGridCells(map: ImportedMap): import('../types').TileCell[] {
  if (map.gridDataList && map.gridDataList.length > 0) {
    const allCells: import('../types').TileCell[] = [];
    for (const gd of map.gridDataList) {
      for (const cell of gd.grid.cells) {
        allCells.push(cell);
      }
    }
    return allCells;
  }
  return map.grid.cells;
}

/** Collect all non-structural entities across all grids (or fall back to legacy). */
function getAllEntities(map: ImportedMap): ImportedEntity[] {
  if (map.gridDataList && map.gridDataList.length > 0) {
    const all: ImportedEntity[] = [];
    for (const gd of map.gridDataList) {
      all.push(...gd.entities);
    }
    return all;
  }
  return map.entities;
}

/** Collect all contained entities across all grids (or fall back to legacy). */
function getAllContainedEntities(map: ImportedMap): Record<number, ImportedEntity[]> {
  if (map.gridDataList && map.gridDataList.length > 0) {
    const all: Record<number, ImportedEntity[]> = {};
    for (const gd of map.gridDataList) {
      for (const [parentUid, children] of Object.entries(gd.containedEntities)) {
        all[Number(parentUid)] = children;
      }
    }
    return all;
  }
  return map.containedEntities ?? {};
}

function buildTilemap(map: ImportedMap): {
  tilemap: Record<number, string>;
  reverseTilemap: Record<string, number>;
} {
  // Preserve the original tilemap indices for roundtrip fidelity.
  // This ensures chunk base64 data is identical to the original.
  if (map.tilemap && Object.keys(map.tilemap).length > 0) {
    const tilemap: Record<number, string> = { ...map.tilemap };
    const reverseTilemap: Record<string, number> = {};
    for (const [idx, name] of Object.entries(tilemap)) {
      reverseTilemap[name] = Number(idx);
    }

    // Add any NEW tile types not in the original tilemap (from user edits)
    // Scan ALL grids' cells for new tile types
    let maxIndex = Math.max(...Object.keys(tilemap).map(Number));
    for (const cell of getAllGridCells(map)) {
      if (!(cell.tileId in reverseTilemap)) {
        maxIndex++;
        tilemap[maxIndex] = cell.tileId;
        reverseTilemap[cell.tileId] = maxIndex;
      }
    }

    return { tilemap, reverseTilemap };
  }

  // Fallback for maps without a tilemap (e.g. programmatically created)
  const tileIds = new Set<string>();
  for (const cell of getAllGridCells(map)) {
    tileIds.add(cell.tileId);
  }

  const tilemap: Record<number, string> = { 0: 'Space' };
  const reverseTilemap: Record<string, number> = { Space: 0 };
  tileIds.delete('Space');

  let nextIndex = 1;
  for (const tileId of [...tileIds].sort()) {
    tilemap[nextIndex] = tileId;
    reverseTilemap[tileId] = nextIndex;
    nextIndex++;
  }

  return { tilemap, reverseTilemap };
}

// ---- Chunk encoding ----

interface ChunkTile {
  typeId: number;
  flags: number;
  variant: number;
  rotationMirroring: number;
}

/**
 * Build chunk YAML lines for a single grid.
 */
function buildChunksYamlForGrid(
  grid: TileGrid,
  format: number,
  reverseTilemap: Record<string, number>,
  chunkKeyOrder?: string[],
): string[] {
  const { width, height, offsetX, offsetY, cells } = grid;
  if (width === 0 || height === 0) return [];

  // Space tile index, may not be 0 in format 7 maps
  const spaceTileIndex = reverseTilemap['Space'] ?? 0;

  // Build chunks from grid cells
  const chunks = new Map<string, ChunkTile[]>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = cells[row * width + col];
      const tileIndex = reverseTilemap[cell.tileId] ?? spaceTileIndex;

      // World coordinates
      const worldX = offsetX + col;
      const worldY = offsetY + row;

      // Chunk coordinates
      const cx = Math.floor(worldX / CHUNK_SIZE);
      const cy = Math.floor(worldY / CHUNK_SIZE);
      const key = `${cx},${cy}`;

      if (!chunks.has(key)) {
        const empty: ChunkTile[] = new Array(TILES_PER_CHUNK);
        for (let i = 0; i < TILES_PER_CHUNK; i++) {
          empty[i] = { typeId: spaceTileIndex, flags: 0, variant: 0, rotationMirroring: 0 };
        }
        chunks.set(key, empty);
      }

      // Local tile position within the chunk
      const lx = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const ly = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localIdx = ly * CHUNK_SIZE + lx;

      // Keep the imported variant byte: the game writes it and reads it back as-is. Tools never
      // carry it over to a different tile type (they create fresh `{ tileId }` cells), so a
      // stale variant can't end up on a tile it doesn't belong to.
      chunks.get(key)![localIdx] = {
        typeId: tileIndex,
        flags: cell.flags ?? 0,
        variant: cell.variant ?? 0,
        rotationMirroring: cell.rotationMirroring ?? 0,
      };
    }
  }

  // Remove all-Space chunks (where every tile is the Space tile type with no flags/variant)
  for (const [key, tiles] of chunks) {
    if (tiles.every(t => t.typeId === spaceTileIndex && t.flags === 0 && t.variant === 0 && t.rotationMirroring === 0)) {
      chunks.delete(key);
    }
  }

  if (chunks.size === 0) return [];

  // Preserve original chunk order if available, append new chunks sorted
  const originalOrder = chunkKeyOrder ?? [];
  const chunkKeySet = new Set(chunks.keys());
  const orderedKeys: string[] = [];
  for (const key of originalOrder) {
    if (chunkKeySet.has(key)) {
      orderedKeys.push(key);
      chunkKeySet.delete(key);
    }
  }
  // Append any new chunks not in original order (sorted for determinism)
  const newKeys = [...chunkKeySet].sort((a, b) => {
    const [ax, ay] = a.split(',').map(Number);
    const [bx, by] = b.split(',').map(Number);
    return ay - by || ax - bx;
  });
  orderedKeys.push(...newKeys);
  const sortedKeys = orderedKeys;

  const chunkVersion = format >= 7 ? 7 : 6;
  const lines: string[] = [];
  for (const key of sortedKeys) {
    const b64 = encodeChunk(chunks.get(key)!, format);
    lines.push(`        ${key}:`);
    lines.push(`          ind: ${key}`);
    lines.push(`          tiles: ${b64}`);
    lines.push(`          version: ${chunkVersion}`);
  }

  return lines;
}

/**
 * Build a map of gridUid -> chunk YAML lines for all grids.
 */
function buildGridChunksMap(
  map: ImportedMap,
  reverseTilemap: Record<string, number>,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const format = map.meta.format;

  if (map.gridDataList && map.gridDataList.length > 0) {
    for (const gd of map.gridDataList) {
      const chunks = buildChunksYamlForGrid(gd.grid, format, reverseTilemap, gd.chunkKeyOrder);
      result.set(gd.gridUid, chunks);
    }
  } else {
    // Legacy single-grid fallback
    const chunks = buildChunksYamlForGrid(map.grid, format, reverseTilemap, map.chunkKeyOrder);
    result.set(map.gridUid, chunks);
  }

  return result;
}

/**
 * Build a map of gridUid -> serialized DecalGrid YAML lines for dirty grids.
 * Only includes grids that are in the decalsDirty set and have decal data.
 */
function buildGridDecalsMap(
  map: ImportedMap,
  decalsDirty?: Set<number>,
  synthesizedGrids?: Set<number>,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const gd of map.gridDataList ?? []) {
    const dirty = decalsDirty?.has(gd.gridUid) ?? false;
    // A grid built from scratch has no DecalGrid in the file to replay, so always write its decals.
    if (dirty || (synthesizedGrids?.has(gd.gridUid) && gd.decals.decals.length > 0)) {
      result.set(gd.gridUid, serializeDecalGrid(gd.decals.decals));
    }
  }
  return result;
}

function encodeChunk(tiles: ChunkTile[], format: number): string {
  const bytesPerTile = format >= 7 ? 7 : 6;
  const buf = new ArrayBuffer(TILES_PER_CHUNK * bytesPerTile);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  for (let i = 0; i < TILES_PER_CHUNK; i++) {
    const off = i * bytesPerTile;
    const tile = tiles[i];
    view.setInt32(off, tile.typeId, true);
    bytes[off + 4] = tile.flags;
    bytes[off + 5] = tile.variant;
    if (bytesPerTile >= 7) {
      bytes[off + 6] = tile.rotationMirroring;
    }
  }

  return uint8ArrayToBase64(bytes);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---- Dangling reference cleanup ----

/** A numeric uid must exist in the file; the engine's own `invalid` marker for a deleted entity is kept as is. */
function isLiveRef(uid: unknown, validUids: Set<number>): boolean {
  return typeof uid !== 'number' || validUids.has(uid);
}

/**
 * Remove device UID references that point to non-existent entities.
 * Works on copies: entities that needed cleaning are returned as new objects (and listed in
 * `modified` so their raw YAML is not replayed), the editor state is never touched.
 *
 * Cleans up:
 * - DeviceList.devices: number[], filter out UIDs not in validUids
 * - DeviceLinkSource.linkedPorts: Record<uid, ...>, delete keys for UIDs not in validUids
 * - DeviceNetwork.deviceLists: number[], filter out UIDs not in validUids
 */
function stripDanglingDeviceRefs(
  entities: ImportedEntity[],
  validUids: Set<number>,
): { entities: ImportedEntity[]; modified: Set<number> } {
  const modified = new Set<number>();
  const result = entities.map(entity => {
    let components: Record<string, unknown>[] | null = null;
    entity.components.forEach((raw, i) => {
      const comp = raw as Record<string, unknown>;
      let replacement: Record<string, unknown> | null = null;

      if (comp.type === 'DeviceList' && Array.isArray(comp.devices)) {
        const filtered = (comp.devices as number[]).filter(uid => isLiveRef(uid, validUids));
        if (filtered.length !== (comp.devices as number[]).length) replacement = { ...comp, devices: filtered };
      }

      if (comp.type === 'DeviceLinkSource' && comp.linkedPorts && typeof comp.linkedPorts === 'object') {
        const cleaned: Record<string, unknown> = {};
        let changed = false;
        for (const [uidStr, value] of Object.entries(comp.linkedPorts as Record<string, unknown>)) {
          const uid = parseInt(uidStr, 10);
          if (isNaN(uid) || validUids.has(uid)) cleaned[uidStr] = value;
          else changed = true;
        }
        if (changed) replacement = { ...comp, linkedPorts: cleaned };
      }

      if (comp.type === 'DeviceNetwork' && Array.isArray(comp.deviceLists)) {
        const filtered = (comp.deviceLists as number[]).filter(uid => isLiveRef(uid, validUids));
        if (filtered.length !== (comp.deviceLists as number[]).length) replacement = { ...comp, deviceLists: filtered };
      }

      if (replacement) {
        components ??= entity.components.slice();
        components[i] = replacement;
      }
    });
    if (!components) return entity;
    modified.add(entity.uid);
    return { ...entity, components };
  });
  return { entities: result, modified };
}

/**
 * Make sure an entity written from components (not raw lines) hangs off a serialized entity.
 * An entity whose Transform has no parent would load into nullspace, and one whose parent isn't in
 * the file (e.g. a prefab placed from another map) would get an invalid parent, so both are
 * attached to `fallbackParent` unless the file declared it as an orphan / nullspace entity.
 */
function repairTransformParent(
  components: Record<string, unknown>[],
  uid: number,
  fallbackParent: number | undefined,
  validParents: Set<number>,
  keepParentless: Set<number>,
): Record<string, unknown>[] {
  if (fallbackParent === undefined) return components;
  const idx = components.findIndex(c => c.type === 'Transform');
  if (idx < 0) return components;
  const parent = components[idx].parent;
  const dangling = typeof parent === 'number' && !validParents.has(parent);
  const missing = (parent === undefined || parent === null) && !keepParentless.has(uid);
  if (!dangling && !missing) return components;
  const repaired = components.slice();
  repaired[idx] = { ...components[idx], parent: fallbackParent };
  return repaired;
}

// ---- Entity group building ----

const protoCollator = new Intl.Collator('en');

function buildEntityGroupsYaml(map: ImportedMap, structuralUids: Set<number>): { lines: string[]; count: number } {
  // Parent an entity falls back to if its own is missing: its grid, or the container it sits in.
  const fallbackParent = new Map<number, number>();
  const gridList = map.gridDataList ?? [];
  for (const gd of gridList) {
    for (const e of gd.entities) fallbackParent.set(e.uid, gd.gridUid);
    for (const [parentUid, children] of Object.entries(gd.containedEntities)) {
      for (const c of children) fallbackParent.set(c.uid, Number(parentUid));
    }
  }

  // Combine grid entities with contained entities for export (from all grids)
  const gridEntities = getAllEntities(map);
  const allContained = getAllContainedEntities(map);
  const exported: ImportedEntity[] = [...gridEntities];

  if (Object.keys(allContained).length > 0) {
    // Build set of valid parent UIDs, grid entities are always valid
    const validUids = new Set(gridEntities.map(e => e.uid));
    // Iteratively resolve transitive containment (entity inside entity inside entity...)
    let changed = true;
    while (changed) {
      changed = false;
      for (const [parentUidStr, children] of Object.entries(allContained)) {
        if (validUids.has(Number(parentUidStr))) {
          for (const child of children) {
            if (!validUids.has(child.uid)) {
              validUids.add(child.uid);
              changed = true;
            }
          }
        }
      }
    }
    for (const [parentUidStr, children] of Object.entries(allContained)) {
      if (validUids.has(Number(parentUidStr))) {
        exported.push(...children);
      }
    }
  }

  if (exported.length === 0) return { lines: [], count: 0 };

  // Strip dangling device references (UIDs pointing to entities that don't exist).
  // This can happen when a linked entity is deleted but the DeviceList/DeviceLinkSource
  // on the other entity isn't cleaned up, or when DeviceNetwork.deviceLists references
  // a deleted alarm entity.
  const validUidSet = new Set<number>([...structuralUids, ...exported.map(e => e.uid)]);
  const { entities: allEntities, modified } = stripDanglingDeviceRefs(exported, validUidSet);

  // Entities the file itself declared parentless (orphans / nullspace) keep having no parent.
  const keepParentless = new Set<number>([...(map.orphans ?? []), ...(map.nullspace ?? [])]);

  // Group by prototype
  const groups = new Map<string, ImportedEntity[]>();
  for (const entity of allEntities) {
    const proto = entity.prototype;
    if (!groups.has(proto)) {
      groups.set(proto, []);
    }
    groups.get(proto)!.push(entity);
  }

  const lines: string[] = [];

  // Same order as EntitySerializer: groups by prototype id (InvariantCulture), entities by ascending uid.
  const protos = [...groups.keys()].sort((a, b) => protoCollator.compare(a, b));
  for (const proto of protos) {
    const entities = groups.get(proto)!.sort((a, b) => a.uid - b.uid);
    lines.push(`- proto: ${proto}`);
    lines.push('  entities:');

    for (const entity of entities) {
      lines.push(`  - uid: ${entity.uid}`);
      // Emit entity-level preamble lines (e.g., mapInit, paused) if present
      const preambleLines = map.entityRawPreamble?.[entity.uid];
      if (preambleLines) {
        for (const pl of preambleLines) lines.push(pl);
      }
      lines.push('    components:');

      const rawLines = modified.has(entity.uid) ? undefined : map.entityRawComponents?.[entity.uid];
      if (rawLines) {
        // Emit raw YAML lines verbatim for byte-exact roundtrip
        for (const rl of rawLines) lines.push(rl);
      } else {
        let components = entity.components;
        const hasTransform = components.some(c => c.type === 'Transform');

        if (!hasTransform) {
          // Synthesize Transform from entity position/rotation for editor-placed entities
          const parentUid = fallbackParent.get(entity.uid) ?? gridList[0]?.gridUid;
          emitComponent(lines, makeTransform(
            parentUid,
            entity.position,
            entity.rotation,
          ));
        } else {
          components = repairTransformParent(components, entity.uid, fallbackParent.get(entity.uid), validUidSet, keepParentless);
        }

        for (const comp of components) {
          emitComponent(lines, stripInternalTags(comp) as Record<string, unknown>);
        }
      }
    }
  }

  return { lines, count: allEntities.length };
}

/**
 * Emit raw component lines for a structural entity verbatim,
 * but replace the MapGrid chunks section with rebuilt chunk data,
 * and optionally replace the DecalGrid section with freshly serialized decals.
 */
function emitStructuralEntityRawWithReplacements(
  lines: string[],
  rawComponentLines: string[],
  chunksYaml: string[],
  decalLines?: string[],
): void {
  let inMapGridChunks = false;
  let inDecalGrid = false;
  let decalGridFound = false;

  for (const line of rawComponentLines) {
    // Detect the `      chunks:` line under MapGrid
    if (!inMapGridChunks && !inDecalGrid && /^\s{6}chunks:\s*$/.test(line)) {
      inMapGridChunks = true;
      lines.push(line);
      // Emit rebuilt chunks in place of original
      for (const cl of chunksYaml) lines.push(cl);
      continue;
    }

    if (inMapGridChunks) {
      // Skip original chunk data lines (indent >= 8 or blank within chunk block)
      if (/^\s{8}/.test(line) || line === '') {
        continue;
      }
      // Exited chunks section, emit this line normally
      inMapGridChunks = false;
    }

    // Detect DecalGrid component start: "    - type: DecalGrid"
    if (!inDecalGrid && decalLines && /^\s{4}- type: DecalGrid\s*$/.test(line)) {
      inDecalGrid = true;
      decalGridFound = true;
      // Emit replacement DecalGrid lines instead
      for (const dl of decalLines) lines.push(dl);
      continue;
    }

    if (inDecalGrid) {
      // Skip lines belonging to the original DecalGrid component.
      // A new component starts with "    - type:" at indent 4.
      if (/^\s{4}- type:/.test(line)) {
        // This is the start of the next component, stop skipping
        inDecalGrid = false;
        lines.push(line);
        continue;
      }
      // Still inside DecalGrid, skip this line
      continue;
    }

    lines.push(line);
  }

  // Append DecalGrid if it wasn't present in the raw lines but we have dirty decals
  if (!decalGridFound && decalLines) {
    for (const dl of decalLines) lines.push(dl);
  }
}

function emitComponent(lines: string[], comp: Record<string, unknown>): void {
  // `type` always comes first
  lines.push(`    - type: ${comp.type}`);

  for (const key of Object.keys(comp)) {
    if (key === 'type') continue;
    emitEntry(lines, key, comp[key], 6, ' '.repeat(6));
  }
}

/**
 * Emit a key-value pair at a given indentation level (in spaces).
 */
function emitValue(
  lines: string[],
  key: string,
  value: unknown,
  indent: number,
): void {
  emitEntry(lines, key, value, indent, ' '.repeat(indent));
}

const spaces = (n: number): string => ' '.repeat(n);

function tagOf(record: Record<string, unknown>): string | undefined {
  return record._ss14Tag as string | undefined;
}

function dataEntries(record: Record<string, unknown>): [string, unknown][] {
  return Object.entries(record).filter(([k]) => k !== '_ss14Tag');
}

/**
 * Emit one `key: value` mapping entry whose key sits at column `col`. `lead` is the text in
 * front of the key on its first line (`col` spaces, or `<spaces>- ` for the first entry of a
 * sequence item). Sequences are not indented under their key, matching the engine's emitter.
 */
function emitEntry(lines: string[], key: string, value: unknown, col: number, lead: string): void {
  const head = `${lead}${formatKey(key)}:`;

  if (value === null || value === undefined) {
    lines.push(`${head} null`);
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${head} []`);
    } else {
      lines.push(head);
      emitSequence(lines, value, col);
    }
  } else if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const tag = tagOf(record);
    const entries = dataEntries(record);
    if (entries.length === 0) {
      // `{}` keeps it a mapping; a bare tag would parse as an (empty) scalar and not load.
      lines.push(`${head} ${tag ? `${tag} ` : ''}{}`);
    } else {
      lines.push(tag ? `${head} ${tag}` : head);
      for (const [k, v] of entries) emitEntry(lines, k, v, col + 2, spaces(col + 2));
    }
  } else if (typeof value === 'string' && value.includes('\n') && !value.includes('\r')) {
    // Multiline string, use YAML literal block scalar. Content is indented relative to the key column.
    const block: string[] = [];
    emitBlockScalar(block, key, value, col);
    block[0] = lead + block[0].slice(col);
    lines.push(...block);
  } else {
    lines.push(`${head} ${formatPrimitive(value)}`);
  }
}

/** Emit sequence items with their `- ` at column `col`. */
function emitSequence(lines: string[], items: unknown[], col: number): void {
  for (const item of items) emitSequenceItem(lines, item, col);
}

function emitSequenceItem(lines: string[], item: unknown, col: number): void {
  const lead = `${spaces(col)}- `;

  if (Array.isArray(item)) {
    if (item.length === 0) {
      lines.push(`${lead}[]`);
      return;
    }
    // Nested sequence: `- - a` then `  - b`; render at col + 2 and fold the first dash in.
    const nested: string[] = [];
    emitSequence(nested, item, col + 2);
    nested[0] = lead + nested[0].slice(col + 2);
    lines.push(...nested);
  } else if (item !== null && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    const tag = tagOf(record);
    const entries = dataEntries(record);
    if (entries.length === 0) {
      lines.push(`${lead}${tag ? `${tag} ` : ''}{}`);
    } else if (tag) {
      // Polymorphic item: `- !type:Foo` with its fields underneath.
      lines.push(`${lead}${tag}`);
      for (const [k, v] of entries) emitEntry(lines, k, v, col + 2, spaces(col + 2));
    } else {
      entries.forEach(([k, v], i) => emitEntry(lines, k, v, col + 2, i === 0 ? lead : spaces(col + 2)));
    }
  } else if (typeof item === 'string' && item.includes('\n') && !item.includes('\r')) {
    // Multiline string in array, use block scalar with "- " prefix
    emitBlockScalar(lines, '-', item, col, true);
  } else {
    lines.push(`${lead}${item === null || item === undefined ? 'null' : formatPrimitive(item)}`);
  }
}

/** Process internal _ss14Tag metadata added during import.
 * Tagged scalars are unwrapped: { _ss14Tag, value } -> value
 * Tagged sequences are unwrapped: { _ss14Tag, items } -> items
 * Tagged mappings preserve _ss14Tag so emitValue can emit the YAML tag
 */
function stripInternalTags(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(stripInternalTags);
  }

  const record = obj as Record<string, unknown>;

  // Tagged scalar: { _ss14Tag, value } -> unwrap to value
  if ('_ss14Tag' in record && 'value' in record && Object.keys(record).length === 2) {
    return record.value;
  }

  // Tagged sequence: { _ss14Tag, items } -> unwrap to items array
  if ('_ss14Tag' in record && 'items' in record && Object.keys(record).length === 2) {
    return stripInternalTags(record.items);
  }

  // Tagged mapping or normal object: preserve _ss14Tag for emitValue to use
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === '_ss14Tag') {
      result[k] = v; // preserve tag so emitValue can emit it
    } else {
      result[k] = stripInternalTags(v);
    }
  }
  return result;
}

/**
 * Emit a multiline string as a YAML literal block scalar (|).
 * Uses |- (strip) if the string doesn't end with newline, | (clip) if it does.
 * The indentation indicator is computed from the content.
 */
function emitBlockScalar(
  lines: string[],
  key: string,
  value: string,
  indent: number,
  isArrayItem = false,
): void {
  const prefix = ' '.repeat(indent);
  const contentIndent = indent + 2;
  const contentPrefix = ' '.repeat(contentIndent);

  // Chomping: strip (-) without a trailing newline, clip (default) with exactly one, keep (+) with more.
  const chomp = !value.endsWith('\n') ? '-' : value.endsWith('\n\n') ? '+' : '';

  // Check if any content line starts with spaces, if so, we need an explicit indentation indicator
  const contentLines = value.split('\n');
  // Remove trailing empty string from split if value ends with \n
  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '' && value.endsWith('\n')) {
    contentLines.pop();
  }

  // Find minimum leading whitespace in non-empty lines to determine if we need indent indicator
  let needsIndicator = false;
  for (const line of contentLines) {
    if (line.length > 0 && (line[0] === ' ' || line[0] === '\t')) {
      needsIndicator = true;
      break;
    }
  }

  // The indentation indicator is relative to the parent node, so it is always 2 here.
  const indicator = needsIndicator ? '2' : '';

  if (isArrayItem) {
    lines.push(`${prefix}- |${indicator}${chomp}`);
  } else {
    lines.push(`${prefix}${key}: |${indicator}${chomp}`);
  }

  // Emit each line with proper indentation
  for (const line of contentLines) {
    if (line === '') {
      lines.push('');
    } else {
      lines.push(`${contentPrefix}${line}`);
    }
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function doubleQuote(str: string): string {
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `"${escaped}"`;
}

/** Mapping keys follow the same quoting rules as scalars (e.g. a key written as "UID: 31739"). */
function formatKey(key: string): string {
  if (key.length > 0 && !needsQuoting(key) && !key.endsWith(':') && !/^[-?](\s|$)/.test(key)) return key;
  return formatPrimitive(key);
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  const str = String(value);
  if (str.length === 0) return '""';
  // Carriage returns and other control characters can't survive a plain, single-quoted or block
  // scalar (the parser normalizes them), so escape them in a double-quoted scalar.
  if (/[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(str)) return doubleQuote(str);
  // Quote strings that contain YAML-special characters
  if (needsQuoting(str)) {
    // Use single quotes by default (matching SS14 engine convention).
    // Use double quotes only when the string contains single quotes.
    if (str.includes("'")) {
      return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return `'${str}'`;
  }
  return str;
}

/** Check if a string value needs YAML quoting to preserve its meaning. */
function needsQuoting(str: string): boolean {
  if (str.length === 0) return true;
  // Leading/trailing whitespace, YAML parsers strip this from plain scalars
  if (str !== str.trim()) return true;
  // Starts with # (comment), or contains : followed by space, or starts with special chars
  if (str.startsWith('#') || str.startsWith('&') || str.startsWith('*') || str.startsWith('!')) return true;
  if (str.startsWith('{') || str.startsWith('[') || str.startsWith('>') || str.startsWith('|')) return true;
  if (str.startsWith("'") || str.startsWith('"')) return true;
  if (str.includes(': ') || str.includes(' #')) return true;
  // Values that look like booleans or null
  const lower = str.toLowerCase();
  if (['true', 'false', 'yes', 'no', 'null', '~', 'on', 'off'].includes(lower)) return true;
  return false;
}
