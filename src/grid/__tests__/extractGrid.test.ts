import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractGridFromSelection, EmptySelectionError } from '../extractGrid';
import { SelectTool } from '../../tools/selectTool';
import type { ToolContext } from '../../tools/toolTypes';
import { createEmptyGridData, type GridData } from '../../state/gridData';
import { createInitialState, setCell } from '../../state/editorState';
import { editorReducer } from '../../state/editorReducer';
import { Camera } from '../../rendering/camera';
import { rebuildSpatialIndex } from '../../rendering/spatialIndex';
import { exportStandaloneGrid } from '../../export/gridExporter';
import { exportMap } from '../../export/mapExporter';
import { stateToImportedMap } from '../../export/stateToMap';
import { importMap } from '../../import/mapImporter';
import { validateEngineYaml } from '../../test-utils/engineValidator';

/** A 10x10 grid at (100,50), rotated a quarter turn, with a wall, a locker holding a crowbar and a decal. */
function makeSource(): GridData {
  const gd = createEmptyGridData(2, 'Station');
  gd.grid = { width: 10, height: 10, offsetX: 0, offsetY: 0, cells: Array.from({ length: 100 }, () => ({ tileId: 'Space' })) };
  for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) setCell(gd.grid, x, y, { tileId: 'Plating', variant: 2 });
  setCell(gd.grid, 0, 0, { tileId: 'FloorSteel' }); // outside the selection
  gd.worldPosition = { x: 100, y: 50 };
  gd.structuralComponents = [
    { type: 'MetaData', name: 'Station' },
    { type: 'Transform', rot: `${Math.PI / 2} rad`, pos: '100,50', parent: 1 },
    { type: 'MapGrid' },
    { type: 'Physics', bodyType: 'Dynamic' },
    { type: 'BecomesStation', id: 'Test' },
    { type: 'GridAtmosphere' },
  ];
  gd.entities = [
    { uid: 10, prototype: 'WallSolid', position: { x: 4.5, y: 3.5 }, rotation: 0, components: [{ type: 'Transform', pos: '4.5,3.5', parent: 2 }] },
    { uid: 11, prototype: 'Locker', position: { x: 5.5, y: 3.5 }, rotation: 0, components: [
      { type: 'Transform', pos: '5.5,3.5', parent: 2 },
      { type: 'ContainerContainer', containers: { entity_storage: { _ss14Tag: '!type:Container', showEnts: false, occludes: true, ents: [12] } } },
    ] },
    { uid: 13, prototype: 'Chair', position: { x: 0.5, y: 0.5 }, rotation: 0, components: [{ type: 'Transform', pos: '0.5,0.5', parent: 2 }] }, // outside
  ];
  gd.containedEntities = { 11: [{ uid: 12, prototype: 'Crowbar', position: { x: 0, y: 0 }, rotation: 0, components: [{ type: 'Transform', parent: 11 }] }] };
  gd.decals = { nextDecalId: 3, decals: [
    { id: 1, prototypeId: 'Bot', position: { x: 4.5, y: 4.5 }, color: null, angle: 0, zIndex: 0, cleanable: false },
    { id: 2, prototypeId: 'Bot', position: { x: 0.5, y: 0.5 }, color: null, angle: 0, zIndex: 0, cleanable: false },
  ] };
  return gd;
}

const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const s = new Set<string>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.add(`${x},${y}`);
  return s;
};

describe('extractGridFromSelection', () => {
  it('moves tiles, keeping their variants, to the new grid origin', () => {
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    expect(gridData.grid).toMatchObject({ width: 3, height: 2, offsetX: 0, offsetY: 0 });
    expect(gridData.grid.cells.every(c => c.tileId === 'Plating' && c.variant === 2)).toBe(true);
    expect(gridData.gridUid).toBe(50);
    expect(gridData.name).toBe('Cut');
  });

  it('takes the entities on the selected tiles with their uids, local positions and the new parent', () => {
    const { gridData, entities } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    expect(entities.map(e => e.uid)).toEqual([10, 11]); // the chair is outside
    expect(gridData.entities.map(e => e.uid)).toEqual([10, 11]);
    expect(gridData.entities[0].position).toEqual({ x: 0.5, y: 0.5 });
    expect(gridData.entities[0].components[0]).toEqual({ type: 'Transform', pos: '0.5,0.5', parent: 50 });
    expect(gridData.entities[1].components[0]).toMatchObject({ pos: '1.5,0.5', parent: 50 });
  });

  it('takes the contents of containers along and leaves their parent alone', () => {
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    expect(gridData.containedEntities[11].map(e => e.uid)).toEqual([12]);
    expect(gridData.containedEntities[11][0].components[0]).toMatchObject({ parent: 11 });
  });

  it('takes decals under the selection and shifts them', () => {
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    expect(gridData.decals.decals).toEqual([expect.objectContaining({ id: 1, position: { x: 0.5, y: 1.5 } })]);
    expect(gridData.decals.nextDecalId).toBe(2);
  });

  it('places the new grid where the selection was, honouring the source grid rotation', () => {
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    // corner (4,3) rotated a quarter turn = (-3,4), added to the grid pos (100,50)
    expect(gridData.worldPosition.x).toBeCloseTo(97);
    expect(gridData.worldPosition.y).toBeCloseTo(54);
    expect(gridData.structuralComponents.find(c => c.type === 'Transform')?.rot).toBe(`${Math.PI / 2} rad`);
  });

  it('only takes the selected tiles of an irregular selection', () => {
    const sel = new Set(['4,3', '5,3', '4,4']); // L shape
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: sel, gridUid: 50, name: 'L' });
    expect(gridData.grid.cells.filter(c => c.tileId !== 'Space')).toHaveLength(3);
    expect(gridData.grid.cells[3].tileId).toBe('Space'); // (5,4) is in the bounding box but not selected
  });

  it('refuses a selection with no tiles', () => {
    expect(() => extractGridFromSelection({ source: makeSource(), selectedTiles: new Set(), gridUid: 50, name: 'x' })).toThrow(EmptySelectionError);
    expect(() => extractGridFromSelection({ source: makeSource(), selectedTiles: rect(8, 8, 9, 9), gridUid: 50, name: 'x' })).toThrow(EmptySelectionError);
  });

  it('does not touch the source grid', () => {
    const source = makeSource();
    const before = JSON.stringify(source);
    extractGridFromSelection({ source, selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut' });
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('a grid cut from a selection, as a file', () => {
  it('is a valid category: Grid file without anything of the source grid\'s own station data', () => {
    const { gridData } = extractGridFromSelection({ source: makeSource(), selectedTiles: rect(4, 3, 6, 4), gridUid: 50, name: 'Cut Out' });
    const yaml = exportStandaloneGrid(gridData);
    const r = validateEngineYaml(yaml, { checkOrdering: true });
    expect(r.errors).toEqual([]);
    expect(r.category).toBe('Grid');
    expect(yaml).toContain('name: Cut Out');
    expect(yaml).toContain('type: Physics'); // copied from the source grid
    expect(yaml).not.toContain('BecomesStation'); // would create a second station
    expect(yaml).not.toContain('GridAtmosphere');
    expect(yaml).toContain('entity_storage: !type:Container');
    expect(yaml).toContain('Bot');
    const back = importMap(yaml);
    expect(back.gridDataList![0].entities.map(e => e.uid).sort()).toEqual([10, 11]);
    expect(Object.values(back.gridDataList![0].containedEntities).flat().map(e => e.uid)).toEqual([12]);
  });
});

describe('SelectTool grid actions', () => {
  let tool: SelectTool;
  beforeEach(() => {
    tool = new SelectTool();
    rebuildSpatialIndex([]);
    vi.restoreAllMocks();
  });

  function selectedContext() {
    const state = { ...createInitialState(), grids: [makeSource()], nextEntityId: 14, localEntityCounter: 14 };
    state.grid = state.grids[0].grid;
    state.entities = state.grids[0].entities;
    state.gridUid = 2;
    rebuildSpatialIndex(state.entities);
    const dispatched: any[] = [];
    const ctx: ToolContext = {
      state, dispatch: (a: any) => dispatched.push(a), camera: new Camera(),
      canvasW: 800, canvasH: 600, paletteItem: null, shiftHeld: false, ctrlHeld: false,
    };
    tool.onMouseDown(ctx, 4, 3, 0);
    tool.onMouseMove(ctx, 6, 4);
    tool.onMouseUp(ctx);
    return { ctx, dispatched };
  }

  it('offers both grid actions for a selection', () => {
    const { ctx } = selectedContext();
    const labels = tool.getContextMenuItems(ctx, 4, 3).map(i => i.label);
    expect(labels).toContain('Сохранить как грид (.yml)...');
    expect(labels).toContain('Вынести в новый грид...');
  });

  it('"move to new grid" removes the selection from the source and adds the grid as a tab', () => {
    const { ctx, dispatched } = selectedContext();
    vi.stubGlobal('window', { prompt: () => 'Wing', alert: () => {} });
    tool.moveSelectionToNewGrid(ctx);
    vi.unstubAllGlobals();

    const types = dispatched.map(a => a.type);
    expect(types).toEqual(['APPLY_COMMAND', 'ADD_GRID', 'SET_ACTIVE_GRID']);
    const removal = dispatched[0].command;
    expect(removal.tileChanges).toHaveLength(6);
    expect(removal.entityChanges.map((c: any) => c.entity.uid).sort()).toEqual([10, 11]);
    expect(dispatched[1].gridData.name).toBe('Wing');
    expect(dispatched[2].index).toBe(1);

    // Feed the dispatched actions through the reducer: the map still exports as valid, collision free YAML.
    let state = { ...createInitialState(), grids: [makeSource()], nextEntityId: 14, localEntityCounter: 14 };
    state = editorReducer(state, dispatched[0]);
    state = editorReducer(state, dispatched[1]);
    expect(state.grids).toHaveLength(2);
    expect(state.grids[0].entities.map(e => e.uid)).toEqual([13]); // only the chair stayed
    expect(dispatched[1].gridData.gridUid).toBe(14);
    expect(state.nextEntityId).toBe(15);
    expect(state.localEntityCounter).toBe(15);
    const yaml = exportMap(stateToImportedMap(state), state.decalsDirty);
    expect(validateEngineYaml(yaml).errors).toEqual([]);
  });

  it('"save as grid" does nothing without a name', () => {
    const { ctx, dispatched } = selectedContext();
    vi.stubGlobal('window', { prompt: () => null, alert: () => {} });
    tool.saveSelectionAsGridFile(ctx);
    vi.unstubAllGlobals();
    expect(dispatched).toHaveLength(0);
  });
});
