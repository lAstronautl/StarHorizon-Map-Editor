import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LanPeerConnectionManager } from '../lanPeerConnection';

/**
 * Minimal fake relay + WebRTC stack: a shared in-memory "server" hands out sequential
 * peerIds and routes 'signal' messages between MockWebSocket instances exactly like
 * scripts/lan-signal-server.mjs would, and two MockRTCPeerConnections trickle ICE
 * candidates + SDP through that relay to "connect" their DataChannels — all without a
 * real network or browser WebRTC implementation.
 */
class FakeRelay {
  private sockets = new Map<string, MockWebSocket>();
  private nextId = 1;

  connect(ws: MockWebSocket): string {
    const peerId = `peer-${this.nextId++}`;
    // Tell the newcomer about everyone already connected (before registering it, so it
    // doesn't hear about itself), mirroring scripts/lan-signal-server.mjs.
    const existingIds = [...this.sockets.keys()];
    this.sockets.set(peerId, ws);
    queueMicrotask(() => {
      for (const otherId of existingIds) ws._receive({ type: 'peer-joined', peerId: otherId });
      ws._receive({ type: 'welcome', peerId });
      for (const [otherId, other] of this.sockets) {
        if (otherId === peerId) continue;
        other._receive({ type: 'peer-joined', peerId });
      }
    });
    return peerId;
  }

  route(fromPeerId: string, to: string, data: unknown): void {
    const target = this.sockets.get(to);
    if (target) queueMicrotask(() => target._receive({ type: 'signal', from: fromPeerId, data }));
  }

  disconnect(peerId: string): void {
    this.sockets.delete(peerId);
    for (const other of this.sockets.values()) other._receive({ type: 'peer-left', peerId });
  }
}

let relay: FakeRelay;

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private peerId: string | null = null;

  constructor(_url: string) {
    this.peerId = relay.connect(this);
  }

  _receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.type === 'signal' && this.peerId) relay.route(this.peerId, msg.to, msg.data);
  }

  close(): void {
    if (this.peerId) relay.disconnect(this.peerId);
    this.onclose?.();
  }
}

class MockDataChannel {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  peer: MockDataChannel | null = null;

  send(data: string) { this.peer?.onmessage?.({ data }); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  open() { this.readyState = 'open'; this.onopen?.(); }
}

/** Registry linking one side's offer to the other's answer purely by call order, since
 *  each test only ever negotiates one pair at a time. */
let waitingOfferer: MockRTCPeerConnection | null = null;

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ondatachannel: ((e: { channel: MockDataChannel }) => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  channel: MockDataChannel | null = null;
  private answererPc: MockRTCPeerConnection | null = null;

  createDataChannel(): MockDataChannel {
    this.channel = new MockDataChannel();
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
    if (desc.type === 'offer') waitingOfferer = this;
    // Fire a fake candidate asynchronously to exercise the trickle path.
    queueMicrotask(() => this.onicecandidate?.({ candidate: { candidate: 'fake' } as unknown as RTCIceCandidate }));
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (desc.type === 'offer') {
      this.answererPc = null; // we're the answerer; nothing to link yet
    } else if (desc.type === 'answer' && waitingOfferer === this) {
      // Connect this (offerer) to whichever pc most recently called createAnswer().
      const answerer = MockRTCPeerConnection.lastAnswerer;
      if (answerer && this.channel && answerer.channel) {
        this.channel.peer = answerer.channel;
        answerer.channel.peer = this.channel;
        this.connectionState = 'connected';
        answerer.connectionState = 'connected';
        this.channel.open();
        answerer.channel.open();
      }
    }
  }

  static lastAnswerer: MockRTCPeerConnection | null = null;

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.channel = new MockDataChannel();
    this.ondatachannel?.({ channel: this.channel });
    MockRTCPeerConnection.lastAnswerer = this;
    return { type: 'answer', sdp: 'fake-answer-sdp' };
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.connectionState = 'closed';
    this.channel?.close();
  }
}

/** Poll until `predicate()` is true or time out — the mock relay/WebRTC stack resolves
 *  its handshake steps via queueMicrotask, so a few event-loop turns are needed between
 *  the guest's joinRoom() resolving and the host's onPeerConnected callback firing. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('LanPeerConnectionManager', () => {
  beforeEach(() => {
    relay = new FakeRelay();
    waitingOfferer = null;
    MockRTCPeerConnection.lastAnswerer = null;
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('host and guest connect via the relay and exchange messages both ways', async () => {
    const hostMessages: any[] = [];
    const guestMessages: any[] = [];
    let hostConnectedPeerId: string | null = null;
    let guestConnected = false;

    const host = new LanPeerConnectionManager('host', {
      onPeerConnected: (id) => { hostConnectedPeerId = id; },
      onPeerDisconnected: () => {},
      onMessage: (_from, msg) => hostMessages.push(msg),
      onError: () => {},
    });
    const guest = new LanPeerConnectionManager('guest', {
      onPeerConnected: () => { guestConnected = true; },
      onPeerDisconnected: () => {},
      onMessage: (_from, msg) => guestMessages.push(msg),
      onError: () => {},
    });

    const hostId = await host.hostRoom('ws://localhost:5140');
    expect(typeof hostId).toBe('string');

    await guest.joinRoom('ws://localhost:5140');
    await waitFor(() => hostConnectedPeerId !== null && guestConnected);

    expect(hostConnectedPeerId).not.toBeNull();
    expect(guestConnected).toBe(true);
    expect(host.myPeerId).toBe(hostId);
    expect(guest.myPeerId).not.toBeNull();

    host.broadcast({ type: 'snapshot-request', name: 'Alice' });
    expect(guestMessages).toEqual([{ type: 'snapshot-request', name: 'Alice' }]);

    guest.broadcast({ type: 'peer-left', peerId: 'x' });
    expect(hostMessages).toEqual([{ type: 'peer-left', peerId: 'x' }]);

    expect(host.connectedPeerIds).toEqual([guest.myPeerId]);
  });

  it('disconnect() tears down sockets and connections without throwing', async () => {
    const host = new LanPeerConnectionManager('host', {
      onPeerConnected: () => {}, onPeerDisconnected: () => {}, onMessage: () => {}, onError: () => {},
    });
    await host.hostRoom('ws://localhost:5140');
    expect(() => host.disconnect()).not.toThrow();
    expect(host.myPeerId).toBeNull();
    expect(host.connectedPeerIds).toEqual([]);
  });
});
