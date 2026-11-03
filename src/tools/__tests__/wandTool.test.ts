import { describe, it, expect, beforeEach } from 'vitest';
import { WandTool } from '../wandTool';
import { SelectTool } from '../selectTool';
import type { ToolContext } from '../toolTypes';
import { createInitialState, setCell } from '../../state/editorState';
import type { EditorState } from '../../state/editorState';
import type { ImportedEntity } from '../../import/mapImporter';
import { Camera } from '../../rendering/camera';
import { rebuildSpatialIndex } from '../../rendering/spatialIndex';

function makeEntity(uid: number, proto: string, x: number, y: number): ImportedEntity {
  return { uid, prototype: proto, position: { x: x + 0.5, y: y + 0.5 }, rotation: 0, components: [] };
}

function makeGrid(width: number, height: number) {
  return { width, height, offsetX: 0, offsetY: 0, cells: Array.from({ length: width * height }, () => ({ tileId: 'Space' })) };
}

type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean };

function setup(entities: ImportedEntity[] = []) {
  const grid = makeGrid(12, 12);
  const state: EditorState = { ...createInitialState(), grid, entities };
  rebuildSpatialIndex(entities);
  const dispatched: any[] = [];
  const selectTool = new SelectTool();
  const wand = new WandTool(selectTool);
  const click = (x: number, y: number, mods: Mods = {}, button = 0) => {
    const ctx: ToolContext = {
      state, dispatch: (a: any) => dispatched.push(a), camera: new Camera(), canvasW: 800, canvasH: 600,
      paletteItem: null, shiftHeld: !!mods.shift, ctrlHeld: !!mods.ctrl, altHeld: !!mods.alt,
    };
    wand.onMouseDown(ctx, x, y, button);
  };
  return { state, grid, wand, selectTool, dispatched, click };
}

const keys = (s: ReadonlySet<string>) => [...s].sort();

describe('WandTool: tiles', () => {
  beforeEach(() => rebuildSpatialIndex([]));

  it('selects the connected region of the clicked tile type', () => {
    const { grid, selectTool, click, dispatched } = setup();
    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [2, 2]]) setCell(grid, x, y, { tileId: 'Plating' });
    setCell(grid, 8, 8, { tileId: 'Plating' }); // same type, not connected
    click(2, 1);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['1,1', '2,1', '2,2', '3,1']);
    expect(dispatched[dispatched.length - 1]).toEqual({ type: 'SET_TOOL', tool: 'select' });
  });

  it('does not cross a different tile type', () => {
    const { grid, selectTool, click } = setup();
    setCell(grid, 1, 1, { tileId: 'Plating' });
    setCell(grid, 2, 1, { tileId: 'FloorSteel' });
    setCell(grid, 3, 1, { tileId: 'Plating' });
    click(1, 1);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['1,1']);
  });

  it('Alt selects every tile of that type on the grid', () => {
    const { grid, selectTool, click } = setup();
    setCell(grid, 1, 1, { tileId: 'Plating' });
    setCell(grid, 8, 8, { tileId: 'Plating' });
    setCell(grid, 5, 5, { tileId: 'FloorSteel' });
    click(1, 1, { alt: true });
    expect(keys(selectTool.getSelectedTiles())).toEqual(['1,1', '8,8']);
  });

  it('a click on empty space does nothing', () => {
    const { selectTool, click, dispatched } = setup();
    click(4, 4);
    expect(selectTool.getSelectedTiles().size).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it('a click outside the grid does nothing', () => {
    const { selectTool, click, dispatched } = setup();
    click(500, -40);
    expect(selectTool.getSelectedTiles().size).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it('only reacts to the left button', () => {
    const { grid, selectTool, click } = setup();
    setCell(grid, 1, 1, { tileId: 'Plating' });
    click(1, 1, {}, 2);
    expect(selectTool.getSelectedTiles().size).toBe(0);
  });

  it('Shift adds a region to the selection and Ctrl takes one away', () => {
    const { grid, selectTool, click } = setup();
    setCell(grid, 1, 1, { tileId: 'Plating' });
    setCell(grid, 2, 1, { tileId: 'Plating' });
    setCell(grid, 8, 8, { tileId: 'FloorSteel' });
    click(1, 1);
    click(8, 8, { shift: true });
    expect(keys(selectTool.getSelectedTiles())).toEqual(['1,1', '2,1', '8,8']);
    click(1, 1, { ctrl: true });
    expect(keys(selectTool.getSelectedTiles())).toEqual(['8,8']);
  });

  it('replaces the previous selection without a modifier', () => {
    const { grid, selectTool, click } = setup();
    setCell(grid, 1, 1, { tileId: 'Plating' });
    setCell(grid, 8, 8, { tileId: 'FloorSteel' });
    click(1, 1);
    click(8, 8);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['8,8']);
  });

  it('copes with a large grid (limit keeps one click bounded)', () => {
    const grid = { width: 400, height: 400, offsetX: 0, offsetY: 0, cells: Array.from({ length: 160000 }, () => ({ tileId: 'Plating' })) };
    const state: EditorState = { ...createInitialState(), grid, entities: [] };
    const selectTool = new SelectTool();
    new WandTool(selectTool).onMouseDown({
      state, dispatch: () => {}, camera: new Camera(), canvasW: 1, canvasH: 1, paletteItem: null, shiftHeld: false, ctrlHeld: false,
    }, 200, 200, 0);
    expect(selectTool.getSelectedTiles().size).toBe(50_000);
  });

  it('leaves the Select tool ready to save the region as a grid', () => {
    const { grid, selectTool, click, state } = setup();
    for (let x = 1; x <= 3; x++) setCell(grid, x, 1, { tileId: 'Plating' });
    click(2, 1);
    const ctx: ToolContext = { state, dispatch: () => {}, camera: new Camera(), canvasW: 1, canvasH: 1, paletteItem: null, shiftHeld: false, ctrlHeld: false };
    const labels = selectTool.getContextMenuItems(ctx, 2, 1).map(i => i.label);
    expect(labels).toContain('Сохранить как грид (.yml)...');
    expect(labels).toContain('Вынести в новый грид...');
  });
});

describe('WandTool: tiles under walls', () => {
  beforeEach(() => rebuildSpatialIndex([]));

  const tagged = (uid: number, x: number, y: number, tag: string): ImportedEntity => ({
    uid, prototype: `Thing${uid}`, position: { x: x + 0.5, y: y + 0.5 }, rotation: 0,
    components: [{ type: 'Tag', tags: [tag] }],
  });

  /** A 3x3 room (x 2..4, y 2..4) ringed by a one-tile wall of Plating, like a real station. */
  function room(extra: ImportedEntity[] = []) {
    const walls: ImportedEntity[] = [];
    let uid = 100;
    for (let x = 1; x <= 5; x++) for (let y = 1; y <= 5; y++) {
      if (x >= 2 && x <= 4 && y >= 2 && y <= 4) continue;
      walls.push(tagged(uid++, x, y, 'Wall'));
    }
    const ctx = setup([...walls, ...extra]);
    for (let x = 1; x <= 5; x++) for (let y = 1; y <= 5; y++) setCell(ctx.grid, x, y, { tileId: 'Plating' }); // same tile under the walls
    return ctx;
  }

  it('selects the room floor and not the tiles the walls stand on', () => {
    const { selectTool, click } = room();
    click(3, 3);
    expect(keys(selectTool.getSelectedTiles())).toEqual(
      ['2,2', '2,3', '2,4', '3,2', '3,3', '3,4', '4,2', '4,3', '4,4'],
    );
  });

  it('does not spread through a doorway or a window into the next room', () => {
    const { selectTool, click, grid } = setup([tagged(1, 4, 3, 'Window'), tagged(2, 3, 5, 'Wall')]);
    for (let x = 1; x <= 8; x++) setCell(grid, x, 3, { tileId: 'Plating' });
    click(2, 3);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['1,3', '2,3', '3,3']);
  });

  it('Alt selects every floor tile of the type but still skips wall tiles', () => {
    const { selectTool, click } = room();
    click(3, 3, { alt: true });
    expect(selectTool.getSelectedTiles().size).toBe(9);
    expect(selectTool.getSelectedTiles().has('1,1')).toBe(false);
  });

  it('a single wall tile stops the spread', () => {
    const { selectTool, click, grid } = setup([tagged(1, 3, 3, 'Wall')]);
    for (let x = 2; x <= 4; x++) setCell(grid, x, 3, { tileId: 'Plating' });
    click(2, 3);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['2,3']);
  });

  it('ordinary furniture on a floor tile does not block the selection', () => {
    const { selectTool, click, grid } = setup([tagged(1, 3, 3, 'Chair')]);
    for (let x = 2; x <= 4; x++) setCell(grid, x, 3, { tileId: 'Plating' });
    click(2, 3);
    expect(keys(selectTool.getSelectedTiles())).toEqual(['2,3', '3,3', '4,3']);
  });
});

describe('WandTool: entities', () => {
  beforeEach(() => rebuildSpatialIndex([]));

  const wallRow = () => [
    makeEntity(1, 'WallSolid', 2, 2), makeEntity(2, 'WallSolid', 3, 2), makeEntity(3, 'WallSolid', 4, 2),
    makeEntity(4, 'Window', 5, 2), // different prototype in the line
    makeEntity(5, 'WallSolid', 6, 2), // same prototype behind the window
    makeEntity(6, 'WallSolid', 10, 10), // far away
  ];

  it('selects connected entities of the clicked prototype', () => {
    const { click, dispatched } = setup(wallRow());
    click(3, 2);
    expect(dispatched[0]).toMatchObject({ type: 'SELECT_ENTITY' });
    expect([...dispatched[0].uids].sort()).toEqual([1, 2, 3]);
    expect(dispatched[dispatched.length - 1]).toEqual({ type: 'SET_TOOL', tool: 'entitySelect' });
  });

  it('Alt selects every entity of that prototype on the grid', () => {
    const { click, dispatched } = setup(wallRow());
    click(3, 2, { alt: true });
    expect([...dispatched[0].uids].sort()).toEqual([1, 2, 3, 5, 6]);
  });

  it('an entity wins over the tile under it', () => {
    const { grid, click, dispatched, selectTool } = setup([makeEntity(1, 'Chair', 4, 4)]);
    setCell(grid, 4, 4, { tileId: 'Plating' });
    click(4, 4);
    expect(dispatched[0].type).toBe('SELECT_ENTITY');
    expect(selectTool.getSelectedTiles().size).toBe(0);
  });

  it('Shift adds and Ctrl removes', () => {
    const { click, dispatched } = setup(wallRow());
    click(3, 2, { shift: true });
    expect(dispatched[0]).toMatchObject({ type: 'ADD_SELECT_ENTITIES' });
    click(3, 2, { ctrl: true });
    expect(dispatched.find(a => a.type === 'REMOVE_SELECT_ENTITIES')).toBeDefined();
  });

  it('works through the reducer: the clicked wall segment ends up selected', async () => {
    const { editorReducer } = await import('../../state/editorReducer');
    const entities = wallRow();
    const { click, dispatched, state } = setup(entities);
    click(3, 2);
    let s: EditorState = state;
    for (const a of dispatched) s = editorReducer(s, a);
    expect([...s.selectedEntityUids].sort()).toEqual([1, 2, 3]);
    expect(s.activeTool).toBe('entitySelect');
  });
});
