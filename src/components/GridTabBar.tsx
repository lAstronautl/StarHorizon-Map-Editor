import React, { useState, useRef, useEffect } from 'react';
import type { GridData } from '../state/gridData';
import { EntitySearchBar } from './EntitySearchBar';
import { MultiplayerPanel } from './MultiplayerPanel';
import type { UseMultiplayerResult } from '../multiplayer/roomSession';
import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import { useT } from '../i18n';

interface Props {
  grids: GridData[];
  activeGridIndex: number;
  onSelectGrid: (index: number) => void;
  onAddGrid: () => void;
  onDeleteGrid: (gridUid: number) => void;
  onRenameGrid: (gridUid: number, newName: string) => void;
  onFocusGrid: (index: number) => void;
  entities: ImportedEntity[];
  registry: IPrototypeRegistry | null;
  onSearchNavigate: (entity: ImportedEntity) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onValidate?: () => void;
  multiplayer: UseMultiplayerResult;
  onToggleAiChat?: () => void;
}

export const GridTabBar: React.FC<Props> = ({
  grids, activeGridIndex, onSelectGrid, onAddGrid, onDeleteGrid, onRenameGrid, onFocusGrid,
  entities, registry, onSearchNavigate, searchInputRef, onValidate, multiplayer, onToggleAiChat,
}) => {
  const { t } = useT();
  const [mpOpen, setMpOpen] = useState(false);
  const mpContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mpOpen) return;
    const handler = (e: MouseEvent) => {
      if (mpContainerRef.current && !mpContainerRef.current.contains(e.target as Node)) {
        setMpOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [mpOpen]);

  const mpButtonLabel = multiplayer.status === 'connected'
    ? t('multiplayer.playerCount', { count: multiplayer.peers.length })
    : t('multiplayer.buttonLabel');
  return (
    <div className="flex items-end bg-panel border-b border-subtle shrink-0">
      <div className="flex items-end overflow-x-auto min-w-0">
        {grids.map((gd, idx) => {
          const isActive = idx === activeGridIndex;
          return (
            <div
              key={gd.gridUid}
              data-active={isActive ? 'true' : 'false'}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer select-none border-r border-subtle whitespace-nowrap
                ${isActive
                  ? 'bg-surface text-primary border-b-2 border-b-accent'
                  : 'bg-panel text-muted hover:text-primary hover:bg-hover'
                }`}
              onClick={() => onSelectGrid(idx)}
              onDoubleClick={() => {
                const name = prompt(t('gridTabBar.renameGridPrompt'), gd.name);
                if (name && name !== gd.name) onRenameGrid(gd.gridUid, name);
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && grids.length > 1) {
                  e.preventDefault();
                  onDeleteGrid(gd.gridUid);
                }
              }}
            >
              <span>{gd.name}</span>
              <span className="text-muted text-[10px]">({gd.gridUid})</span>
              {grids.length > 1 && (
                <button
                  className="ml-1 text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('gridTabBar.closeGrid')}
                  onClick={(e) => { e.stopPropagation(); onDeleteGrid(gd.gridUid); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          className="px-2 py-1.5 text-xs text-muted hover:text-primary hover:bg-hover"
          title={t('gridTabBar.addNewGrid')}
          onClick={onAddGrid}
        >
          +
        </button>
      </div>

      <div className="flex-1" />

      <div ref={mpContainerRef} className="relative self-center mr-2 shrink-0">
        <button
          onClick={() => setMpOpen(o => !o)}
          className={`relative flex items-center gap-1 text-white cursor-pointer border-none rounded-sm text-[11px] px-2 py-0.5 hover:brightness-110
            ${multiplayer.status === 'connected' ? 'bg-accent' : 'bg-elevated text-primary border border-subtle'}`}
          title={multiplayer.brokerStatus === 'unavailable' ? t('multiplayer.brokerUnavailable') : t('multiplayer.buttonLabel')}
        >
          <span>{mpButtonLabel}</span>
          {multiplayer.status !== 'connected' && multiplayer.brokerStatus === 'unavailable' && (
            <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
          )}
        </button>
        {mpOpen && (
          <div className="absolute top-full right-0 mt-0.5 w-[240px] bg-elevated border border-subtle rounded-sm shadow-lg z-50">
            <MultiplayerPanel multiplayer={multiplayer} />
          </div>
        )}
      </div>

      <button
        onClick={onValidate}
        className="flex items-center gap-1 self-center text-white bg-warning hover:brightness-110 cursor-pointer border-none rounded-sm text-[11px] px-2 py-0.5 mr-2 shrink-0"
        title={t('gridTabBar.validateMap')}
      >
        <span>{t('gridTabBar.validateMap')}</span>
      </button>

      <button
        onClick={onToggleAiChat}
        className="flex items-center gap-1 self-center text-white bg-active hover:brightness-125 cursor-pointer border border-subtle rounded-sm text-[11px] px-2 py-0.5 mr-2 shrink-0"
        title={t('gridTabBar.aiAssistant')}
      >
        <span>{t('gridTabBar.aiAssistant')}</span>
      </button>

      <div className="pr-2 py-0.5 shrink-0">
        <EntitySearchBar
          entities={entities}
          registry={registry}
          onNavigate={onSearchNavigate}
          searchInputRef={searchInputRef}
        />
      </div>
    </div>
  );
};
