import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorState } from '../state/editorState';
import type { EditorAction } from '../state/actions';
import { PeerConnectionManager, type IConnectionManager } from './peerConnection';
import { ManualPeerConnectionManager } from './manualPeerConnection';
import type { NetworkMessage, NetworkSnapshot, PresencePayload, ToolPreviewSnapshot } from './messages';
import { createNetworkDispatch, applyRemoteAction, applyRemoteCommand, type RawDispatch } from './networkDispatch';
import { getPeerColor } from './peerColors';
import { markOverlayDirty, markAllDirty } from '../rendering/dirtyFlags';
import { handleResourceRequest } from './resourceHost';
import { RemoteResourceProvider } from '../loaders/remoteResourceProvider';

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

/** Whether the public PeerJS signaling broker looks reachable right now. Checked once on
 *  mount so the UI can steer users toward the serverless manual-code flow when it's down. */
export type BrokerStatus = 'checking' | 'available' | 'unavailable';

export interface UseMultiplayerResult {
  status: RoomStatus;
  role: 'host' | 'guest' | null;
  roomId: string | null;
  peers: PeerInfo[];
  presenceByPeerId: Record<string, RemotePresence>;
  errorMessage: string | null;
  brokerStatus: BrokerStatus;
  /** Wraps the app's raw dispatch so local edits are relayed to the room. Identity dispatch when disconnected. */
  networkDispatch: RawDispatch;
  hostRoom: (nickname: string) => Promise<string>;
  joinRoom: (nickname: string, hostRoomId: string) => Promise<void>;
  leaveRoom: () => void;
  sendPresence: (cursorTileX: number | null, cursorTileY: number | null, preview: ToolPreviewSnapshot | null) => void;
  /** Serverless fallback: exchange one-shot offer/answer codes directly, no broker involved. */
  hostRoomManual: (nickname: string) => Promise<string>;
  acceptManualAnswer: (answerCode: string) => Promise<void>;
  joinRoomManual: (nickname: string, offerCode: string) => Promise<string>;
  /** For a guest with no local resource fork: pull files from the host over P2P instead. */
  createRemoteResourceProvider: (forkName: string, onResourceReady: (path: string) => void) => RemoteResourceProvider;
}

const PRESENCE_STALE_MS = 5000;
const BROKER_CHECK_TIMEOUT_MS = 4000;

/** Quick reachability probe for the PeerJS cloud broker (same host PeerJS itself talks to). */
async function checkBrokerReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROKER_CHECK_TIMEOUT_MS);
  try {
    await fetch(`https://0.peerjs.com/peerjs/id?ts=${Date.now()}`, { signal: controller.signal, mode: 'cors' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    checkBrokerReachable().then((reachable) => {
      if (!cancelled) setBrokerStatus(reachable ? 'available' : 'unavailable');
    });
    return () => { cancelled = true; };
  }, []);

  const managerRef = useRef<IConnectionManager | null>(null);
  const manualManagerRef = useRef<ManualPeerConnectionManager | null>(null);
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
  const myNameRef = useRef('Player');
  const myColorRef = useRef(getPeerColor(0));
  const nextPeerIndexRef = useRef(1); // host reserves 0 for itself
  const peerIndexByIdRef = useRef(new Map<string, number>());
  // Set only on a guest that joined without a local resource fork — routes incoming
  // resource-list-response/resource-file-response replies into the provider's cache.
  const remoteResourceProviderRef = useRef<RemoteResourceProvider | null>(null);

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
      case 'resource-list-request':
      case 'resource-file-request': {
        // Host answers using its own active ResourceProvider (whatever fork it loaded).
        if (roleRef.current === 'host') handleResourceRequest(manager, fromPeerId, message);
        break;
      }
      case 'resource-list-response':
      case 'resource-file-response': {
        // Only relevant on a guest that's using RemoteResourceProvider (joined without
        // a local fork) — feed the reply into its pending-request cache.
        remoteResourceProviderRef.current?.handleResourceMessage(message);
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
    // Dispose any manager left over from a previous attempt — otherwise its Peer keeps
    // polling the signaling broker in the background.
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
      onError: (err) => { setStatus('error'); setErrorMessage(err.message); },
    });
    managerRef.current = manager;
    const id = await manager.hostRoom();
    setRole('host');
    setRoomId(id);
    setStatus('connected');
    setPeers([{ peerId: id, peerIndex: 0, name: myNameRef.current, color: myColorRef.current }]);
    return id;
  }, [handleMessage, handlePeerDisconnected]);

  const joinRoom = useCallback(async (nickname: string, hostRoomId: string): Promise<void> => {
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
      onError: (err) => { setStatus('error'); setErrorMessage(err.message); },
    });
    managerRef.current = manager;
    await manager.joinRoom(hostRoomId);
    setRole('guest');
    setRoomId(hostRoomId);
    // status becomes 'connected' once the snapshot arrives (handleMessage's 'snapshot' case)
  }, [handleMessage, handlePeerDisconnected]);

  const leaveRoom = useCallback(() => {
    managerRef.current?.disconnect();
    managerRef.current = null;
    manualManagerRef.current = null;
    roleRef.current = null;
    setStatus('disconnected');
    setRole(null);
    setRoomId(null);
    setPeers([]);
    setPresenceByPeerId({});
    setErrorMessage(null);
  }, []);

  // --- Serverless manual signaling (offer/answer code exchange, no broker at all) ---

  /** Host step 1: produce the offer code. Connection isn't "live" yet — status stays
   *  'connecting' until acceptManualAnswer() completes the handshake. */
  const hostRoomManual = useCallback(async (nickname: string): Promise<string> => {
    managerRef.current?.disconnect();
    managerRef.current = null;

    setStatus('connecting');
    setErrorMessage(null);
    myNameRef.current = nickname || 'Player';
    myColorRef.current = getPeerColor(0);
    nextPeerIndexRef.current = 1;
    peerIndexByIdRef.current.clear();
    roleRef.current = 'host';

    const manager = new ManualPeerConnectionManager({
      onPeerConnected: () => {
        setRole('host');
        setStatus('connected');
        setPeers([{ peerId: 'manual-self', peerIndex: 0, name: myNameRef.current, color: myColorRef.current }]);
      },
      onPeerDisconnected: handlePeerDisconnected,
      onMessage: handleMessage,
      onError: (err) => { setStatus('error'); setErrorMessage(err.message); },
    });
    manualManagerRef.current = manager;
    managerRef.current = manager;
    return manager.createOffer();
  }, [handleMessage, handlePeerDisconnected]);

  /** Host step 2: apply the guest's answer code, completing the handshake. */
  const acceptManualAnswer = useCallback(async (answerCode: string): Promise<void> => {
    if (!manualManagerRef.current) throw new Error('No offer was created yet.');
    await manualManagerRef.current.acceptAnswer(answerCode);
  }, []);

  /** Guest step 1: apply the host's offer code, producing the answer code to send back. */
  const joinRoomManual = useCallback(async (nickname: string, offerCode: string): Promise<string> => {
    managerRef.current?.disconnect();
    managerRef.current = null;

    setStatus('connecting');
    setErrorMessage(null);
    myNameRef.current = nickname || 'Player';
    roleRef.current = 'guest';

    const manager = new ManualPeerConnectionManager({
      onPeerConnected: () => {
        manager.broadcast({ type: 'snapshot-request', name: myNameRef.current });
      },
      onPeerDisconnected: handlePeerDisconnected,
      onMessage: handleMessage,
      onError: (err) => { setStatus('error'); setErrorMessage(err.message); },
    });
    manualManagerRef.current = manager;
    managerRef.current = manager;
    return manager.acceptOffer(offerCode);
    // status becomes 'connected' once the snapshot arrives (handleMessage's 'snapshot' case)
  }, [handleMessage, handlePeerDisconnected]);

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

  /** For a guest with no local fork: create a ResourceProvider that pulls files from
   *  the host over the already-open P2P connection. Must be called after the DataChannel
   *  is open (i.e. after joinRoom()/joinRoomManual() resolves) but works before the map
   *  snapshot itself arrives — registry loading and snapshot loading are independent. */
  const createRemoteResourceProvider = useCallback((forkName: string, onResourceReady: (path: string) => void): RemoteResourceProvider => {
    if (!managerRef.current) throw new Error('Not connected to a room.');
    const provider = new RemoteResourceProvider(managerRef.current, forkName, onResourceReady);
    remoteResourceProviderRef.current = provider;
    return provider;
  }, []);

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
    status, role, roomId, peers, presenceByPeerId, errorMessage, brokerStatus,
    networkDispatch, hostRoom, joinRoom, leaveRoom, sendPresence,
    hostRoomManual, acceptManualAnswer, joinRoomManual, createRemoteResourceProvider,
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
