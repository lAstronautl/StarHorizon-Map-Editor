import type { NetworkMessage } from './messages';
import type { PeerConnectionCallbacks, IConnectionManager } from './peerConnection';

/**
 * Raw WebRTC signaling with no server at all — the host and guest exchange a short
 * opaque code (base64 of the SDP offer/answer, gzip-free since browsers handle it fine
 * at this size) by any channel they like (chat, voice call, pasting into this app's UI).
 * This is the fallback for when the public PeerJS broker is unreachable (blocked network,
 * no internet at all) — it works even for two machines on a VPN mesh (Radmin/Hamachi) or
 * plain LAN with zero other outside connectivity, as long as ICE can find a path. A public
 * STUN server is still used purely to help gather real candidates (see ICE_SERVERS below);
 * no data ever flows through it.
 *
 * Mirrors PeerConnectionManager's public shape (hostRoom/joinRoom/broadcast/sendTo/
 * myPeerId/disconnect) so `roomSession.ts` can use either transport interchangeably,
 * but the connection setup here is two explicit steps instead of one:
 *   Host:  createOffer()  -> show code A -> (out of band) -> acceptAnswer(codeB)
 *   Guest: acceptOffer(codeA) -> show code B -> (out of band) -> done
 */

const LOCAL_PEER_ID = 'manual-self';
const REMOTE_PEER_ID = 'manual-remote';

// STUN-only (no TURN, no relay of actual data) — this just helps the browser discover
// its real reflexive/host candidates instead of hiding local IPs behind mDNS `.local`
// names, which often fail to resolve between two machines joined via a VPN mesh like
// Radmin/Hamachi. No data ever touches this server, only the ICE candidate-gathering step.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Gzip-compress the JSON before base64 — SDP text (especially with several ICE
 *  candidates once STUN is involved) compresses very well, roughly halving the code's
 *  length compared to plain base64 of the raw JSON. Falls back to uncompressed base64
 *  if CompressionStream isn't available (very old browsers), with a marker byte so
 *  decode() can tell the two formats apart either way. */
export async function encode(obj: unknown): Promise<string> {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') {
    return '0' + btoa(json);
  }
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let binary = '';
  for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
  return '1' + btoa(binary);
}

export async function decode<T>(code: string): Promise<T> {
  const trimmed = code.trim();
  const marker = trimmed[0];
  const payload = trimmed.slice(1);
  if (marker === '0') {
    return JSON.parse(atob(payload));
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const decompressed = await new Response(ds.readable).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(decompressed));
}

/** Wait for ICE gathering to finish so the encoded description includes all candidates
 *  (no trickle-ICE support here — there's no signaling channel to trickle them over). */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class ManualPeerConnectionManager implements IConnectionManager {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private callbacks: PeerConnectionCallbacks;
  private seqCounter = 0;
  private connected = false;

  constructor(callbacks: PeerConnectionCallbacks) {
    this.callbacks = callbacks;
  }

  /** Host step 1: create the offer code to send to the guest. */
  async createOffer(): Promise<string> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    const channel = pc.createDataChannel('data', { ordered: true });
    this.setupChannel(channel);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.callbacks.onError(new Error('Соединение прервано.'));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    return encode({ sdp: pc.localDescription });
  }

  /** Host step 2: apply the guest's answer code once they've sent it back. */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.pc) throw new Error('No offer was created yet.');
    const { sdp } = await decode<{ sdp: RTCSessionDescriptionInit }>(answerCode);
    await this.pc.setRemoteDescription(sdp);
  }

  /** Guest step 1: apply the host's offer code, producing the answer code to send back. */
  async acceptOffer(offerCode: string): Promise<string> {
    const { sdp } = await decode<{ sdp: RTCSessionDescriptionInit }>(offerCode);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.ondatachannel = (e) => this.setupChannel(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.callbacks.onError(new Error('Соединение прервано.'));
      }
    };

    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    return encode({ sdp: pc.localDescription });
  }

  private setupChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      this.connected = true;
      this.callbacks.onPeerConnected(REMOTE_PEER_ID);
    };
    channel.onclose = () => {
      this.connected = false;
      this.callbacks.onPeerDisconnected(REMOTE_PEER_ID);
    };
    channel.onerror = () => this.callbacks.onError(new Error('Ошибка канала передачи данных.'));
    channel.onmessage = (e) => {
      this.callbacks.onMessage(REMOTE_PEER_ID, JSON.parse(e.data) as NetworkMessage);
    };
  }

  /** Same shape as PeerConnectionManager.broadcast — only one remote peer here (2-player only). */
  broadcast(message: NetworkMessage, excludePeerId?: string): void {
    if (excludePeerId === REMOTE_PEER_ID) return;
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message));
  }

  sendTo(peerId: string, message: NetworkMessage): void {
    if (peerId !== REMOTE_PEER_ID) return;
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message));
  }

  nextSeq(): number {
    return this.seqCounter++;
  }

  get myPeerId(): string | null {
    return this.connected ? LOCAL_PEER_ID : null;
  }

  get connectedPeerIds(): string[] {
    return this.connected ? [REMOTE_PEER_ID] : [];
  }

  disconnect(): void {
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    this.connected = false;
  }
}
