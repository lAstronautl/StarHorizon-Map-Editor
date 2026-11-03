/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { exportGrid, gridFileName, GridExportError } from '../gridExporter';
import { exportMap } from '../mapExporter';
import { stateToImportedMap } from '../stateToMap';
import { importMap, type ImportedMap } from '../../import/mapImporter';
import { editorReducer } from '../../state/editorReducer';
import { createInitialState } from '../../state/editorState';
import { findMapFiles, resolveMapsDir } from '../../test-utils/realMaps';
import { validateEngineYaml } from '../../test-utils/engineValidator';

function chunk(filled: number[], tileId = 5): string {
  const buf = Buffer.alloc(256 * 7);
  for (const i of filled) buf.writeInt32LE(tileId, i * 7);
  return buf.toString('base64');
}

/** A map with a station grid (2) and a shuttle grid (100) that is docked to it and linked to its devices. */
const TWO_GRID_MAP = `meta:
  format: 7
  category: Map
  engineVersion: 267.3.0
  forkId: ""
  forkVersion: ""
  time: 06/09/2025 19:53:56
  entityCount: 8
maps:
- 1
grids:
- 2
- 100
orphans: []
nullspace: []
tilemap:
  0: Space
  5: Plating
entities:
- proto: ""
  entities:
  - uid: 1
    components:
    - type: MetaData
    - type: Transform
    - type: Map
      mapPaused: True
    - type: GridTree
    - type: Broadphase
    - type: OccluderTree
  - uid: 2
    components:
    - type: MetaData
      name: Station
    - type: Transform
      parent: 1
    - type: MapGrid
      chunks:
        0,0:
          ind: 0,0
          tiles: ${chunk([0, 1, 2])}
          version: 7
  - uid: 100
    components:
    - type: MetaData
      name: Ferry
    - type: Transform
      rot: 1.5707963267948966 rad
      pos: 40.5,12.5
      parent: 1
    - type: MapGrid
      chunks:
        0,0:
          ind: 0,0
          tiles: ${chunk([0, 1, 16, 17])}
          version: 7
    - type: Joint
      joints:
        docking7: !type:WeldJoint
          bodyB: 100
          bodyA: 2
          id: docking7
    - type: Shuttle
      dampingModifier: 0.25
- proto: AirlockShuttle
  entities:
  - uid: 10
    components:
    - type: Transform
      pos: 0.5,0.5
      parent: 100
    - type: Docking
      dockJointId: docking7
      dockedWith: 11
    - type: DeviceLinkSource
      linkedPorts:
        12:
        - - Open
          - Toggle
        20:
        - - Open
          - Toggle
- proto: AirlockStation
  entities:
  - uid: 11
    components:
    - type: Transform
      pos: 0.5,0.5
      parent: 2
    - type: Docking
      dockJointId: docking7
      dockedWith: 10
- proto: Button
  entities:
  - uid: 12
    components:
    - type: Transform
      pos: 1.5,0.5
      parent: 100
- proto: Crowbar
  entities:
  - uid: 13
    components:
    - type: Transform
      pos: 2.5,0.5
      parent: 100
  - uid: 20
    components:
    - type: Transform
      pos: 1.5,1.5
      parent: 2
...
`;

describe('exportGrid', () => {
  const map = importMap(TWO_GRID_MAP);

  it('writes a self-contained category: Grid file with the grid as its only orphan', () => {
    const yaml = exportGrid(map, 100);
    const r = validateEngineYaml(yaml, { checkOrdering: true });
    expect(r.errors).toEqual([]);
    expect(r.category).toBe('Grid');
    expect(yaml).toContain('maps: []\ngrids:\n- 100\norphans:\n- 100\nnullspace: []');
    expect(yaml).toContain('parent: invalid');
    expect(yaml).toMatch(/\.\.\.\n$/);
  });

  it('keeps only this grid, its entities and uids, and the grid position/rotation', () => {
    const back = importMap(exportGrid(map, 100));
    expect(back.gridDataList).toHaveLength(1);
    expect(back.gridDataList![0].name).toBe('Ferry');
    expect(back.gridDataList![0].entities.map(e => e.uid).sort((a, b) => a - b)).toEqual([10, 12, 13]);
    expect(back.gridDataList![0].worldPosition).toEqual({ x: 40.5, y: 12.5 });
    const t = back.structuralEntityData![100].find(c => c.type === 'Transform')!;
    expect(t.rot).toBe('1.5707963267948966 rad');
    expect(back.mapUid).toBe(0);
  });

  it('cuts the ties to the rest of the map: joints, docking and links to other grids', () => {
    const yaml = exportGrid(map, 100);
    expect(yaml).not.toContain('type: Joint');
    const back = importMap(yaml);
    const door = back.gridDataList![0].entities.find(e => e.uid === 10)!;
    expect(door.components.find(c => c.type === 'Docking')).toEqual({ type: 'Docking' });
    const links = (door.components.find(c => c.type === 'DeviceLinkSource') as { linkedPorts: object }).linkedPorts;
    expect(Object.keys(links)).toEqual(['12']); // 20 lives on the station grid
  });

  it('writes only the tiles that grid uses and re-numbers the tilemap', () => {
    const yaml = exportGrid(map, 100);
    expect(yaml).toContain('tilemap:\n  0: Space\n  1: Plating\n');
    const cells = importMap(yaml).gridDataList![0].grid.cells.filter(c => c.tileId !== 'Space');
    expect(cells).toHaveLength(4);
  });

  it('exports every grid of a map independently', () => {
    for (const gd of map.gridDataList!) {
      expect(validateEngineYaml(exportGrid(map, gd.gridUid)).errors).toEqual([]);
    }
  });

  it('refuses a grid with no tiles and an unknown grid', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Empty' });
    expect(() => exportGrid(stateToImportedMap(state), state.grids[1].gridUid)).toThrow(GridExportError);
    expect(() => exportGrid(map, 999)).toThrow(GridExportError);
  });

  it('exports a grid that was added in the editor with a complete shuttle setup', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = editorReducer(state, { type: 'ADD_GRID', name: 'My Ship' });
    state = editorReducer(state, { type: 'SET_ACTIVE_GRID', index: 1 });
    state = editorReducer(state, {
      type: 'APPLY_COMMAND',
      command: { label: 'paint', tileChanges: [{ x: 0, y: 0, before: { tileId: 'Space' }, after: { tileId: 'Plating' } }], entityChanges: [] },
    });
    const gridUid = state.grids[1].gridUid;
    const yaml = exportGrid(stateToImportedMap(state), gridUid);
    expect(validateEngineYaml(yaml).errors).toEqual([]);
    expect(yaml).toMatch(/name: My Ship/);
    expect(yaml).toMatch(/type: Physics\n\s+bodyStatus: InAir/);
    expect(yaml).toMatch(/type: Shuttle\n\s+dampingModifier: 0.25/);
    // loads back as a map-less grid
    const back = importMap(yaml);
    expect(back.gridDataList![0].gridUid).toBe(gridUid);
  });

  it('carries the editor decals, not the ones stored in the source file', () => {
    let state = editorReducer(createInitialState(), { type: 'LOAD_MAP', map });
    const g = state.grids.find(x => x.gridUid === 100)!;
    g.decals = { nextDecalId: 2, decals: [{ id: 1, prototypeId: 'Bot', position: { x: 0.5, y: 0.5 }, color: null, angle: 0, zIndex: 0, cleanable: false }] };
    const yaml = exportGrid(stateToImportedMap(state), 100);
    expect(yaml).toContain('type: DecalGrid');
    expect(yaml).toContain('Bot');
  });
});

describe('gridFileName', () => {
  it('makes a safe file name', () => {
    expect(gridFileName({ name: 'My Ship: Mk/2', gridUid: 5 })).toBe('My_Ship_Mk_2.yml');
    expect(gridFileName({ name: '  ', gridUid: 5 })).toBe('grid_5.yml');
  });
});

describe('exportGrid on real maps', () => {
  const dir = resolveMapsDir();
  const all = findMapFiles(dir);
  const full = process.env.SS14_PARITY_FULL === '1';
  const files = full ? all : all.filter((_, i) => i % 15 === 4);

  for (const file of files) {
    it(file.slice(dir.length + 1), () => {
      const text = readFileSync(file, 'utf-8');
      if (validateEngineYaml(text).errors.length > 0) return;
      const map: ImportedMap = importMap(text);
      for (const gd of map.gridDataList ?? []) {
        if (!gd.grid.cells.some(c => c.tileId !== 'Space')) continue;
        const yaml = exportGrid(map, gd.gridUid);
        const r = validateEngineYaml(yaml, { checkOrdering: true });
        expect(r.errors, `grid ${gd.gridUid}`).toEqual([]);
        expect(r.category).toBe('Grid');
        const contained = Object.values(gd.containedEntities).flat().length;
        expect(r.entityCount, 'entities of the grid').toBe(1 + gd.entities.length + contained);
        // the file loads back as a single grid with the same tiles
        const back = importMap(yaml);
        expect(back.gridDataList).toHaveLength(1);
        expect(back.gridDataList![0].grid.cells.filter(c => c.tileId !== 'Space')).toHaveLength(
          gd.grid.cells.filter(c => c.tileId !== 'Space').length,
        );
      }
    });
  }
});

// Keep exportMap referenced so a regression in the shared path shows up here too.
describe('grid file as a map input', () => {
  it('a grid file loaded and saved as a map keeps category Grid', () => {
    const grid = exportGrid(importMap(TWO_GRID_MAP), 100);
    expect(validateEngineYaml(exportMap(importMap(grid))).category).toBe('Grid');
  });
});
