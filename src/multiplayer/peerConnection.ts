import Peer, { type DataConnection } from 'peerjs';
import type { NetworkMessage } from './messages';

export type ConnectionRole = 'host' | 'guest';

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
 * Shared shape between PeerConnectionManager (PeerJS broker signaling) and
 * LanPeerConnectionManager (local WebSocket relay signaling) — roomSession.ts
 * talks to whichever transport is active through this interface only.
 */
export interface IConnectionManager {
  broadcast(message: NetworkMessage, excludePeerId?: string): void;
  sendTo(peerId: string, message: NetworkMessage): void;
  nextSeq(): number;
  readonly myPeerId: string | null;
  readonly connectedPeerIds: string[];
  disconnect(): void;
}

/**
 * Thin wrapper over PeerJS implementing a star topology: the host holds one
 * DataConnection per guest and is the sole relay point; a guest holds exactly
 * one DataConnection, to the host. This is the only module that imports `peerjs`.
 *
 * Signaling (SDP/ICE exchange) goes through PeerJS's free public cloud broker;
 * actual messages flow peer-to-peer over WebRTC DataChannels once connected.
 */
export class PeerConnectionManager implements IConnectionManager {
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
      this.peer = roomId ? new Peer(roomId) : new Peer();
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
      this.peer = new Peer();
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
