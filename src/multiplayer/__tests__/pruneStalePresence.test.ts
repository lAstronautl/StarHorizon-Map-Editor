import { describe, it, expect } from 'vitest';
import { pruneStalePresence } from '../roomSession';
import type { RemotePresence } from '../roomSession';

function makePresence(lastSeen: number): RemotePresence {
  return {
    peerId: 'p1', peerIndex: 1, name: 'Alice', color: '#ff5555',
    cursorTileX: 1, cursorTileY: 2, preview: null, lastSeen,
  };
}

describe('pruneStalePresence', () => {
  it('keeps recently-seen presence entries', () => {
    const now = 10_000;
    const input = { p1: makePresence(now - 1000) };
    expect(pruneStalePresence(input, now)).toBe(input); // unchanged reference, nothing pruned
  });

  it('drops presence entries older than the stale threshold', () => {
    const now = 10_000;
    const input = { p1: makePresence(now - 10_000) };
    const result = pruneStalePresence(input, now);
    expect(result).not.toHaveProperty('p1');
  });

  it('only removes the stale entries, keeping fresh ones', () => {
    const now = 10_000;
    const input = {
      fresh: makePresence(now - 100),
      stale: makePresence(now - 999_999),
    };
    const result = pruneStalePresence(input, now);
    expect(result).toHaveProperty('fresh');
    expect(result).not.toHaveProperty('stale');
  });
});
