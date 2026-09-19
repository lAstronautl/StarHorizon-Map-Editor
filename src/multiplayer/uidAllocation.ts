import type { EditorState } from '../state/editorState';

/** Highest number of local UIDs any single peer namespace may mint before overlapping the next. */
const NAMESPACE_SIZE = 2 ** 24;

/**
 * Map a (peerIndex, localCounter) pair to a globally unique UID.
 * peerIndex 0 (single-player / host default) yields the identity function,
 * so existing maps/tests that assume plain sequential UIDs are unaffected.
 */
export function peerUid(peerIndex: number, counter: number): number {
  return peerIndex * NAMESPACE_SIZE + counter;
}

/**
 * Mint a new, globally-unique entity UID for this peer and bump its local counter.
 * Deliberately reads/writes `localEntityCounter`, not `nextEntityId` — the latter
 * tracks the highest UID seen from ANY peer (via applyCommand) and would corrupt
 * this peer's own namespace if reused as the minting source.
 */
export function mintEntityUid(state: EditorState): { uid: number; localEntityCounter: number } {
  const uid = peerUid(state.localPeerIndex, state.localEntityCounter);
  return { uid, localEntityCounter: state.localEntityCounter + 1 };
}

/** Same scheme as mintEntityUid, for grid UIDs. */
export function mintGridUid(state: EditorState): { uid: number; localGridCounter: number } {
  const uid = peerUid(state.localPeerIndex, state.localGridCounter);
  return { uid, localGridCounter: state.localGridCounter + 1 };
}
