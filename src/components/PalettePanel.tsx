import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { PaletteItem } from '../types';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import type { PrefabData } from '../prefab/prefabTypes';
import { TilePalette } from './TilePalette';
import { EntityPalette } from './EntityPalette';
import { DecalPalette } from './DecalPalette';
import type { DecalPlacementSettings } from './DecalPalette';
import { PrefabPanel } from './PrefabPanel';
import type { PrefabPanelHandle } from './PrefabPanel';
import { useT } from '../i18n';

interface Props {
  registry: IPrototypeRegistry | null;
  selectedItem: PaletteItem | null;
  onSelect: (item: PaletteItem) => void;
  onSelectPrefab?: (prefab: PrefabData) => void;
  decalPlacementSettingsRef?: React.MutableRefObject<DecalPlacementSettings>;
}

type Tab = 'tiles' | 'entities' | 'decals' | 'prefabs';

/** Imperative handle so callers outside the panel (e.g. canvas drag & drop) can
 *  register a dropped prefab, switching to the Prefabs tab so it's visible. */
export interface PalettePanelHandle {
  addAndSelectDroppedPrefab: (data: PrefabData, filename: string) => void;
}

export const PalettePanel = forwardRef<PalettePanelHandle, Props>(({ registry, selectedItem, onSelect, onSelectPrefab, decalPlacementSettingsRef }, ref) => {
  const [activeTab, setActiveTab] = useState<Tab>('tiles');
  const { t } = useT();
  const prefabPanelRef = useRef<PrefabPanelHandle>(null);

  useImperativeHandle(ref, () => ({
    addAndSelectDroppedPrefab: (data, filename) => {
      setActiveTab('prefabs');
      // PrefabPanel mounts on the next render (tab switch above); defer registration
      // one tick so the ref is attached before we call into it.
      setTimeout(() => prefabPanelRef.current?.addAndSelectPrefab(data, filename), 0);
    },
  }), []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex border-b border-subtle bg-surface">
        <TabButton label={t('palettePanel.tabs.tiles')} active={activeTab === 'tiles'} onClick={() => setActiveTab('tiles')} />
        <TabButton label={t('palettePanel.tabs.entities')} active={activeTab === 'entities'} onClick={() => setActiveTab('entities')} />
        <TabButton label={t('palettePanel.tabs.decals')} active={activeTab === 'decals'} onClick={() => setActiveTab('decals')} />
        <TabButton label={t('palettePanel.tabs.prefabs')} active={activeTab === 'prefabs'} onClick={() => setActiveTab('prefabs')} />
      </div>

      {activeTab === 'tiles' ? (
        <TilePalette registry={registry} selectedItem={selectedItem} onSelect={onSelect} />
      ) : activeTab === 'entities' ? (
        <EntityPalette registry={registry} selectedItem={selectedItem} onSelect={onSelect} />
      ) : activeTab === 'decals' ? (
        decalPlacementSettingsRef && (
          <DecalPalette
            registry={registry}
            selectedItem={selectedItem}
            onSelect={onSelect}
            placementSettingsRef={decalPlacementSettingsRef}
          />
        )
      ) : (
        onSelectPrefab && <PrefabPanel ref={prefabPanelRef} onSelectPrefab={onSelectPrefab} />
      )}
    </div>
  );
});

PalettePanel.displayName = 'PalettePanel';

const TabButton: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 py-1.5 text-[11px] cursor-pointer border-none border-b-2
                ${active
                  ? 'bg-active text-white font-bold border-accent'
                  : 'bg-surface text-muted font-normal border-transparent hover:text-primary'}`}
  >
    {label}
  </button>
);
