import type { EditorAction } from '../state/actions';
import type { Command } from '../types';

export type RawDispatch = (action: EditorAction) => void;

/** The subset of EditorAction that mutates shared map state and must be relayed to the room. */
export type NetworkedAction = Extract<EditorAction,
  | { type: 'APPLY_COMMAND' }
  | { type: 'ADD_GRID' }
  | { type: 'REMOVE_GRID' }
  | { type: 'RENAME_GRID' }
  | { type: 'ADD_CONTAINED_ENTITY' }
  | { type: 'REMOVE_CONTAINED_ENTITY' }
>;

/** Action types that mutate shared map state and must be relayed to the room as-is. */
const NETWORKED_ACTION_TYPES = new Set<EditorAction['type']>([
  'ADD_GRID', 'REMOVE_GRID', 'RENAME_GRID', 'ADD_CONTAINED_ENTITY', 'REMOVE_CONTAINED_ENTITY',
]);

function isNetworkedAction(action: EditorAction): action is NetworkedAction {
  return action.type === 'APPLY_COMMAND' || NETWORKED_ACTION_TYPES.has(action.type);
}

/**
 * Wraps the raw reducer dispatch so every locally-produced map-mutating action is also
 * broadcast to the room, then applies it locally exactly like the unwrapped dispatch would.
 *
 * APPLY_COMMAND (the vast majority of edits — paint/place/select-move/etc.) is broadcast
 * verbatim as a Command. A handful of other actions also mutate shared state without going
 * through APPLY_COMMAND (grid CRUD, container contents) and are relayed as-is too.
 * UNDO/REDO are NOT relayed here — see roomSession.ts, which re-dispatches their effect as
 * an equivalent APPLY_COMMAND so peers converge without needing synchronized undo stacks.
 *
 * Loop prevention is structural, not flag-based: this wrapper is the ONLY path that
 * broadcasts. Remote-origin commands must be applied via `applyRemoteCommand` below,
 * which calls `rawDispatch` directly and never touches `broadcast` — so a message received
 * from the network can never be re-sent back out.
 */
export function createNetworkDispatch(
  rawDispatch: RawDispatch,
  broadcast: (action: NetworkedAction) => void,
): RawDispatch {
  return (action: EditorAction) => {
    if (isNetworkedAction(action)) {
      broadcast(action);
    }
    rawDispatch(action);
  };
}

/** Apply a command received from a remote peer. Bypasses the network dispatch entirely. */
export function applyRemoteCommand(rawDispatch: RawDispatch, command: Command): void {
  rawDispatch({ type: 'APPLY_COMMAND', command });
}

/** Apply any other relayed map-mutating action received from a remote peer. */
export function applyRemoteAction(rawDispatch: RawDispatch, action: EditorAction): void {
  rawDispatch(action);
}
