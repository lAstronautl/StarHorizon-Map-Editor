import { describe, it, expect } from 'vitest';
import { peerUid, mintEntityUid, mintGridUid } from '../uidAllocation';
import { createInitialState } from '../../state/editorState';

describe('peerUid', () => {
  it('is the identity function for peerIndex 0 (single-player default)', () => {
    expect(peerUid(0, 0)).toBe(0);
    expect(peerUid(0, 5)).toBe(5);
    expect(peerUid(0, 12345)).toBe(12345);
  });

  it('namespaces other peers into disjoint ranges', () => {
    const a = peerUid(1, 2);
    const b = peerUid(2, 2);
    expect(a).not.toBe(b);
    expect(peerUid(0, 0)).toBeLessThan(peerUid(1, 0));
    expect(peerUid(1, 0)).toBeLessThan(peerUid(2, 0));
  });

  it('never collides between two peers minting many sequential UIDs', () => {
    const seen = new Set<number>();
    for (let peer = 0; peer < 4; peer++) {
      for (let i = 0; i < 1000; i++) {
        const uid = peerUid(peer, i);
        expect(seen.has(uid)).toBe(false);
        seen.add(uid);
      }
    }
  });
});

describe('mintEntityUid', () => {
  it('mints sequential UIDs starting from localEntityCounter, unaffected by nextEntityId', () => {
    const state = createInitialState();
    state.nextEntityId = 999; // simulate a much-higher max-seen UID from remote peers
    const first = mintEntityUid(state);
    expect(first.uid).toBe(state.localEntityCounter);
    const nextState = { ...state, localEntityCounter: first.localEntityCounter };
    const second = mintEntityUid(nextState);
    expect(second.uid).toBe(first.uid + 1);
  });

  it('matches plain sequential nextEntityId behavior when localPeerIndex is 0', () => {
    const state = createInitialState();
    const { uid } = mintEntityUid(state);
    expect(uid).toBe(state.localEntityCounter);
    expect(uid).toBe(2); // reserved UIDs 0/1, first real entity is 2
  });

  it('namespaces minted UIDs by localPeerIndex for non-host peers', () => {
    const state = { ...createInitialState(), localPeerIndex: 1, localEntityCounter: 2 };
    const { uid } = mintEntityUid(state);
    expect(uid).toBe(peerUid(1, 2));
    expect(uid).not.toBe(2);
  });
});

describe('mintGridUid', () => {
  it('mints sequential grid UIDs independent of entity UID counter', () => {
    const state = createInitialState();
    const { uid, localGridCounter } = mintGridUid(state);
    expect(uid).toBe(state.localGridCounter);
    const next = mintGridUid({ ...state, localGridCounter });
    expect(next.uid).toBe(uid + 1);
  });
});
