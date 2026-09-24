import type { NetworkMessage } from './messages';
import type { PeerConnectionCallbacks, IConnectionManager, ConnectionRole } from './peerConnection';
import type { LanSignalMessage } from './lanSignaling';

/**
 * WebRTC signaling over a small local WebSocket relay (scripts/lan-signal-server.mjs) that
 * the host runs on their own machine. Uses trickle ICE — candidates are sent as they're
 * discovered instead of waiting for gathering to fully complete — and the relay makes joining
 * automatic (enter the host's LAN/Hamachi/Radmin IP and port, no manual code exchange). The
 * relay only ever sees
 * SDP/ICE signaling messages, never map data — once a WebRTC DataChannel is open, all actual
 * traffic goes directly peer-to-peer and the relay is no longer involved for that pair.
 *
 * Same star topology as PeerConnectionManager: the host holds one RTCPeerConnection per
 * guest and relays messages between them; each guest holds exactly one, to the host.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface PeerLink {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  open: boolean;
}

export class LanPeerConnectionManager implements IConnectionManager {
  private ws: WebSocket | null = null;
  private role: ConnectionRole;
  private callbacks: PeerConnectionCallbacks;
  private seqCounter = 0;
  private selfId: string | null = null;
  private links = new Map<string, PeerLink>();
  /** Guest-only: the host's peerId, once we learn it via 'welcome'/relay. */
  private hostId: string | null = null;

  constructor(role: ConnectionRole, callbacks: PeerConnectionCallbacks) {
    this.role = role;
    this.callbacks = callbacks;
  }

  /** Host: start listening for guests via the relay at ws://host:port (usually localhost,
   *  since the host runs the relay on their own machine). Resolves once the relay accepts
   *  the connection and assigns this tab a peerId (used as `myPeerId`). */
  hostRoom(relayUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      this.ws = ws;
      ws.onerror = () => reject(new Error('Не удалось подключиться к локальному серверу сигнализации.'));
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as LanSignalMessage;
        if (msg.type === 'welcome') {
          this.selfId = msg.peerId;
          resolve(msg.peerId);
          return;
        }
        this.handleSignal(msg);
      };
      ws.onclose = () => this.callbacks.onError(new Error('Соединение с локальным сервером сигнализации потеряно.'));
    });
  }

  /** Guest: connect to the host's relay and initiate WebRTC negotiation once the host
   *  peer is known (either already present or announced via 'peer-joined'). */
  joinRoom(relayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      this.ws = ws;
      let settled = false;
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error("Не удалось подключиться к серверу хоста. Проверьте IP:порт.")); }
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as LanSignalMessage;
        if (msg.type === 'welcome') {
          this.selfId = msg.peerId;
          return;
        }
        if (msg.type === 'peer-joined' && !this.hostId) {
          // The relay only ever has the host and this guest for a fresh room, so the
          // first peer we see (besides ourselves) is the host.
          this.hostId = msg.peerId;
          this.initiateOfferTo(msg.peerId).then(() => {
            if (!settled) { settled = true; resolve(); }
          }).catch((err) => {
            if (!settled) { settled = true; reject(err); }
          });
          return;
        }
        this.handleSignal(msg);
      };
      ws.onclose = () => this.callbacks.onError(new Error('Соединение с сервером хоста потеряно.'));
    });
  }

  private sendSignal(to: string, data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'signal', to, data } satisfies LanSignalMessage));
    }
  }

  /** Guest → host: create an offer and start trickling ICE candidates over the relay. */
  private async initiateOfferTo(peerId: string): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: PeerLink = { pc, channel: null, open: false };
    this.links.set(peerId, link);

    const channel = pc.createDataChannel('data', { ordered: true });
    this.setupChannel(peerId, link, channel);
    this.setupPeerConnectionHandlers(peerId, pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(peerId, { kind: 'offer', sdp: pc.localDescription });
  }

  /** Host: a guest sent an offer — answer it and start trickling ICE candidates back. */
  private async acceptOfferFrom(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: PeerLink = { pc, channel: null, open: false };
    this.links.set(peerId, link);

    pc.ondatachannel = (e) => this.setupChannel(peerId, link, e.channel);
    this.setupPeerConnectionHandlers(peerId, pc);

    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignal(peerId, { kind: 'answer', sdp: pc.localDescription });
  }

  private setupPeerConnectionHandlers(peerId: string, pc: RTCPeerConnection): void {
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(peerId, { kind: 'ice-candidate', candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.links.delete(peerId);
        this.callbacks.onPeerDisconnected(peerId);
      }
    };
  }

  private setupChannel(peerId: string, link: PeerLink, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.onopen = () => {
      link.open = true;
      this.callbacks.onPeerConnected(peerId);
    };
    channel.onclose = () => {
      link.open = false;
      this.links.delete(peerId);
      this.callbacks.onPeerDisconnected(peerId);
    };
    channel.onerror = () => this.callbacks.onError(new Error('Ошибка канала передачи данных.'));
    channel.onmessage = (e) => {
      this.callbacks.onMessage(peerId, JSON.parse(e.data) as NetworkMessage);
    };
  }

  private handleSignal(msg: LanSignalMessage): void {
    if (msg.type === 'peer-left') {
      this.links.delete(msg.peerId);
      this.callbacks.onPeerDisconnected(msg.peerId);
      return;
    }
    if (msg.type !== 'signal' || !msg.from) return;
    const peerId = msg.from;
    const data = msg.data as { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

    if (data.kind === 'offer' && data.sdp) {
      // Host receiving a guest's offer (guest may connect before the host is "ready" to
      // treat this peer as known — acceptOfferFrom() registers the link regardless of role).
      this.acceptOfferFrom(peerId, data.sdp).catch((err) => this.callbacks.onError(err));
      return;
    }
    const link = this.links.get(peerId);
    if (!link) return;
    if (data.kind === 'answer' && data.sdp) {
      link.pc.setRemoteDescription(data.sdp).catch((err) => this.callbacks.onError(err));
    } else if (data.kind === 'ice-candidate' && data.candidate) {
      link.pc.addIceCandidate(data.candidate).catch(() => { /* benign if it arrives late/duplicated */ });
    }
  }

  /**
   * Send a message toward the rest of the room. On a guest, this always means "to the
   * host" (there is only one link). On the host, this relays to every connected guest
   * except `excludePeerId`, implementing the star topology.
   */
  broadcast(message: NetworkMessage, excludePeerId?: string): void {
    for (const [peerId, link] of this.links) {
      if (peerId === excludePeerId) continue;
      if (link.open && link.channel) link.channel.send(JSON.stringify(message));
    }
  }

  sendTo(peerId: string, message: NetworkMessage): void {
    const link = this.links.get(peerId);
    if (link?.open && link.channel) link.channel.send(JSON.stringify(message));
  }

  nextSeq(): number {
    return this.seqCounter++;
  }

  get myPeerId(): string | null {
    return this.selfId;
  }

  get connectedPeerIds(): string[] {
    return [...this.links.entries()].filter(([, link]) => link.open).map(([id]) => id);
  }

  disconnect(): void {
    for (const link of this.links.values()) {
      link.channel?.close();
      link.pc.close();
    }
    this.links.clear();
    this.ws?.close();
    this.ws = null;
    this.selfId = null;
    this.hostId = null;
  }
}
