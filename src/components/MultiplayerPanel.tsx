import React, { useState } from 'react';
import { useT } from '../i18n';
import { withBase } from '../basePath';
import type { UseMultiplayerResult } from '../multiplayer/roomSession';

interface Props {
  multiplayer: UseMultiplayerResult;
}

export const MultiplayerPanel: React.FC<Props> = ({ multiplayer }) => {
  const { t } = useT();
  const { status, role, roomId, peers, errorMessage, hostRoom, joinRoom, leaveRoom } = multiplayer;
  const [nickname, setNickname] = useState('');
  const [joinTarget, setJoinTarget] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') ?? '';
  });
  const [linkCopied, setLinkCopied] = useState(false);

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
              className="bg-elevated border border-subtle rounded-sm text-primary text-[11px] px-1.5 py-1"
            />
          </label>

          <button
            onClick={handleHost}
            disabled={isBusy}
            className="bg-accent text-white border-none rounded-sm text-[11px] cursor-pointer px-2 py-1 hover:opacity-90 disabled:opacity-50"
          >
            {t('multiplayer.hostRoom')}
          </button>

          <div className="flex gap-1">
            <input
              type="text"
              value={joinTarget}
              onChange={(e) => setJoinTarget(e.target.value)}
              placeholder={t('multiplayer.roomIdPlaceholder')}
              className="flex-1 bg-elevated border border-subtle rounded-sm text-primary text-[11px] px-1.5 py-1 min-w-0"
            />
            <button
              onClick={handleJoin}
              disabled={isBusy || !joinTarget.trim()}
              className="bg-accent text-white border-none rounded-sm text-[11px] cursor-pointer px-2 py-1 hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {t('multiplayer.joinRoom')}
            </button>
          </div>

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
          {role === 'host' && (
            <button
              onClick={copyInviteLink}
              className="bg-accent text-white border-none rounded-sm text-[11px] cursor-pointer px-2 py-1 hover:opacity-90"
            >
              {linkCopied ? t('multiplayer.linkCopied') : t('multiplayer.copyLink')}
            </button>
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

          <button
            onClick={leaveRoom}
            className="bg-elevated border border-subtle rounded-sm text-primary text-[11px] cursor-pointer px-2 py-1 hover:bg-hover"
          >
            {t('multiplayer.leaveRoom')}
          </button>
        </>
      )}
    </div>
  );
};
