import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManualPeerConnectionManager, encode, decode } from '../manualPeerConnection';

/**
 * Minimal fake WebRTC stack: two MockRTCPeerConnection instances "connected" to each
 * other via a shared registry keyed by a fake SDP string, so createOffer/setRemoteDescription/
 * createAnswer round-trip exactly like real signaling would, and the two DataChannels can
 * actually exchange messages — without needing a real browser/jsdom WebRTC implementation.
 */
class MockDataChannel {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  peer: MockDataChannel | null = null;

  send(data: string) {
    this.peer?.onmessage?.({ data });
  }
  close() {
    this.readyState = 'closed';
    this.onclose?.();
  }
  open() {
    this.readyState = 'open';
    this.onopen?.();
  }
}

let pendingOffers: Map<string, MockRTCPeerConnection> = new Map();

class MockRTCPeerConnection {
  iceGatheringState: 'complete' = 'complete';
  connectionState: RTCPeerConnectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: MockDataChannel }) => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  channel: MockDataChannel | null = null;
  private offerId = '';

  addEventListener() {} // iceGatheringState is always 'complete' here, no waiting needed
  removeEventListener() {}

  createDataChannel(): MockDataChannel {
    this.channel = new MockDataChannel();
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.offerId = Math.random().toString(36).slice(2);
    return { type: 'offer', sdp: this.offerId };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
    if (desc.type === 'offer') pendingOffers.set(this.offerId, this);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      // We're the answering side: link our channel to the offerer's channel once it opens.
      const offerer = pendingOffers.get(desc.sdp!);
      if (offerer) {
        this.offerId = desc.sdp!;
        (this as any)._offererPc = offerer;
      }
    } else if (desc.type === 'answer') {
      // We're the offering side receiving the answer: link channels now and "connect".
      const answererPc: MockRTCPeerConnection = (this as any)._answererPc;
      if (answererPc && this.channel && answererPc.channel) {
        this.channel.peer = answererPc.channel;
        answererPc.channel.peer = this.channel;
        this.connectionState = 'connected';
        answererPc.connectionState = 'connected';
        this.channel.open();
        answererPc.channel.open();
      }
    }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    // Simulate our own DataChannel arriving via ondatachannel (we didn't create one
    // explicitly — the offerer did), and register ourselves on the offerer so its
    // setRemoteDescription(answer) can link the two channels together.
    const offerer: MockRTCPeerConnection | undefined = (this as any)._offererPc;
    this.channel = new MockDataChannel();
    this.ondatachannel?.({ channel: this.channel });
    if (offerer) {
      (offerer as any)._answererPc = this;
    }
    return { type: 'answer', sdp: `answer-${this.offerId}` };
  }

  close() {
    this.connectionState = 'closed';
    this.channel?.close();
  }
}

describe('ManualPeerConnectionManager', () => {
  beforeEach(() => {
    pendingOffers = new Map();
    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completes a full offer/answer handshake and exchanges messages both ways', async () => {
    const hostMessages: any[] = [];
    const guestMessages: any[] = [];
    let hostConnected = false;
    let guestConnected = false;

    const host = new ManualPeerConnectionManager({
      onPeerConnected: () => { hostConnected = true; },
      onPeerDisconnected: () => {},
      onMessage: (_from, msg) => hostMessages.push(msg),
      onError: () => {},
    });
    const guest = new ManualPeerConnectionManager({
      onPeerConnected: () => { guestConnected = true; },
      onPeerDisconnected: () => {},
      onMessage: (_from, msg) => guestMessages.push(msg),
      onError: () => {},
    });

    const offerCode = await host.createOffer();
    expect(typeof offerCode).toBe('string');

    const answerCode = await guest.acceptOffer(offerCode);
    expect(typeof answerCode).toBe('string');

    await host.acceptAnswer(answerCode);

    expect(hostConnected).toBe(true);
    expect(guestConnected).toBe(true);
    expect(host.myPeerId).not.toBeNull();
    expect(guest.myPeerId).not.toBeNull();

    host.broadcast({ type: 'snapshot-request', name: 'Alice' });
    expect(guestMessages).toEqual([{ type: 'snapshot-request', name: 'Alice' }]);

    guest.broadcast({ type: 'peer-left', peerId: 'x' });
    expect(hostMessages).toEqual([{ type: 'peer-left', peerId: 'x' }]);
  });

  it('the offer code is different each time (fresh RTCPeerConnection per attempt)', async () => {
    const host1 = new ManualPeerConnectionManager({
      onPeerConnected: () => {}, onPeerDisconnected: () => {}, onMessage: () => {}, onError: () => {},
    });
    const host2 = new ManualPeerConnectionManager({
      onPeerConnected: () => {}, onPeerDisconnected: () => {}, onMessage: () => {}, onError: () => {},
    });
    const codeA = await host1.createOffer();
    const codeB = await host2.createOffer();
    expect(codeA).not.toBe(codeB);
  });

  it('disconnect() tears down the channel without throwing', async () => {
    const host = new ManualPeerConnectionManager({
      onPeerConnected: () => {}, onPeerDisconnected: () => {}, onMessage: () => {}, onError: () => {},
    });
    await host.createOffer();
    expect(() => host.disconnect()).not.toThrow();
    expect(host.myPeerId).toBeNull();
    expect(host.connectedPeerIds).toEqual([]);
  });

});

describe('encode/decode', () => {
  const candidateLines = Array.from({ length: 6 }, (_, i) =>
    `a=candidate:${i} 1 udp 2122260223 192.168.1.${10 + i} ${5000 + i} typ host generation 0 ufrag abcd network-cost 999`,
  ).join('\r\n');
  const fakeDescription = {
    sdp: {
      type: 'offer' as const,
      sdp: `v=0\r\no=- 1234567890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n${candidateLines}\r\n`,
    },
  };

  it('round-trips a realistic multi-candidate SDP payload losslessly', async () => {
    const code = await encode(fakeDescription);
    const decoded = await decode<typeof fakeDescription>(code);
    expect(decoded).toEqual(fakeDescription);
  });

  it('round-trips text containing non-ASCII characters (e.g. nicknames elsewhere in the app)', async () => {
    const payload = { note: 'Привет, мир! 🚀' };
    const code = await encode(payload);
    const decoded = await decode<typeof payload>(code);
    expect(decoded).toEqual(payload);
  });
});
