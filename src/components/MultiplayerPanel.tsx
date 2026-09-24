import React, { useState } from 'react';
import { useT } from '../i18n';
import { withBase } from '../basePath';
import type { UseMultiplayerResult } from '../multiplayer/roomSession';

interface Props {
  multiplayer: UseMultiplayerResult;
}

type ConnectMode = 'server' | 'lan';

const DEFAULT_LAN_PORT = '5140';

export const MultiplayerPanel: React.FC<Props> = ({ multiplayer }) => {
  const { t } = useT();
  const {
    status, role, roomId, peers, errorMessage, brokerStatus,
    hostRoom, joinRoom, leaveRoom, hostRoomLan, joinRoomLan,
  } = multiplayer;
  const [nickname, setNickname] = useState('');
  const [joinTarget, setJoinTarget] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') ?? '';
  });
  const [linkCopied, setLinkCopied] = useState(false);

  const [mode, setMode] = useState<ConnectMode>('server');
  const [lanPort, setLanPort] = useState(DEFAULT_LAN_PORT);
  const [lanJoinAddress, setLanJoinAddress] = useState('');

  const isBusy = status === 'connecting';
  const isJoined = status === 'connected';
  const showJoinForm = status === 'disconnected' || status === 'error' || status === 'connecting';

  const handleHost = () => {
    hostRoom(nickname).catch(() => {});
  };

  const handleJoin = () => {
    // Accept either a bare room ID or a full invite link containing ?room=<id>.
    let target = joinTarget.trim();
    try {
      const url = new URL(target);
      target = url.searchParams.get('room') ?? target;
    } catch {
      // Not a URL, treat as a raw room ID.
    }
    if (target) joinRoom(nickname, target).catch(() => {});
  };

  const copyInviteLink = () => {
    if (!roomId) return;
    const link = `${window.location.origin}${withBase('/')}?room=${roomId}`;
    navigator.clipboard?.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {});
  };

  const handleLanHost = () => {
    const port = lanPort.trim() || DEFAULT_LAN_PORT;
    hostRoomLan(nickname, `ws://localhost:${port}`).catch(() => {});
  };

  const handleLanJoin = () => {
    const target = lanJoinAddress.trim();
    if (!target) return;
    // Accept "ip:port" or "ip" (falls back to the default port).
    const hasPort = /:\d+$/.test(target);
    const relayUrl = `ws://${hasPort ? target : `${target}:${DEFAULT_LAN_PORT}`}`;
    joinRoomLan(nickname, relayUrl).catch(() => {});
  };

  const inputClass = "bg-elevated border border-subtle rounded-sm text-primary text-[11px] px-1.5 py-1";
  const primaryButtonClass = "bg-accent text-white border-none rounded-sm text-[11px] cursor-pointer px-2 py-1 hover:opacity-90 disabled:opacity-50";
  const secondaryButtonClass = "bg-elevated border border-subtle rounded-sm text-primary text-[11px] cursor-pointer px-2 py-1 hover:bg-hover";

  return (
    <div className="p-3 flex flex-col gap-2 text-xs">
      {showJoinForm && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-primary">{t('multiplayer.nickname')}</span>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('multiplayer.nicknamePlaceholder')}
              maxLength={24}
              className={inputClass}
            />
          </label>

          {brokerStatus === 'checking' && (
            <span className="text-[11px] text-muted">{t('multiplayer.brokerChecking')}</span>
          )}
          {brokerStatus === 'unavailable' && mode === 'server' && (
            <span className="text-[11px] text-warning">{t('multiplayer.brokerUnavailable')}</span>
          )}

          <div className="flex gap-1 bg-panel rounded-sm p-0.5">
            <button
              onClick={() => setMode('server')}
              className={`flex-1 text-[10px] px-2 py-1 rounded-sm cursor-pointer border-none ${mode === 'server' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
            >
              {t('multiplayer.modeServer')}
            </button>
            <button
              onClick={() => setMode('lan')}
              className={`flex-1 text-[10px] px-2 py-1 rounded-sm cursor-pointer border-none ${mode === 'lan' ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}
            >
              {t('multiplayer.modeLan')}
            </button>
          </div>

          {mode === 'server' && (
            <>
              <button onClick={handleHost} disabled={isBusy} className={primaryButtonClass}>
                {t('multiplayer.hostRoom')}
              </button>

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
                  className={`${primaryButtonClass} whitespace-nowrap`}
                >
                  {t('multiplayer.joinRoom')}
                </button>
              </div>
            </>
          )}

          {mode === 'lan' && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-muted leading-relaxed">{t('multiplayer.lanHint')}</p>

              <span className="text-[10px] text-muted">{t('multiplayer.lanHostLabel')}</span>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={lanPort}
                  onChange={(e) => setLanPort(e.target.value)}
                  placeholder={DEFAULT_LAN_PORT}
                  className={`w-16 ${inputClass}`}
                />
                <button onClick={handleLanHost} disabled={isBusy} className={`${primaryButtonClass} flex-1`}>
                  {t('multiplayer.hostRoom')}
                </button>
              </div>

              <div className="h-px bg-subtle my-1" />

              <span className="text-[10px] text-muted">{t('multiplayer.lanJoinLabel')}</span>
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
                  className={`${primaryButtonClass} whitespace-nowrap`}
                >
                  {t('multiplayer.joinRoom')}
                </button>
              </div>
            </div>
          )}

          {status === 'connecting' && (
            <span className="text-[11px] text-muted">{t('multiplayer.connecting')}</span>
          )}
          {errorMessage && (
            <span className="text-[11px] text-red-400">{errorMessage}</span>
          )}
        </>
      )}

      {isJoined && (
        <>
          {role === 'host' && roomId && mode !== 'lan' && (
            <button onClick={copyInviteLink} className={primaryButtonClass}>
              {linkCopied ? t('multiplayer.linkCopied') : t('multiplayer.copyLink')}
            </button>
          )}
          {role === 'host' && mode === 'lan' && (
            <p className="text-[10px] text-muted leading-relaxed">{t('multiplayer.lanHostedHint')}</p>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{t('multiplayer.peers')}</span>
            {peers.map((peer) => (
              <div key={peer.peerId} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: peer.color }}
                />
                <span className="text-[11px] text-primary truncate">
                  {peer.name}
                  {peer.peerIndex === 0 && <span className="text-muted"> ({t('multiplayer.host')})</span>}
                </span>
              </div>
            ))}
          </div>

          <button onClick={leaveRoom} className={secondaryButtonClass}>
            {t('multiplayer.leaveRoom')}
          </button>
        </>
      )}
    </div>
  );
};
