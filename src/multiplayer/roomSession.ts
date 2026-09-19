import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorState } from '../state/editorState';
import type { EditorAction } from '../state/actions';
import { PeerConnectionManager } from './peerConnection';
import type { NetworkMessage, NetworkSnapshot, PresencePayload, ToolPreviewSnapshot } from './messages';
import { createNetworkDispatch, applyRemoteAction, applyRemoteCommand, type RawDispatch } from './networkDispatch';
import { getPeerColor } from './peerColors';
import { markOverlayDirty } from '../rendering/dirtyFlags';

export interface PeerInfo {
  peerId: string;
  peerIndex: number;
  name: string;
  color: string;
}

export interface RemotePresence extends PresencePayload {
  lastSeen: number;
}

export type RoomStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseMultiplayerResult {
  status: RoomStatus;
  role: 'host' | 'guest' | null;
  roomId: string | null;
  peers: PeerInfo[];
  presenceByPeerId: Record<string, RemotePresence>;
  errorMessage: string | null;
  /** Wraps the app's raw dispatch so local edits are relayed to the room. Identity dispatch when disconnected. */
  networkDispatch: RawDispatch;
  hostRoom: (nickname: string) => Promise<string>;
  joinRoom: (nickname: string, hostRoomId: string) => Promise<void>;
  leaveRoom: () => void;
  sendPresence: (cursorTileX: number | null, cursorTileY: number | null, preview: ToolPreviewSnapshot | null) => void;
}

const PRESENCE_STALE_MS = 5000;
const CONNECT_TIMEOUT_MS = 15000;

/** Rejects if `promise` doesn't settle within `ms` — prevents the UI from being stuck on
 *  "Подключение..." forever if the signaling broker never responds and never errors. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Owns the PeerJS connection, room membership, and the star-relay logic for the host.
 * `getState`/`rawDispatch` are refs into the live App.tsx reducer so this hook doesn't
 * need to be re-created whenever `state` changes.
 */
export function useMultiplayer(getState: () => EditorState, rawDispatch: RawDispatch): UseMultiplayerResult {
  const [status, setStatus] = useState<RoomStatus>('disconnected');
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [presenceByPeerId, setPresenceByPeerId] = useState<Record<string, RemotePresence>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const managerRef = useRef<PeerConnectionManager | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const rawDispatchRef = useRef(rawDispatch);
  rawDispatchRef.current = rawDispatch;
  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  // handleMessage/handlePeerDisconnected are wired into PeerConnectionManager's callback
  // object only once, at hostRoom()/joinRoom() call time — before setRole() has actually
  // taken effect. A ref (rather than the `role` state closure) ensures they always see
  // the current role instead of whatever it was at construction time (usually still null).
  const roleRef = useRef<'host' | 'guest' | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  peersRef.current = peers;
  // Guards against overlapping hostRoom()/joinRoom() calls (e.g. a double-click that
  // slips past the UI's disabled-button check, or a caller retrying before the previous
  // attempt settled) — each duplicate call would otherwise construct its own `Peer`,
  // hammering the signaling broker with parallel /id requests.
  const connectingRef = useRef(false);
  const myNameRef = useRef('Player');
  const myColorRef = useRef(getPeerColor(0));
  const nextPeerIndexRef = useRef(1); // host reserves 0 for itself
  const peerIndexByIdRef = useRef(new Map<string, number>());

  const cleanupPresence = useCallback((peerId: string) => {
    setPresenceByPeerId(prev => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const handleMessage = useCallback((fromPeerId: string, message: NetworkMessage) => {
    const manager = managerRef.current;
    if (!manager) return;

    switch (message.type) {
      case 'action': {
        if (message.action.type === 'APPLY_COMMAND') {
          applyRemoteCommand(rawDispatchRef.current, message.action.command);
        } else {
          applyRemoteAction(rawDispatchRef.current, message.action as EditorAction);
        }
        // Host relays to everyone else in the star; a guest only ever hears this from the host already.
        if (roleRef.current === 'host') manager.broadcast(message, fromPeerId);
        break;
      }
      case 'snapshot-request': {
        if (roleRef.current !== 'host') break;
        const peerIndex = peerIndexByIdRef.current.get(fromPeerId) ?? nextPeerIndexRef.current++;
        peerIndexByIdRef.current.set(fromPeerId, peerIndex);
        const state = getStateRef.current();
        const snapshot: NetworkSnapshot = {
          grids: state.grids,
          activeGridIndex: state.activeGridIndex,
          nextEntityId: state.nextEntityId,
          assignedPeerIndex: peerIndex,
          localEntityCounter: 0,
          localGridCounter: 0,
          forkName: null,
        };
        manager.sendTo(fromPeerId, { type: 'snapshot', payload: snapshot });
        // Tell the new guest about the host itself and every already-connected peer.
        manager.sendTo(fromPeerId, {
          type: 'peer-info', peerId: manager.myPeerId!, peerIndex: 0, name: myNameRef.current, color: myColorRef.current,
        });
        for (const existingPeer of peersRef.current) {
          if (existingPeer.peerId === fromPeerId) continue;
          manager.sendTo(fromPeerId, { type: 'peer-info', ...existingPeer });
        }
        const newPeerInfo: PeerInfo = { peerId: fromPeerId, peerIndex, name: message.name || 'Player', color: getPeerColor(peerIndex) };
        setPeers(prev => [...prev.filter(p => p.peerId !== fromPeerId), newPeerInfo]);
        manager.broadcast({ type: 'peer-info', ...newPeerInfo }, fromPeerId);
        break;
      }
      case 'snapshot': {
        rawDispatchRef.current({ type: 'LOAD_REMOTE_SNAPSHOT', snapshot: message.payload });
        setStatus('connected');
        // Now that we know our assigned peerIndex, announce ourselves to the room.
        myColorRef.current = getPeerColor(message.payload.assignedPeerIndex);
        const myPeerId = managerRef.current?.myPeerId;
        if (myPeerId) {
          const myInfo: PeerInfo = {
            peerId: myPeerId, peerIndex: message.payload.assignedPeerIndex,
            name: myNameRef.current, color: myColorRef.current,
          };
          setPeers(prev => [...prev.filter(p => p.peerId !== myPeerId), myInfo]);
          managerRef.current?.broadcast({ type: 'peer-info', ...myInfo });
        }
        break;
      }
      case 'presence': {
        setPresenceByPeerId(prev => ({ ...prev, [fromPeerId]: { ...message.payload, lastSeen: Date.now() } }));
        markOverlayDirty(); // wake the canvas's dirty-flag render loop to actually draw the new position
        if (roleRef.current === 'host') manager.broadcast(message, fromPeerId);
        break;
      }
      case 'peer-info': {
        setPeers(prev => {
          const existingIdx = prev.findIndex(p => p.peerId === message.peerId);
          const info: PeerInfo = { peerId: message.peerId, peerIndex: message.peerIndex, name: message.name, color: message.color };
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = info;
            return next;
          }
          return [...prev, info];
        });
        if (roleRef.current === 'host') manager.broadcast(message, fromPeerId);
        break;
      }
      case 'peer-left': {
        setPeers(prev => prev.filter(p => p.peerId !== message.peerId));
        cleanupPresence(message.peerId);
        if (roleRef.current === 'host') manager.broadcast(message, fromPeerId);
        break;
      }
    }
  }, [cleanupPresence]);

  const handlePeerDisconnected = useCallback((peerId: string) => {
    if (roleRef.current === 'host') {
      peerIndexByIdRef.current.delete(peerId);
      setPeers(prev => prev.filter(p => p.peerId !== peerId));
      cleanupPresence(peerId);
      managerRef.current?.broadcast({ type: 'peer-left', peerId });
    } else {
      // Guest's only connection was to the host — the session is over.
      setStatus('disconnected');
      setErrorMessage('Хост отключился. Сессия завершена.');
      managerRef.current?.disconnect();
      managerRef.current = null;
      roleRef.current = null;
      setRole(null);
      setRoomId(null);
      setPeers([]);
      setPresenceByPeerId({});
    }
  }, [cleanupPresence]);

  const hostRoom = useCallback(async (nickname: string): Promise<string> => {
    if (connectingRef.current) throw new Error('A connection attempt is already in progress.');
    connectingRef.current = true;
    try {
      // Dispose any manager left over from a previous attempt (e.g. a failed connect the
      // user is retrying) — otherwise its Peer keeps polling the signaling broker in the
      // background, and repeated retries can pile up enough requests to trip rate limiting.
      managerRef.current?.disconnect();
      managerRef.current = null;

      setStatus('connecting');
      setErrorMessage(null);
      myNameRef.current = nickname || 'Player';
      myColorRef.current = getPeerColor(0);
      nextPeerIndexRef.current = 1;
      peerIndexByIdRef.current.clear();

      roleRef.current = 'host';
      const manager = new PeerConnectionManager('host', {
        onPeerConnected: () => {},
        onPeerDisconnected: handlePeerDisconnected,
        onMessage: handleMessage,
        onError: (err) => {
          setStatus('error');
          setErrorMessage(err.message);
          manager.disconnect();
          if (managerRef.current === manager) managerRef.current = null;
        },
      });
      managerRef.current = manager;
      let id: string;
      try {
        id = await withTimeout(manager.hostRoom(), CONNECT_TIMEOUT_MS, 'Не удалось создать комнату: сервер сигнализации не отвечает.');
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
        manager.disconnect();
        if (managerRef.current === manager) managerRef.current = null;
        throw err;
      }
      setRole('host');
      setRoomId(id);
      setStatus('connected');
      setPeers([{ peerId: id, peerIndex: 0, name: myNameRef.current, color: myColorRef.current }]);
      return id;
    } finally {
      connectingRef.current = false;
    }
  }, [handleMessage, handlePeerDisconnected]);

  const joinRoom = useCallback(async (nickname: string, hostRoomId: string): Promise<void> => {
    if (connectingRef.current) throw new Error('A connection attempt is already in progress.');
    connectingRef.current = true;
    try {
      managerRef.current?.disconnect();
      managerRef.current = null;

      setStatus('connecting');
      setErrorMessage(null);
      myNameRef.current = nickname || 'Player';
      roleRef.current = 'guest';

      const manager = new PeerConnectionManager('guest', {
        onPeerConnected: () => {
          manager.broadcast({ type: 'snapshot-request', name: myNameRef.current });
        },
        onPeerDisconnected: handlePeerDisconnected,
        onMessage: handleMessage,
        onError: (err) => {
          setStatus('error');
          setErrorMessage(err.message);
          manager.disconnect();
          if (managerRef.current === manager) managerRef.current = null;
        },
      });
      managerRef.current = manager;
      try {
        await withTimeout(manager.joinRoom(hostRoomId), CONNECT_TIMEOUT_MS, 'Не удалось подключиться: хост не отвечает.');
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
        manager.disconnect();
        if (managerRef.current === manager) managerRef.current = null;
        throw err;
      }
      setRole('guest');
      setRoomId(hostRoomId);
      // status becomes 'connected' once the snapshot arrives (handleMessage's 'snapshot' case).
      // Guard against the DataChannel opening but the host never replying with a snapshot
      // (e.g. the host's own state got into a bad spot) — without this, status would be
      // stuck on 'connecting' forever with no way for the user to tell or retry.
      setTimeout(() => {
        if (managerRef.current === manager && statusRef.current === 'connecting') {
          setStatus('error');
          setErrorMessage('Хост не прислал карту. Попробуйте подключиться снова.');
          manager.disconnect();
          if (managerRef.current === manager) managerRef.current = null;
        }
      }, CONNECT_TIMEOUT_MS);
    } finally {
      connectingRef.current = false;
    }
  }, [handleMessage, handlePeerDisconnected]);

  const leaveRoom = useCallback(() => {
    managerRef.current?.disconnect();
    managerRef.current = null;
    roleRef.current = null;
    setStatus('disconnected');
    setRole(null);
    setRoomId(null);
    setPeers([]);
    setPresenceByPeerId({});
    setErrorMessage(null);
  }, []);

  const sendPresence = useCallback((cursorTileX: number | null, cursorTileY: number | null, preview: ToolPreviewSnapshot | null) => {
    const manager = managerRef.current;
    if (!manager || status !== 'connected') return;
    const payload: PresencePayload = {
      peerId: manager.myPeerId ?? '',
      peerIndex: role === 'host' ? 0 : (peerIndexByIdRef.current.get(manager.myPeerId ?? '') ?? 0),
      name: myNameRef.current,
      color: myColorRef.current,
      cursorTileX, cursorTileY, preview,
    };
    manager.broadcast({ type: 'presence', payload });
  }, [status, role]);

  const networkDispatch = useCallback((action: EditorAction) => {
    if (status !== 'connected' || !managerRef.current) {
      rawDispatchRef.current(action);
      return;
    }
    const wrapped = createNetworkDispatch(rawDispatchRef.current, (networkedAction) => {
      managerRef.current!.broadcast({ type: 'action', action: networkedAction, seq: managerRef.current!.nextSeq() });
    });
    wrapped(action);
  }, [status]);

  // Periodically drop presence entries for peers that stopped sending updates without
  // a clean disconnect event (e.g. the tab was killed rather than closed normally).
  useEffect(() => {
    const interval = setInterval(() => {
      setPresenceByPeerId(prev => {
        const next = pruneStalePresence(prev, Date.now());
        if (next !== prev) markOverlayDirty();
        return next;
      });
    }, PRESENCE_STALE_MS / 2);
    return () => clearInterval(interval);
  }, []);

  return {
    status, role, roomId, peers, presenceByPeerId, errorMessage,
    networkDispatch, hostRoom, joinRoom, leaveRoom, sendPresence,
  };
}

/** Drop presence entries that haven't been refreshed recently (peer likely gone without a clean disconnect). */
export function pruneStalePresence(presenceByPeerId: Record<string, RemotePresence>, now: number): Record<string, RemotePresence> {
  let changed = false;
  const next: Record<string, RemotePresence> = {};
  for (const [peerId, presence] of Object.entries(presenceByPeerId)) {
    if (now - presence.lastSeen <= PRESENCE_STALE_MS) {
      next[peerId] = presence;
    } else {
      changed = true;
    }
  }
  return changed ? next : presenceByPeerId;
}
