import { describe, it, expect, vi } from 'vitest';
import { createNetworkDispatch, applyRemoteCommand, applyRemoteAction } from '../networkDispatch';
import type { Command } from '../../types';

function makeCommand(): Command {
  return {
    label: 'Paint',
    tileChanges: [{ x: 0, y: 0, before: { tileId: 'Space' }, after: { tileId: 'Plating' } }],
    entityChanges: [],
  };
}

describe('createNetworkDispatch', () => {
  it('broadcasts and applies a locally-dispatched APPLY_COMMAND', () => {
    const rawDispatch = vi.fn();
    const broadcast = vi.fn();
    const dispatch = createNetworkDispatch(rawDispatch, broadcast);

    const command = makeCommand();
    dispatch({ type: 'APPLY_COMMAND', command });

    expect(broadcast).toHaveBeenCalledWith({ type: 'APPLY_COMMAND', command });
    expect(rawDispatch).toHaveBeenCalledWith({ type: 'APPLY_COMMAND', command });
  });

  it('broadcasts grid/container actions that mutate shared state', () => {
    const rawDispatch = vi.fn();
    const broadcast = vi.fn();
    const dispatch = createNetworkDispatch(rawDispatch, broadcast);

    dispatch({ type: 'ADD_GRID', name: 'Shuttle' });
    expect(broadcast).toHaveBeenCalledWith({ type: 'ADD_GRID', name: 'Shuttle' });

    dispatch({ type: 'ADD_CONTAINED_ENTITY', parentUid: 5, prototypeId: 'Crowbar' });
    expect(broadcast).toHaveBeenCalledWith({ type: 'ADD_CONTAINED_ENTITY', parentUid: 5, prototypeId: 'Crowbar' });
  });

  it('does NOT broadcast purely-local UI actions', () => {
    const rawDispatch = vi.fn();
    const broadcast = vi.fn();
    const dispatch = createNetworkDispatch(rawDispatch, broadcast);

    dispatch({ type: 'SET_TOOL', tool: 'select' });
    dispatch({ type: 'SELECT_ENTITY', uids: [1, 2] });
    dispatch({ type: 'UNDO' });
    dispatch({ type: 'REDO' });

    expect(broadcast).not.toHaveBeenCalled();
    expect(rawDispatch).toHaveBeenCalledTimes(4);
  });

  it('never re-broadcasts a command applied via applyRemoteCommand (loop prevention)', () => {
    const rawDispatch = vi.fn();
    const broadcast = vi.fn();
    // The remote-apply path intentionally never sees `broadcast` at all — it calls
    // rawDispatch directly, structurally guaranteeing no re-broadcast is possible.
    applyRemoteCommand(rawDispatch, makeCommand());

    expect(rawDispatch).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('applyRemoteAction likewise bypasses broadcast for relayed grid/container actions', () => {
    const rawDispatch = vi.fn();
    applyRemoteAction(rawDispatch, { type: 'RENAME_GRID', gridUid: 2, name: 'Renamed' });
    expect(rawDispatch).toHaveBeenCalledWith({ type: 'RENAME_GRID', gridUid: 2, name: 'Renamed' });
  });
});
