/**
 * Wire protocol for the standalone LAN signaling server (see scripts/lan-signal-server.mjs).
 * The server is a dumb relay: it assigns each connecting WebSocket a peerId, and forwards
 * 'signal' messages between specific peerIds by id. It never inspects the payload (SDP/ICE
 * candidates), so this type is shared between the browser code and (informally) the server.
 */

export type LanSignalMessage =
  /** Server -> client, sent once right after the WebSocket opens. */
  | { type: 'welcome'; peerId: string }
  /** Server -> host: a new guest's WebSocket connected to the relay. */
  | { type: 'peer-joined'; peerId: string }
  /** Server -> host/guest: a peer's WebSocket disconnected from the relay. */
  | { type: 'peer-left'; peerId: string }
  /** Client -> server -> client: opaque SDP offer/answer/ICE-candidate payload, addressed
   *  by target peerId. The server only reads `to` to route it; `data` is opaque JSON. */
  | { type: 'signal'; to: string; from?: string; data: unknown };
