import { describe, it, expect } from 'vitest';
import { editorReducer } from '../editorReducer';
import { createInitialState } from '../editorState';

describe('MARK_SAVED', () => {
  it('clears the dirty flag', () => {
    const state = { ...createInitialState(), dirty: true };
    const next = editorReducer(state, { type: 'MARK_SAVED' });
    expect(next.dirty).toBe(false);
  });

  it('leaves the rest of the state untouched', () => {
    const state = { ...createInitialState(), dirty: true };
    const next = editorReducer(state, { type: 'MARK_SAVED' });
    const { dirty: _nextDirty, ...restNext } = next;
    const { dirty: _stateDirty, ...restState } = state;
    expect(restNext).toEqual(restState);
  });

  it('is a no-op on dirty when already false', () => {
    const state = { ...createInitialState(), dirty: false };
    const next = editorReducer(state, { type: 'MARK_SAVED' });
    expect(next.dirty).toBe(false);
  });
});
