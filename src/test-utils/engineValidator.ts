/**
 * Structural validator for exported SS14 map/grid YAML.
 *
 * Encodes the load-time rules of the real engine
 * (RobustToolbox `EntityDeserializer` / `EntitySerializer` / `MapChunkSerializer`) so tests can
 * assert that editor output is something the game will actually load, without a game server.
 * Real game maps must produce zero errors; that keeps the rules honest.
 */
import yaml from 'js-yaml';
import { SS14_SCHEMA } from '../import/ss14Schema';

export interface ValidationResult {
  errors: string[];
  /** Number of `!type:X` values with no body (parsed as an empty scalar). The engine can't read these as mappings. */
  bareTags: number;
  entityCount: number;
  /** `meta.entityCount` as written in the file, if any. */
  declaredEntityCount?: number;
  format: number;
  category: string | undefined;
}

export interface ValidateOptions {
  /** Also require the engine's canonical ordering (proto groups, uids, tilemap). */
  checkOrdering?: boolean;
}

const CHUNK_TILES = 256;

function asList(v: unknown): number[] | null {
  return Array.isArray(v) ? (v as number[]) : null;
}

function isBareTag(v: unknown): boolean {
  return !!v && typeof v === 'object' && '_ss14Tag' in (v as object) && 'value' in (v as object) && (v as { value: unknown }).value === '';
}

function countBareTags(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  if (isBareTag(node)) return 1;
  let n = 0;
  if (Array.isArray(node)) for (const x of node) n += countBareTags(x);
  else for (const x of Object.values(node as object)) n += countBareTags(x);
  return n;
}

export function validateEngineYaml(text: string, opts: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 50) errors.push(m); };

  let doc: any;
  try {
    doc = yaml.load(text, { schema: SS14_SCHEMA });
  } catch (e) {
    return { errors: [`yaml parse failed: ${(e as Error).message}`], bareTags: 0, entityCount: 0, format: 0, category: undefined };
  }
  if (!doc || typeof doc !== 'object') {
    return { errors: ['document is not a mapping'], bareTags: 0, entityCount: 0, format: 0, category: undefined };
  }

  const format = Number(doc.meta?.format);
  const category: string | undefined = doc.meta?.category;
  if (!Number.isInteger(format)) err('meta.format missing');
  const isV7 = format >= 7;

  if (!doc.tilemap || typeof doc.tilemap !== 'object') err('tilemap missing');
  if (!Array.isArray(doc.entities)) err('entities missing');
  const tilemap: Record<string, string> = doc.tilemap ?? {};
  const entityGroups: any[] = Array.isArray(doc.entities) ? doc.entities : [];

  let maps: number[] = [], grids: number[] = [], orphans: number[] = [], nullspace: number[] = [];
  if (isV7) {
    // EntityDeserializer.ReadYamlIdList uses Get<SequenceDataNode>: a missing or null key throws.
    for (const key of ['maps', 'grids', 'orphans', 'nullspace'] as const) {
      const l = asList(doc[key]);
      if (!l) err(`'${key}' must be a sequence (got ${doc[key] === null ? 'null' : typeof doc[key]})`);
    }
    maps = asList(doc.maps) ?? [];
    grids = asList(doc.grids) ?? [];
    orphans = asList(doc.orphans) ?? [];
    nullspace = asList(doc.nullspace) ?? [];
    if (!category) err('meta.category missing');
    if (doc.meta?.postmapinit !== undefined) err('meta.postmapinit must not be written in format 7');
    if (opts.checkOrdering) {
      const order = ['meta', 'maps', 'grids', 'orphans', 'nullspace', 'tilemap', 'entities'];
      const keys = Object.keys(doc);
      if (keys.join() !== order.join()) err(`top-level key order is ${keys.join(',')}`);
    }
  }

  // tilemap
  const tileIds = new Set<number>();
  for (const [k, v] of Object.entries(tilemap)) {
    if (!/^\d+$/.test(k)) err(`tilemap key '${k}' is not an integer`);
    if (typeof v !== 'string' || v.length === 0) err(`tilemap[${k}] must be a tile prototype id`);
    tileIds.add(Number(k));
  }
  const spaceIds = Object.entries(tilemap).filter(([, v]) => v === 'Space').map(([k]) => Number(k));

  // entities
  const byUid = new Map<number, any>();
  const withProto: { uid: number; proto: string }[] = [];
  let entityCount = 0;
  let prevProto: string | null = null;
  const collator = new Intl.Collator('en');
  for (const group of entityGroups) {
    if (typeof group?.proto !== 'string') { err('entity group without string proto'); continue; }
    if (!Array.isArray(group.entities)) { err(`group '${group.proto}' has no entities list`); continue; }
    if (opts.checkOrdering && prevProto !== null && collator.compare(prevProto, group.proto) > 0) {
      err(`proto group '${group.proto}' sorted after '${prevProto}'`);
    }
    prevProto = group.proto;
    let prevUid = -Infinity;
    for (const ent of group.entities) {
      entityCount++;
      const uid = ent?.uid;
      if (!Number.isInteger(uid) || uid <= 0) { err(`entity has invalid uid ${String(uid)} in '${group.proto}'`); continue; }
      if (byUid.has(uid)) err(`duplicate uid ${uid}`);
      byUid.set(uid, ent);
      withProto.push({ uid, proto: group.proto });
      if (opts.checkOrdering && uid < prevUid) err(`uid ${uid} sorted after ${prevUid} in '${group.proto}'`);
      prevUid = uid;
      if (ent.components !== undefined && !Array.isArray(ent.components)) err(`uid ${uid}: components is not a sequence`);
      for (const c of ent.components ?? []) {
        if (typeof c?.type !== 'string') err(`uid ${uid}: component without type`);
      }
    }
  }

  const comp = (uid: number, type: string) => (byUid.get(uid)?.components ?? []).find((c: any) => c?.type === type);

  // transforms / parents
  const trueOrphans: number[] = [];
  for (const [uid] of byUid) {
    const t = comp(uid, 'Transform');
    const p = t?.parent;
    if (p === undefined || p === null) continue;
    if (p === 'invalid') trueOrphans.push(uid);
    else if (!byUid.has(p)) err(`uid ${uid}: Transform.parent ${p} is not a serialized entity`);
    else if (p === uid) err(`uid ${uid}: parented to itself`);
  }

  if (isV7) {
    const mapEnts = [...byUid.keys()].filter(u => comp(u, 'Map'));
    const gridEnts = [...byUid.keys()].filter(u => comp(u, 'MapGrid'));
    const sameSet = (a: number[], b: number[]) => a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));
    if (!sameSet(maps, mapEnts)) err(`maps [${maps}] != entities with Map [${mapEnts}]`);
    if (!sameSet(grids, gridEnts)) err(`grids [${grids}] != entities with MapGrid [${gridEnts}]`);
    // Engine: an orphan with a real parent is an error; a `parent: invalid` entity missing from the list loses its parent.
    for (const u of orphans) {
      const p = comp(u, 'Transform')?.parent;
      if (!byUid.has(u)) err(`orphan uid ${u} not serialized`);
      else if (p != null && p !== 'invalid') err(`orphan uid ${u} has parent ${p}`);
    }
    for (const u of trueOrphans) if (!orphans.includes(u)) err(`uid ${u} has parent invalid but is not in orphans`);
    for (const u of nullspace) {
      if (!byUid.has(u)) err(`nullspace uid ${u} not serialized`);
      else if (comp(u, 'Map')) err(`nullspace uid ${u} is a map`);
      else if (comp(u, 'Transform')?.parent != null) err(`nullspace uid ${u} has a parent`);
    }
    // category rules (EntitySerializer.InferCategory / TrySave*)
    switch (category) {
      case 'Map':
        if (maps.length !== 1) err(`category Map needs exactly 1 map (got ${maps.length})`);
        break;
      case 'Grid':
        if (maps.length !== 0) err('category Grid must have no maps');
        if (grids.length !== 1) err(`category Grid needs exactly 1 grid (got ${grids.length})`);
        if (orphans.length !== 1 || orphans[0] !== grids[0]) err('category Grid needs orphans == [grid]');
        break;
      case 'Entity':
        if (maps.length || grids.length) err('category Entity must have no maps/grids');
        if (orphans.length !== 1) err('category Entity needs exactly 1 orphan');
        break;
      case 'Save': case 'Unknown': break;
      default: err(`unknown category '${category}'`);
    }
  }

  // grids: chunks
  for (const uid of byUid.keys()) {
    const g = comp(uid, 'MapGrid');
    if (!g) continue;
    const chunks = g.chunks;
    if (chunks === null || chunks === undefined || typeof chunks !== 'object' || Array.isArray(chunks)) {
      err(`grid ${uid}: chunks must be a mapping (got ${chunks === null ? 'null' : typeof chunks})`);
      continue;
    }
    if (Object.keys(chunks).length === 0) err(`grid ${uid}: has no chunks`);
    for (const [key, chunk] of Object.entries<any>(chunks)) {
      const ind = typeof chunk?.ind === 'string' ? chunk.ind : String(chunk?.ind);
      if (ind !== key) err(`grid ${uid}: chunk key '${key}' != ind '${ind}'`);
      if (typeof chunk?.tiles !== 'string') { err(`grid ${uid} chunk ${key}: tiles missing`); continue; }
      const version = Number(chunk.version);
      if (version !== 7 && version !== 6) err(`grid ${uid} chunk ${key}: unsupported version ${chunk.version}`);
      const buf = Buffer.from(chunk.tiles, 'base64');
      const stride = version >= 7 ? 7 : 6;
      if (buf.length !== CHUNK_TILES * stride) { err(`grid ${uid} chunk ${key}: ${buf.length} bytes, expected ${CHUNK_TILES * stride} for version ${version}`); continue; }
      let filled = 0, empties = 0;
      for (let i = 0; i < CHUNK_TILES; i++) {
        const id = buf.readInt32LE(i * stride);
        if (!tileIds.has(id)) { err(`grid ${uid} chunk ${key}: tile id ${id} not in tilemap`); break; }
        if (spaceIds.includes(id)) empties++; else filled++;
      }
      if (empties > 0 && spaceIds.length === 0) err(`grid ${uid} chunk ${key}: has Space tiles but tilemap has no Space`);
      if (filled === 0) err(`grid ${uid} chunk ${key}: chunk is entirely empty (engine drops it)`);
    }
  }

  // meta.entityCount is never read by the engine and drifts in hand-edited maps, so it is reported, not enforced.
  const declaredEntityCount = doc.meta?.entityCount !== undefined ? Number(doc.meta.entityCount) : undefined;

  return { errors, bareTags: countBareTags(entityGroups), entityCount, declaredEntityCount, format, category };
}
