/**
 * Export of what the editor itself builds: new maps, added / removed / emptied grids and
 * grid files that gain a second grid. Every result must satisfy the engine's load rules.
 */
import { describe, it, expect } from 'vitest';
import { exportMap } from '../mapExporter';
import { stateToImportedMap } from '../stateToMap';
import { importMap } from '../../import/mapImporter';
import { editorReducer } from '../../state/editorReducer';
import { createInitialState, type EditorState } from '../../state/editorState';
import { validateEngineYaml } from '../../test-utils/engineValidator';
import type { Command } from '../../types';

const paint = (state: EditorState, cells: [number, number][], tileId = 'Plating'): EditorState => {
  const command: Command = {
    label: 'paint',
    tileChanges: cells.map(([x, y]) => ({ x, y, before: { tileId: 'Space' }, after: { tileId } })),
    entityChanges: [],
  };
  return editorReducer(state, { type: 'APPLY_COMMAND', command });
};

const place = (state: EditorState, uid: number, x: number, y: number): EditorState =>
  editorReducer(state, {
    type: 'APPLY_COMMAND',
    command: {
      label: 'place',
      tileChanges: [],
      entityChanges: [{
        action: 'add',
        entity: {
          uid, prototype: 'WallSolid', position: { x: x + 0.5, y: y + 0.5 }, rotation: 0,
          components: [{ type: 'Transform', pos: `${x + 0.5},${y + 0.5}`, parent: state.grids[state.activeGridIndex].gridUid }],
        },
      }],
    },
  });

const exportState = (state: EditorState) => exportMap(stateToImportedMap(state), state.decalsDirty);

function expectValid(yaml: string) {
  const result = validateEngineYaml(yaml, { checkOrdering: true });
  expect(result.errors).toEqual([]);
  return result;
}

describe('exporting editor-built maps', () => {
  it('a new map: map is uid 1, grid uid 2, first entity uid 3', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0], [1, 0], [0, 1]]);
    expect(state.nextEntityId).toBe(3);
    const yaml = exportState(state);
    const r = expectValid(yaml);
    expect(r.category).toBe('Map');
    expect(yaml).toContain('maps:\n- 1\ngrids:\n- 2\norphans: []\nnullspace: []');
  });

  it('writes every grid of a new map, each with its own chunks and entities', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0], [1, 0]]);
    state = place(state, state.localEntityCounter, 0, 0);
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Shuttle' });
    state = editorReducer(state, { type: 'SET_ACTIVE_GRID', index: 1 });
    state = paint(state, [[0, 0], [0, 1], [0, 2]], 'FloorSteel');

    const yaml = exportState(state);
    expectValid(yaml);
    const back = importMap(yaml);
    // uid 3 went to the entity placed on the first grid, so the new grid is 4
    expect(back.gridDataList!.map(g => g.gridUid)).toEqual([2, 4]);
    expect(back.gridDataList![1].name).toBe('Shuttle');
    expect(back.gridDataList![0].grid.cells.filter(c => c.tileId !== 'Space')).toHaveLength(2);
    expect(back.gridDataList![1].grid.cells.filter(c => c.tileId !== 'Space')).toHaveLength(3);
    expect(back.gridDataList![0].entities).toHaveLength(1);
    // The synthesized grid is a complete game grid, parented to the map.
    expect(yaml).toMatch(/type: Shuttle\n\s+dampingModifier: 0.25/);
    const gridEntity = back.structuralEntityData![4];
    expect(gridEntity.find(c => c.type === 'Transform')).toMatchObject({ parent: 1 });
  });

  it('leaves out a grid that has no tiles (the game deletes empty grids)', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0]]);
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Empty' });
    const yaml = exportState(state);
    expectValid(yaml);
    expect(importMap(yaml).gridDataList).toHaveLength(1);
  });

  it('a removed grid does not leave an empty chunks: behind', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0]]);
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Second' });
    state = editorReducer(state, { type: 'SET_ACTIVE_GRID', index: 1 });
    state = paint(state, [[0, 0]]);
    state = editorReducer(state, { type: 'REMOVE_GRID', gridUid: state.grids[1].gridUid });
    const yaml = exportState(state);
    expectValid(yaml);
    expect(importMap(yaml).gridDataList).toHaveLength(1);
  });

  it('a grid whose tiles were all erased is dropped instead of writing chunks: null', () => {
    const base = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    let state = paint(base, [[0, 0]]);
    state = editorReducer(state, {
      type: 'APPLY_COMMAND',
      command: { label: 'erase', tileChanges: [{ x: 0, y: 0, before: { tileId: 'Plating' }, after: { tileId: 'Space' } }], entityChanges: [] },
    });
    const yaml = exportState(state);
    expectValid(yaml);
    expect(yaml).not.toMatch(/chunks:\s*$/m);
  });

  it('uids never collide between the map, grids and entities', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0]]);
    state = place(state, state.localEntityCounter, 0, 0);
    state = { ...state, localEntityCounter: state.localEntityCounter + 1 };
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Second' });
    const uids = [state.mapUid, ...state.grids.map(g => g.gridUid), ...state.grids.flatMap(g => g.entities.map(e => e.uid))];
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe('containers created in the editor', () => {
  it('are written as !type:Container so the game can read them', () => {
    let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
    state = paint(state, [[0, 0]]);
    state = place(state, state.localEntityCounter, 0, 0);
    state = { ...state, localEntityCounter: state.localEntityCounter + 1 };
    const locker = state.grids[0].entities[0];
    state = editorReducer(state, { type: 'ADD_CONTAINED_ENTITY', parentUid: locker.uid, prototypeId: 'Crowbar' });

    const yaml = exportState(state);
    expectValid(yaml);
    expect(yaml).toMatch(/entity_storage: !type:Container\n\s+showEnts: False\n\s+occludes: True\n\s+ents:\n\s*- \d+/);
    const back = importMap(yaml);
    expect(Object.values(back.gridDataList![0].containedEntities).flat()).toHaveLength(1);
  });
});

const GRID_FILE = (tiles: string) => `meta:
  format: 7
  category: Grid
  engineVersion: 267.3.0
  forkId: ""
  forkVersion: ""
  time: 06/09/2025 19:53:56
  entityCount: 2
maps: []
grids:
- 1
orphans:
- 1
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
      name: Test Shuttle
    - type: Transform
      pos: 2.5,-3.5
      parent: invalid
    - type: MapGrid
      chunks:
        0,0:
          ind: 0,0
          tiles: ${tiles}
          version: 7
    - type: Shuttle
      dampingModifier: 0.25
- proto: WallSolid
  entities:
  - uid: 2
    components:
    - type: Transform
      pos: 0.5,0.5
      parent: 1
...
`;

function chunk(filled: number[]): string {
  const buf = Buffer.alloc(256 * 7);
  for (const i of filled) buf.writeInt32LE(5, i * 7);
  return buf.toString('base64');
}

describe('grid files', () => {
  it('survive a load -> save round trip as category: Grid with a valid header', () => {
    const yaml = exportMap(importMap(GRID_FILE(chunk([0, 1, 16]))));
    const r = expectValid(yaml);
    expect(r.category).toBe('Grid');
    expect(yaml).toContain('maps: []\ngrids:\n- 1\norphans:\n- 1\nnullspace: []');
    expect(yaml).toContain('parent: invalid');
  });

  it('become a map file with a generated map entity once a second grid is added', () => {
    let state = editorReducer(createInitialState(), { type: 'LOAD_MAP', map: importMap(GRID_FILE(chunk([0, 1, 16]))) });
    state = editorReducer(state, { type: 'ADD_GRID', name: 'Extra' });
    state = editorReducer(state, { type: 'SET_ACTIVE_GRID', index: 1 });
    state = paint(state, [[0, 0]]);

    const yaml = exportState(state);
    const r = expectValid(yaml);
    expect(r.category).toBe('Map');
    const back = importMap(yaml);
    expect(back.gridDataList).toHaveLength(2);
    expect(back.mapUid).toBeGreaterThan(0);
    expect(back.gridDataList!.map(g => g.gridUid)).not.toContain(back.mapUid);
    // The original grid no longer is an orphan: it hangs off the generated map.
    expect(back.structuralEntityData![1].find(c => c.type === 'Transform')).toMatchObject({ parent: back.mapUid });
  });

  it('adding an entity after loading does not reuse the grid uid', () => {
    const state = editorReducer(createInitialState(), { type: 'LOAD_MAP', map: importMap(GRID_FILE(chunk([0]))) });
    expect(state.nextEntityId).toBeGreaterThan(2);
  });
});
