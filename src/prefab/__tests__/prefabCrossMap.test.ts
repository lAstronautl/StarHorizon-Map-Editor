/**
 * A prefab saved on one map and placed on another: parents, references and positions must be
 * rewritten for the destination, and the result must export as a loadable map.
 */
import { describe, it, expect } from 'vitest';
import { serializePrefab } from '../prefabSerializer';
import { placePrefab } from '../prefabPlacer';
import { stringifyPrefab, parsePrefabJson } from '../prefabIO';
import { buildPrefabFromColorGrid } from '../../imageImport/colorMapping';
import { editorReducer } from '../../state/editorReducer';
import { createInitialState, setCell, type EditorState } from '../../state/editorState';
import { createEmptyGridData, type GridData } from '../../state/gridData';
import type { ImportedEntity } from '../../import/mapImporter';
import { exportMap } from '../../export/mapExporter';
import { stateToImportedMap } from '../../export/stateToMap';
import { validateEngineYaml } from '../../test-utils/engineValidator';

const tf = (x: number, y: number, parent: number) => ({ type: 'Transform', pos: `${x},${y}`, parent });

/** Source map: grid 2 with a locker (holding a crowbar), a door wired to a button, and a far-away wire target. */
function sourceGrid(): GridData {
  const gd = createEmptyGridData(2, 'Source');
  gd.grid = { width: 8, height: 8, offsetX: 0, offsetY: 0, cells: Array.from({ length: 64 }, () => ({ tileId: 'Plating' })) };
  gd.entities = [
    { uid: 40, prototype: 'Locker', position: { x: 1.5, y: 1.25 }, rotation: 0, components: [
      tf(1.5, 1.25, 2),
      { type: 'ContainerContainer', containers: { entity_storage: { _ss14Tag: '!type:Container', showEnts: false, occludes: true, ents: [41] } } },
    ] },
    { uid: 42, prototype: 'Door', position: { x: 2.5, y: 1.5 }, rotation: 0, components: [tf(2.5, 1.5, 2), { type: 'DeviceList', devices: [43, 999] }] },
    { uid: 43, prototype: 'Button', position: { x: 3.5, y: 1.5 }, rotation: 0, components: [
      tf(3.5, 1.5, 2),
      { type: 'DeviceLinkSource', linkedPorts: { 42: [['Pressed', 'Toggle']], 999: [['Pressed', 'Toggle']] } },
    ] },
    { uid: 50, prototype: 'Chair', position: { x: 6.5, y: 6.5 }, rotation: 0, components: [tf(6.5, 6.5, 2)] }, // outside the prefab
  ];
  gd.containedEntities = { 40: [{ uid: 41, prototype: 'Crowbar', position: { x: 0, y: 0 }, rotation: 0, components: [{ type: 'Transform', parent: 40 }] }] };
  return gd;
}

function makePrefab() {
  const gd = sourceGrid();
  return serializePrefab({
    name: 'Corner', minX: 0, minY: 0, maxX: 4, maxY: 3,
    grid: gd.grid, entities: gd.entities, containedEntities: gd.containedEntities,
  });
}

/** Destination: a fresh map whose uid 40..43 are taken by unrelated entities. */
function destination(): EditorState {
  let state = editorReducer(createInitialState(), { type: 'NEW_MAP' });
  const grid = state.grids[0];
  grid.grid = { width: 32, height: 32, offsetX: 0, offsetY: 0, cells: Array.from({ length: 1024 }, () => ({ tileId: 'Space' })) };
  const decoy = (uid: number): ImportedEntity => ({ uid, prototype: 'Decoy', position: { x: 20.5, y: 20.5 }, rotation: 0, components: [tf(20.5, 20.5, grid.gridUid)] });
  grid.entities = [decoy(40), decoy(42), decoy(43)];
  state = { ...state, grid: grid.grid, entities: grid.entities, nextEntityId: 100, localEntityCounter: 100 };
  return state;
}

function place(state: EditorState, prefab = makePrefab(), x = 10, y = 12): EditorState {
  const result = placePrefab({
    prefab, placeX: x, placeY: y, grid: state.grid, entities: state.entities,
    nextEntityId: state.localEntityCounter, gridUid: state.grids[0].gridUid,
  });
  return editorReducer(state, { type: 'APPLY_COMMAND', command: result.command });
}

describe('serializePrefab (version 2)', () => {
  it('keeps exact offsets and the source uids', () => {
    const prefab = makePrefab();
    expect(prefab.version).toBe(2);
    const locker = prefab.entities[0];
    expect(locker).toMatchObject({ prototype: 'Locker', dx: 1.5, dy: 1.25, srcUid: 40 });
  });

  it('captures what is inside containers, linked to its container', () => {
    const prefab = makePrefab();
    const crowbar = prefab.entities.find(e => e.prototype === 'Crowbar')!;
    expect(crowbar.containerIdx).toBe(0);
    expect(prefab.entities).toHaveLength(4); // locker, crowbar, door, button (the chair is outside)
  });

  it('only takes what is under the selection mask', () => {
    const gd = sourceGrid();
    const mask = new Set(['1,1', '2,1']); // locker + door tile, not the button's
    const prefab = serializePrefab({
      name: 'Masked', minX: 0, minY: 0, maxX: 4, maxY: 3, grid: gd.grid, entities: gd.entities,
      containedEntities: gd.containedEntities, selectedTiles: mask,
    });
    expect(prefab.entities.map(e => e.prototype).sort()).toEqual(['Crowbar', 'Door', 'Locker']);
    expect(prefab.tiles).toHaveLength(2);
  });
});

describe('placing a prefab on another map', () => {
  it('attaches the entities to the destination grid, not the source map\'s grid', () => {
    const state = place(destination());
    const dest = state.grids[0];
    const placed = dest.entities.filter(e => ['Locker', 'Door', 'Button'].includes(e.prototype));
    expect(placed).toHaveLength(3);
    for (const e of placed) expect(e.components.find(c => c.type === 'Transform')).toMatchObject({ parent: dest.gridUid });
  });

  it('places entities at their exact position inside the tile', () => {
    const state = place(destination(), makePrefab(), 10, 12);
    const locker = state.grids[0].entities.find(e => e.prototype === 'Locker')!;
    expect(locker.position).toEqual({ x: 11.5, y: 13.25 });
    expect(locker.components.find(c => c.type === 'Transform')).toMatchObject({ pos: '11.5,13.25' });
  });

  it('gives everything new uids that collide with nothing', () => {
    const state = place(destination());
    const dest = state.grids[0];
    const uids = [dest.gridUid, state.mapUid, ...dest.entities.map(e => e.uid), ...Object.values(dest.containedEntities).flat().map(e => e.uid)];
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('remaps device lists and links to the placed copies and drops those pointing outside', () => {
    const state = place(destination());
    const byProto = (p: string) => state.grids[0].entities.find(e => e.prototype === p)!;
    const door = byProto('Door'), button = byProto('Button');
    expect(door.components.find(c => c.type === 'DeviceList')).toEqual({ type: 'DeviceList', devices: [button.uid] });
    expect(button.components.find(c => c.type === 'DeviceLinkSource')).toEqual({
      type: 'DeviceLinkSource', linkedPorts: { [door.uid]: [['Pressed', 'Toggle']] },
    });
  });

  it('places container contents, wired to their new container', () => {
    const state = place(destination());
    const dest = state.grids[0];
    const locker = dest.entities.find(e => e.prototype === 'Locker')!;
    const kids = dest.containedEntities[locker.uid];
    expect(kids).toHaveLength(1);
    expect(kids[0].prototype).toBe('Crowbar');
    expect(kids[0].components.find(c => c.type === 'Transform')).toMatchObject({ parent: locker.uid });
    const cc = locker.components.find(c => c.type === 'ContainerContainer') as { containers: { entity_storage: { ents: number[] } } };
    expect(cc.containers.entity_storage.ents).toEqual([kids[0].uid]); // listed once, not duplicated
  });

  it('undoes in one step', () => {
    const before = destination();
    const after = editorReducer(place(before), { type: 'UNDO' });
    expect(after.grids[0].entities.map(e => e.uid)).toEqual(before.grids[0].entities.map(e => e.uid));
    expect(Object.keys(after.grids[0].containedEntities)).toHaveLength(0);
  });

  it('exports as a map the engine can load', () => {
    const state = place(destination());
    // the destination needs tiles under the prefab for a non-empty grid
    setCell(state.grids[0].grid, 11, 13, { tileId: 'Plating' });
    const yaml = exportMap(stateToImportedMap(state), state.decalsDirty);
    expect(validateEngineYaml(yaml, { checkOrdering: true }).errors).toEqual([]);
  });

  it('survives a trip through JSON', () => {
    const prefab = parsePrefabJson(stringifyPrefab(makePrefab()));
    const state = place(destination(), prefab);
    expect(state.grids[0].entities.some(e => e.prototype === 'Locker')).toBe(true);
  });
});

describe('prefabs saved before version 2', () => {
  const legacy = {
    name: 'Old', width: 3, height: 3,
    tiles: [{ dx: 0, dy: 0, tileId: 'Plating' }],
    entities: [
      { dx: 1, dy: 1, prototype: 'Door', rotation: 0, components: [tf(1.5, 1.5, 2), { type: 'DeviceList', devices: [7] }] },
      { dx: 2, dy: 1, prototype: 'Button', rotation: 0, components: [tf(2.5, 1.5, 2), { type: 'DeviceLinkSource', linkedPorts: { 7: [['A', 'B']] } }] },
    ],
    deviceLinks: [{ sourceIdx: 1, targetIdx: 0, port: 'A', sink: 'B' }],
  };

  it('are centered on the tile like before and still get the destination parent', () => {
    const state = place(destination(), parsePrefabJson(JSON.stringify(legacy)), 10, 12);
    const door = state.grids[0].entities.find(e => e.prototype === 'Door')!;
    expect(door.position).toEqual({ x: 11.5, y: 13.5 });
    expect(door.components.find(c => c.type === 'Transform')).toMatchObject({ parent: state.grids[0].gridUid });
  });

  it('drop unknown uids and rebuild the links from the recorded device links', () => {
    const state = place(destination(), parsePrefabJson(JSON.stringify(legacy)));
    const door = state.grids[0].entities.find(e => e.prototype === 'Door')!;
    const button = state.grids[0].entities.find(e => e.prototype === 'Button')!;
    expect(door.components.find(c => c.type === 'DeviceList')).toEqual({ type: 'DeviceList', devices: [] });
    expect(button.components.find(c => c.type === 'DeviceLinkSource')).toEqual({
      type: 'DeviceLinkSource', linkedPorts: { [door.uid]: [['A', 'B']] },
    });
  });
});

describe('prefab built from an image', () => {
  it('puts the entity on the pixel\'s tile (not one tile over)', () => {
    const prefab = buildPrefabFromColorGrid(
      { width: 2, height: 2, pixels: ['#ff0000', null, null, null] } as never,
      { '#ff0000': { tileId: 'Plating', entityIds: ['Wall'] } },
      'Img',
    );
    const state = place(destination(), prefab, 10, 20);
    const wall = state.grids[0].entities.find(e => e.prototype === 'Wall')!;
    // pixel (0,0) is the top row: dy = 1, so tile (10, 21), center (10.5, 21.5)
    expect(wall.position).toEqual({ x: 10.5, y: 21.5 });
    expect(Math.floor(wall.position.x)).toBe(10);
    expect(Math.floor(wall.position.y)).toBe(21);
  });
});
