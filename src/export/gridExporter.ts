/**
 * Save one grid as a stand-alone grid file (`category: Grid`), the same kind of file the game
 * writes for a shuttle (`TrySaveGrid`) and loads with `loadgrid` / the shipyard.
 *
 * Unlike a map, a grid file has no map entity: the grid is the only orphan (`parent: invalid`) and
 * everything on it keeps its uid. Whatever pointed outside the grid (docked grids, device links
 * to other grids, entities parented to the map) is dropped or reattached, so the file does not
 * depend on the map it was cut from.
 */
import type { ImportedMap } from '../import/mapImporter';
import type { GridData } from '../state/gridData';
import { exportMap } from './mapExporter';
import { findComponent, synthesizeGridComponents, type Component } from './gridStructure';
import { remapEntityRefs } from '../grid/entityRefs';

/** Thrown when the requested grid can't be written as a file; the message is shown to the user. */
export class GridExportError extends Error {}

/**
 * Components that do not belong on a plain grid in a grid file: joints to other grids, and the map
 * components of a "grid-map" (a grid that is also its own map), which the game refuses to save as a grid.
 */
const GRID_LINK_COMPONENTS = new Set(['Joint', 'Map', 'GridTree', 'LoadedMap', 'MovedGrids', 'PhysicsMap']);

function hasTiles(gd: GridData): boolean {
  return gd.grid.cells.some(c => c.tileId !== 'Space');
}

/** The grid entity's components with the engine's grid-file root transform (`parent: invalid`). */
function rootGridComponents(map: ImportedMap, gd: GridData): Component[] {
  const stored = map.structuralEntityData?.[gd.gridUid];
  if (!stored) return synthesizeGridComponents(gd, 'invalid');

  const components = stored
    .filter(c => !(typeof c.type === 'string' && GRID_LINK_COMPONENTS.has(c.type)))
    .map(c => (c.type === 'Transform' ? { ...c, parent: 'invalid' } : c));
  if (!findComponent(components, 'Transform')) {
    components.splice(1, 0, { type: 'Transform', parent: 'invalid' });
  }
  return components;
}

function dropRefsOutside(components: Component[], present: Set<number>): Component[] {
  return remapEntityRefs(components, uid => (present.has(uid) ? uid : undefined)).map((c, i) => {
    // An undocked door must not keep the id of the joint it no longer has.
    if (c.type === 'Docking' && c !== components[i] && !('dockedWith' in c) && 'dockJointId' in c) {
      const { dockJointId: _joint, ...rest } = c;
      return rest;
    }
    return c;
  });
}

/**
 * Entity references that point out of the file (docked partners, links to other grids, items in
 * containers that stayed behind...) are removed: the uids would mean nothing, or something else.
 */
function dropOutsideRefs<T extends { components: Component[] }>(entity: T, present: Set<number>): T {
  const components = dropRefsOutside(entity.components, present);
  return components.some((c, i) => c !== entity.components[i]) ? { ...entity, components } : entity;
}

/**
 * Build the `ImportedMap` for a grid file: just this grid, no map, with nothing replayed from the
 * source file's raw lines (they carry the source map's parents and references).
 */
export function buildGridFileMap(map: ImportedMap, gridUid: number): ImportedMap {
  const gd = map.gridDataList?.find(g => g.gridUid === gridUid);
  if (!gd) throw new GridExportError(`Grid ${gridUid} not found`);
  if (!hasTiles(gd)) throw new GridExportError('This grid has no tiles, there is nothing to save.');

  const present = new Set<number>([gd.gridUid]);
  for (const e of gd.entities) present.add(e.uid);
  for (const kids of Object.values(gd.containedEntities)) for (const e of kids) present.add(e.uid);

  const grid: GridData = {
    ...gd,
    entities: gd.entities.map(e => dropOutsideRefs(e, present)),
    containedEntities: Object.fromEntries(
      Object.entries(gd.containedEntities).map(([parent, kids]) => [parent, kids.map(e => dropOutsideRefs(e, present))]),
    ),
  };

  return {
    meta: { format: 7, category: 'Grid' },
    tilemap: {}, // rebuilt from the tiles actually used
    grid: grid.grid,
    entities: grid.entities,
    containedEntities: grid.containedEntities,
    gridUid: grid.gridUid,
    mapUid: 0,
    orphans: [grid.gridUid],
    nullspace: [],
    structuralEntityData: { [grid.gridUid]: dropRefsOutside(rootGridComponents(map, gd), present) },
    gridDataList: [grid],
    lineEnding: map.lineEnding,
  };
}

/** Serialize one grid of `map` as a `category: Grid` file. */
export function exportGrid(map: ImportedMap, gridUid: number): string {
  // The decals always come from the editor state: the DecalGrid stored in the file is the source map's.
  return exportMap(buildGridFileMap(map, gridUid), new Set([gridUid]));
}

/** Serialize a grid that exists only as editor data (e.g. cut from a selection) as a grid file. */
export function exportStandaloneGrid(gd: GridData): string {
  const map: ImportedMap = {
    meta: { format: 7, category: 'Grid' },
    tilemap: {},
    grid: gd.grid,
    entities: gd.entities,
    gridUid: gd.gridUid,
    mapUid: 0,
    gridDataList: [gd],
  };
  return exportGrid(map, gd.gridUid);
}

/** A file name for the grid ("My Shuttle" -> "My_Shuttle.yml"). */
export function gridFileName(gd: Pick<GridData, 'name' | 'gridUid'>): string {
  const base = gd.name.trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return `${base || `grid_${gd.gridUid}`}.yml`;
}
