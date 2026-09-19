import { describe, it, expect } from 'vitest';
import { editorReducer } from '../editorReducer';
import { createInitialState } from '../editorState';
import { createEmptyGridData } from '../gridData';
import type { GridData } from '../gridData';
import type { ImportedEntity } from '../../import/mapImporter';
import type { NetworkSnapshot } from '../../multiplayer/messages';

function makeEntity(uid: number): ImportedEntity {
  return {
    uid,
    prototype: 'WallSolid',
    position: { x: 5.5, y: 3.5 },
    rotation: 0,
    components: [{ type: 'Transform', pos: '5.5,3.5', parent: 1 }],
  };
}

function makeSnapshot(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  const grid: GridData = { ...createEmptyGridData(1, 'Grid 1'), entities: [makeEntity(2)] };
  return {
    grids: [grid],
    activeGridIndex: 0,
    nextEntityId: 3,
    assignedPeerIndex: 1,
    localEntityCounter: 0,
    localGridCounter: 0,
    forkName: null,
    ...overrides,
  };
}

describe('LOAD_REMOTE_SNAPSHOT', () => {
  it('replaces grids/entities and legacy aliases from the snapshot', () => {
    const state = createInitialState();
    const snapshot = makeSnapshot();
    const result = editorReducer(state, { type: 'LOAD_REMOTE_SNAPSHOT', snapshot });

    expect(result.grids).toEqual(snapshot.grids);
    expect(result.entities).toEqual(snapshot.grids[0].entities);
    expect(result.grid).toEqual(snapshot.grids[0].grid);
    expect(result.gridUid).toBe(1);
    expect(result.nextEntityId).toBe(3);
  });

  it('adopts the host-assigned peerIndex and local counters for UID namespacing', () => {
    const state = createInitialState();
    const snapshot = makeSnapshot({ assignedPeerIndex: 2, localEntityCounter: 7, localGridCounter: 4 });
    const result = editorReducer(state, { type: 'LOAD_REMOTE_SNAPSHOT', snapshot });

    expect(result.localPeerIndex).toBe(2);
    expect(result.localEntityCounter).toBe(7);
    expect(result.localGridCounter).toBe(4);
  });

  it('clears undo/redo history and selections (a fresh session, not a local edit)', () => {
    const state = createInitialState();
    const snapshot = makeSnapshot();
    const result = editorReducer(state, { type: 'LOAD_REMOTE_SNAPSHOT', snapshot });

    expect(result.undoStack).toEqual([]);
    expect(result.redoStack).toEqual([]);
    expect(result.selectedEntityUids).toEqual([]);
    expect(result.selectedDecalIds).toEqual([]);
    expect(result.dirty).toBe(false);
  });

  it('clamps activeGridIndex into bounds if it is out of range', () => {
    const state = createInitialState();
    const snapshot = makeSnapshot({ activeGridIndex: 99 });
    const result = editorReducer(state, { type: 'LOAD_REMOTE_SNAPSHOT', snapshot });

    expect(result.activeGridIndex).toBe(0);
  });
});
