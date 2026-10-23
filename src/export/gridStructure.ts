/**
 * Structural (prototype-less) entities of a saved map: the map entity and the grid entities.
 * Builds the same component sets the engine writes so grids created in the editor (new grids,
 * grids cut out of a selection, a blank map) load in the game like any saved grid.
 */
import type { ImportedMap } from '../import/mapImporter';
import type { GridData } from '../state/gridData';

export type Component = Record<string, unknown>;

/** Engine version this fork runs on (RobustToolbox Robust.Engine.Version.props). */
export const ENGINE_VERSION = '267.3.0';

/** Shortest decimal that round-trips as a float32, which is how the engine prints Vector2 parts. */
export function formatFloat32(n: number): string {
  const f = Math.fround(n);
  if (!Number.isFinite(f)) return '0';
  if (Number.isInteger(f)) return String(f === 0 ? 0 : f);
  for (let p = 1; p <= 9; p++) {
    const candidate = parseFloat(f.toPrecision(p));
    if (Math.fround(candidate) === f) return String(candidate);
  }
  return String(f);
}

export function formatVector(x: number, y: number): string {
  return `${formatFloat32(x)},${formatFloat32(y)}`;
}

export function findComponent(components: readonly Component[] | undefined, type: string): Component | undefined {
  return components?.find(c => c.type === type);
}

/** `Transform` the way the engine orders and omits fields: rot, pos, parent (zero pos/rot are omitted). */
export function makeTransform(parent: number | 'invalid' | undefined, pos?: { x: number; y: number }, rot = 0): Component {
  const t: Component = { type: 'Transform' };
  if (rot !== 0) t.rot = `${rot} rad`;
  if (pos && (pos.x !== 0 || pos.y !== 0)) t.pos = formatVector(pos.x, pos.y);
  if (parent !== undefined) t.parent = parent;
  return t;
}

/** Components of a map entity (what `CreateUninitializedMap` + a save produce). */
export function defaultMapComponents(name?: string): Component[] {
  const meta: Component = { type: 'MetaData' };
  if (name) meta.name = name;
  return [
    meta,
    { type: 'Transform' },
    { type: 'Map', mapPaused: true },
    { type: 'GridTree' },
    { type: 'Broadphase' },
    { type: 'OccluderTree' },
  ];
}

/**
 * Components of a grid entity, mirroring a grid saved by the game (see Resources/Maps/Test/empty.yml
 * without BecomesStation). `MapGrid` carries no chunks: the exporter writes them from the tile data.
 */
export function defaultGridComponents(name: string | undefined, parent: number | 'invalid', pos?: { x: number; y: number }): Component[] {
  const meta: Component = { type: 'MetaData' };
  if (name) meta.name = name;
  return [
    meta,
    makeTransform(parent, pos),
    { type: 'MapGrid' },
    { type: 'Broadphase' },
    { type: 'Physics', bodyStatus: 'InAir', angularDamping: 0.05, linearDamping: 0.05, fixedRotation: false, bodyType: 'Dynamic' },
    { type: 'Fixtures', fixtures: {} },
    { type: 'OccluderTree' },
    { type: 'Shuttle', dampingModifier: 0.25 },
    { type: 'GridPathfinding' },
    { type: 'Gravity', gravityShakeSound: { _ss14Tag: '!type:SoundPathSpecifier', path: '/Audio/Effects/alert.ogg' } },
    { type: 'SpreaderGrid' },
  ];
}

/** True for the editor's auto-generated tab names ("Grid 1"), which are not worth saving as a grid name. */
export function isAutoGridName(name: string | undefined): boolean {
  return !name || /^Grid \d+$/.test(name);
}

/**
 * Components that tie a grid to the map or to the grids around it. A `Joint` welds it to a docked
 * grid by uid, which the engine can't resolve in another file, and a grid-map's `Map` makes it
 * unsaveable as a plain grid. They never belong in a grid file or on a grid copied elsewhere.
 */
export const GRID_TIE_COMPONENTS: ReadonlySet<string> = new Set([
  'Joint', 'Map', 'GridTree', 'LoadedMap', 'MovedGrids', 'PhysicsMap',
]);

/**
 * Components that must not be copied onto a *different* grid: the ties above, plus data derived
 * from the source grid's own tiles/station.
 */
export const NON_COPYABLE_GRID_COMPONENTS: ReadonlySet<string> = new Set([
  ...GRID_TIE_COMPONENTS,
  'DecalGrid', 'BecomesStation', 'GridAtmosphere', 'GasTileOverlay', 'RadiationGridResistance',
]);

/**
 * Structural components for a grid that has no preserved entity in the file: the grid's own
 * components when it carries some (a grid cut from a selection copies them from its source),
 * otherwise the engine defaults. Name, parent and world position always come from the editor state.
 */
export function synthesizeGridComponents(gd: GridData, parent: number | 'invalid'): Component[] {
  const source = gd.structuralComponents.length > 0
    ? (JSON.parse(JSON.stringify(gd.structuralComponents)) as Component[])
    : defaultGridComponents(undefined, parent);

  const out: Component[] = [];
  let hasMeta = false, hasTransform = false, hasGrid = false;
  for (const c of source) {
    if (typeof c.type === 'string' && NON_COPYABLE_GRID_COMPONENTS.has(c.type)) continue;
    if (c.type === 'MetaData') {
      hasMeta = true;
      const meta: Component = { ...c };
      if (isAutoGridName(gd.name)) delete meta.name; else meta.name = gd.name;
      out.push(meta);
    } else if (c.type === 'Transform') {
      hasTransform = true;
      out.push(makeTransform(parent, gd.worldPosition, parseRotation(c.rot)));
    } else {
      if (c.type === 'MapGrid') hasGrid = true;
      out.push(c);
    }
  }
  if (!hasMeta) out.unshift(isAutoGridName(gd.name) ? { type: 'MetaData' } : { type: 'MetaData', name: gd.name });
  if (!hasTransform) out.splice(1, 0, makeTransform(parent, gd.worldPosition));
  if (!hasGrid) out.splice(2, 0, { type: 'MapGrid' });
  return out;
}

function parseRotation(rot: unknown): number {
  if (typeof rot === 'number') return rot;
  if (typeof rot !== 'string') return 0;
  const m = /^(-?[\d.eE+-]+)\s*rad$/.exec(rot.trim());
  return m ? parseFloat(m[1]) : 0;
}

/** Every uid the exported file will contain or reference as a structural/grid entity. */
export function collectUsedUids(map: ImportedMap): Set<number> {
  const used = new Set<number>();
  for (const k of Object.keys(map.structuralEntityData ?? {})) used.add(Number(k));
  for (const gd of map.gridDataList ?? []) {
    used.add(gd.gridUid);
    for (const e of gd.entities) used.add(e.uid);
    for (const [parent, kids] of Object.entries(gd.containedEntities)) {
      used.add(Number(parent));
      for (const e of kids) used.add(e.uid);
    }
  }
  for (const e of map.entities ?? []) used.add(e.uid);
  return used;
}

/** Smallest uid above everything in use (uids start at 1; 0 is never valid in a saved file). */
export function nextFreeUid(used: ReadonlySet<number>): number {
  let max = 0;
  for (const u of used) if (u > max) max = u;
  return max + 1;
}
