import Peer, { type DataConnection } from 'peerjs';
import type { NetworkMessage } from './messages';

export type ConnectionRole = 'host' | 'guest';

/**
 * STUN alone (PeerJS's own default) is enough for most home/office networks, but two
 * players behind strict/symmetric NATs (common on corporate networks or some mobile
 * carriers) can't establish a direct WebRTC path with STUN and need a TURN relay to
 * fall back to. Open Relay Project is a free public TURN service — traffic that falls
 * back to it is relayed through their server rather than being fully P2P, but it's
 * still not infrastructure we host ourselves.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:global.relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export interface PeerConnectionCallbacks {
  /** A peer's DataChannel finished connecting (host: a guest joined; guest: connected to host). */
  onPeerConnected: (peerId: string) => void;
  /** A peer's DataChannel closed/dropped. */
  onPeerDisconnected: (peerId: string) => void;
  /** A message arrived, already de-duplicated to "logically from this peerId". */
  onMessage: (fromPeerId: string, message: NetworkMessage) => void;
  /** The underlying PeerJS Peer object hit a fatal error (e.g. broker unreachable). */
  onError: (error: Error) => void;
}

/**
 * Thin wrapper over PeerJS implementing a star topology: the host holds one
 * DataConnection per guest and is the sole relay point; a guest holds exactly
 * one DataConnection, to the host. This is the only module that imports `peerjs`.
 *
 * Signaling (SDP/ICE exchange) goes through PeerJS's free public cloud broker;
 * actual messages flow peer-to-peer over WebRTC DataChannels once connected.
 */
export class PeerConnectionManager {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private role: ConnectionRole;
  private callbacks: PeerConnectionCallbacks;
  private seqCounter = 0;

  constructor(role: ConnectionRole, callbacks: PeerConnectionCallbacks) {
    this.role = role;
    this.callbacks = callbacks;
  }

  /** Start as host: register with the broker under a fresh/given room ID and await guests. */
  hostRoom(roomId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options = { config: { iceServers: ICE_SERVERS } };
      this.peer = roomId ? new Peer(roomId, options) : new Peer(options);
      this.peer.on('open', (id) => resolve(id));
      this.peer.on('error', (err) => {
        this.callbacks.onError(err);
        reject(err);
      });
      this.peer.on('connection', (conn) => this.registerConnection(conn));
    });
  }

  /** Start as guest: register with the broker, then connect to the given host room ID. */
  joinRoom(hostRoomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.peer = new Peer({ config: { iceServers: ICE_SERVERS } });
      this.peer.on('error', (err) => {
        this.callbacks.onError(err);
        reject(err);
      });
      this.peer.on('open', () => {
        const conn = this.peer!.connect(hostRoomId, { reliable: true });
        conn.on('open', () => {
          this.registerConnection(conn);
          resolve();
        });
        conn.on('error', (err) => {
          this.callbacks.onError(err);
          reject(err);
        });
      });
    });
  }

  private registerConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn);
    conn.on('data', (data) => {
      this.callbacks.onMessage(conn.peer, data as NetworkMessage);
    });
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.callbacks.onPeerDisconnected(conn.peer);
    });
    conn.on('error', (err) => this.callbacks.onError(err));
    if (conn.open) {
      this.callbacks.onPeerConnected(conn.peer);
    } else {
      conn.on('open', () => this.callbacks.onPeerConnected(conn.peer));
    }
  }

  /**
   * Send a message toward the rest of the room. On a guest, this always means
   * "to the host" (there is only one connection). On the host, this relays to
   * every connected guest except `excludePeerId` (the one that sent it, if any),
   * implementing the star topology.
   */
  broadcast(message: NetworkMessage, excludePeerId?: string): void {
    for (const [peerId, conn] of this.connections) {
      if (peerId === excludePeerId) continue;
      if (conn.open) conn.send(message);
    }
  }

  /** Send a message to one specific peer (e.g. a snapshot reply to the requester). */
  sendTo(peerId: string, message: NetworkMessage): void {
    const conn = this.connections.get(peerId);
    if (conn?.open) conn.send(message);
  }

  /** Host-only: assign the next monotonic sequence number for a relayed command. */
  nextSeq(): number {
    return this.seqCounter++;
  }

  get myPeerId(): string | null {
    return this.peer?.id ?? null;
  }

  get connectedPeerIds(): string[] {
    return [...this.connections.keys()];
  }

  disconnect(): void {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
