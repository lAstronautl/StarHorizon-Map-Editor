import { describe, it, expect } from 'vitest';
import type { NetworkMessage, NetworkSnapshot } from '../messages';
import type { Command } from '../../types';
import { createEmptyGridData } from '../../state/gridData';

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('NetworkMessage serialization', () => {
  it('round-trips an action message with tile/entity changes intact', () => {
    const command: Command = {
      label: 'Paint',
      tileChanges: [{ x: 1, y: 2, before: { tileId: 'Space' }, after: { tileId: 'Plating' } }],
      entityChanges: [],
    };
    const msg: NetworkMessage = { type: 'action', action: { type: 'APPLY_COMMAND', command }, seq: 5 };
    const result = roundTrip(msg);
    expect(result).toEqual(msg);
  });

  it('round-trips a snapshot message with full grid data', () => {
    const grid = createEmptyGridData(1, 'Grid 1');
    const payload: NetworkSnapshot = {
      grids: [grid],
      activeGridIndex: 0,
      nextEntityId: 2,
      assignedPeerIndex: 1,
      localEntityCounter: 0,
      localGridCounter: 0,
      forkName: null,
    };
    const msg: NetworkMessage = { type: 'snapshot', payload };
    const result = roundTrip(msg);
    expect(result).toEqual(msg);
  });

  it('round-trips a presence message including null cursor and opaque preview', () => {
    const msg: NetworkMessage = {
      type: 'presence',
      payload: {
        peerId: 'abc123',
        peerIndex: 1,
        name: 'Alice',
        color: '#ff5555',
        cursorTileX: null,
        cursorTileY: null,
        preview: { tool: 'paint', tileChanges: [{ x: 0, y: 0, before: { tileId: 'Space' }, after: { tileId: 'Plating' } }] },
      },
    };
    const result = roundTrip(msg);
    expect(result).toEqual(msg);
  });

  it('round-trips peer-info and peer-left messages', () => {
    const info: NetworkMessage = { type: 'peer-info', peerId: 'p1', peerIndex: 2, name: 'Bob', color: '#55aaff' };
    const left: NetworkMessage = { type: 'peer-left', peerId: 'p1' };
    expect(roundTrip(info)).toEqual(info);
    expect(roundTrip(left)).toEqual(left);
  });

  it('round-trips a snapshot-request message carrying the requester nickname', () => {
    const msg: NetworkMessage = { type: 'snapshot-request', name: 'Alice' };
    expect(roundTrip(msg)).toEqual(msg);
  });
});
