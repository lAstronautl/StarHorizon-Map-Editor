import React, { useState, useEffect, useRef } from 'react';
import { useT } from '../i18n';
import type { UseMultiplayerResult } from '../multiplayer/roomSession';

interface Props {
  multiplayer: UseMultiplayerResult;
  /** Fires once when the P2P connection to the host reaches 'connected' (i.e. right
   *  after the map snapshot has loaded — see roomSession.ts's 'snapshot' handler,
   *  which is what actually flips status to 'connected' for a guest). */
  onJoined: () => void;
}

type ConnectMode = 'server' | 'lan';

const DEFAULT_LAN_PORT = '5140';

/**
 * Main-menu entry point for joining someone else's session without a local resource
 * fork at all — textures/prototypes are pulled from the host over the P2P connection
 * instead (see RemoteResourceProvider). This is a guest-only join flow (no "host a room"
 * button here — hosting requires already having a fork loaded, which only happens after
 * ForkSelector's other buttons have run).
 */
export const JoinRoomSection: React.FC<Props> = ({ multiplayer, onJoined }) => {
  const { t } = useT();
  const { status, errorMessage, brokerStatus, joinRoom, joinRoomLan } = multiplayer;
  const [nickname, setNickname] = useState('');
  const [joinTarget, setJoinTarget] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') ?? '';
  });
  const [mode, setMode] = useState<ConnectMode>('server');
  const [lanJoinAddress, setLanJoinAddress] = useState('');

  const isBusy = status === 'connecting';
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;
  const firedRef = useRef(false);

  useEffect(() => {
    if (status === 'connected' && !firedRef.current) {
      firedRef.current = true;
      onJoinedRef.current();
    }
    if (status !== 'connected') firedRef.current = false;
  }, [status]);

  const handleJoin = () => {
    let target = joinTarget.trim();
    try {
      const url = new URL(target);
      target = url.searchParams.get('room') ?? target;
    } catch {
      // Not a URL, treat as a raw room ID.
    }
    if (target) joinRoom(nickname, target).catch(() => {});
  };

  const handleLanJoin = () => {
    const target = lanJoinAddress.trim();
    if (!target) return;
    const hasPort = /:\d+$/.test(target);
    const relayUrl = `ws://${hasPort ? target : `${target}:${DEFAULT_LAN_PORT}`}`;
    joinRoomLan(nickname, relayUrl).catch(() => {});
  };

  const inputClass = "bg-elevated border border-subtle rounded-sm text-primary text-xs px-2 py-1.5 w-full";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted text-center">{t('forkSelector.joinSectionHint')}</p>

      <input
        type="text"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder={t('multiplayer.nicknamePlaceholder')}
        maxLength={24}
        className={inputClass}
      />

      {brokerStatus === 'unavailable' && mode === 'server' && (
        <span className="text-xs text-warning">{t('multiplayer.brokerUnavailable')}</span>
      )}

      <div className="flex gap-1 bg-panel rounded-sm p-0.5">
        <button
          onClick={() => setMode('server')}
          className={`flex-1 text-xs px-2 py-1 rounded-sm cursor-pointer border-none ${mode === 'server' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
        >
          {t('multiplayer.modeServer')}
        </button>
        <button
          onClick={() => setMode('lan')}
          className={`flex-1 text-xs px-2 py-1 rounded-sm cursor-pointer border-none ${mode === 'lan' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
        >
          {t('multiplayer.modeLan')}
        </button>
      </div>

      {mode === 'server' && (
        <div className="flex gap-1">
          <input
            type="text"
            value={joinTarget}
            onChange={(e) => setJoinTarget(e.target.value)}
            placeholder={t('multiplayer.roomIdPlaceholder')}
            className={`flex-1 min-w-0 ${inputClass}`}
          />
          <button
            onClick={handleJoin}
            disabled={isBusy || !joinTarget.trim()}
            className="py-1.5 px-3 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 cursor-pointer border-none disabled:opacity-50 whitespace-nowrap"
          >
            {t('multiplayer.joinRoom')}
          </button>
        </div>
      )}

      {mode === 'lan' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted leading-relaxed">{t('multiplayer.lanJoinLabel')}</p>
          <div className="flex gap-1">
            <input
              type="text"
              value={lanJoinAddress}
              onChange={(e) => setLanJoinAddress(e.target.value)}
              placeholder={t('multiplayer.lanAddressPlaceholder')}
              className={`flex-1 min-w-0 ${inputClass}`}
            />
            <button
              onClick={handleLanJoin}
              disabled={isBusy || !lanJoinAddress.trim()}
              className="py-1.5 px-3 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 cursor-pointer border-none disabled:opacity-50 whitespace-nowrap"
            >
              {t('multiplayer.joinRoom')}
            </button>
          </div>
        </div>
      )}

      {status === 'connecting' && (
        <span className="text-xs text-muted text-center">{t('multiplayer.connecting')}</span>
      )}
      {errorMessage && (
        <span className="text-xs text-red-400 text-center">{errorMessage}</span>
      )}
    </div>
  );
};
