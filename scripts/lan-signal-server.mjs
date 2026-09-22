#!/usr/bin/env node
/**
 * Standalone LAN signaling relay for StarHorizon Map Editor's multiplayer.
 *
 * Run this on the HOST's machine before creating a room in "LAN" mode in the editor.
 * It does NOT carry any map data — it only relays WebRTC signaling messages (SDP offer/
 * answer, ICE candidates) between the host's and guests' browser tabs so they can find
 * each other over a local network (works great over Hamachi/Radmin/plain LAN, where the
 * public PeerJS broker is either unreachable or unnecessary). Once WebRTC negotiation
 * completes, the actual map data flows directly peer-to-peer; this process is no longer
 * involved.
 *
 * Usage:
 *   node scripts/lan-signal-server.mjs [port]
 *
 * Then in the editor's Multiplayer panel, pick the "LAN" tab:
 *   - Host: click "Start hosting" — it connects to ws://localhost:<port> automatically.
 *   - Guest: enter the host's LAN/Hamachi/Radmin IP and the port, e.g. 25.10.20.30:5140.
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const port = Number(process.argv[2]) || 5140;

const wss = new WebSocketServer({ port });
/** @type {Map<string, import('ws').WebSocket>} */
const peers = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  const peerId = randomUUID();

  // Tell the newcomer about every already-connected peer (e.g. the guest learning the
  // host's peerId so it can initiate an offer), BEFORE adding the newcomer to `peers` —
  // otherwise this loop would also send the newcomer a 'peer-joined' about itself.
  for (const [otherId] of peers) {
    send(ws, { type: 'peer-joined', peerId: otherId });
  }

  peers.set(peerId, ws);
  send(ws, { type: 'welcome', peerId });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'signal' && typeof msg.to === 'string') {
      const target = peers.get(msg.to);
      if (target) send(target, { type: 'signal', from: peerId, data: msg.data });
    }
  });

  ws.on('close', () => {
    peers.delete(peerId);
    for (const other of peers.values()) send(other, { type: 'peer-left', peerId });
  });

  // Tell every already-connected peer about the newcomer (the editor's host side
  // decides what to do with this — e.g. wait for the guest to send an offer).
  for (const [otherId, other] of peers) {
    if (otherId === peerId) continue;
    send(other, { type: 'peer-joined', peerId });
  }
});

function localIPs() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(`${net.address} (${name})`);
    }
  }
  return addrs;
}

console.log(`LAN signaling relay listening on port ${port}.`);
console.log('Give guests one of these addresses (whichever is on your Hamachi/Radmin/LAN network):');
for (const addr of localIPs()) console.log(`  ${addr}`);
console.log('\nLeave this window open while the multiplayer session is active. Ctrl+C to stop.');
