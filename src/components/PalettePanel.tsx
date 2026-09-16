import React, { useState, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // dragenter/dragleave fire in pairs as the cursor crosses child element boundaries (e.g.
  // moving over a row in the prefab list), not just when truly entering/leaving this panel.
  // A plain boolean toggled by each event flickers the overlay off between those pairs;
  // a depth counter (only hiding at 0, same pattern as App.tsx's page-level drop overlay)
  // stays stable across nested enter/leave churn.
  const dragDepthRef = useRef(0);
  const { t } = useT();
  const prefabPanelRef = useRef<PrefabPanelHandle>(null);

  // PrefabPanel stays mounted at all times (see render below), so its ref is always
  // attached — no need to defer these calls until after a tab-switch remount.
  const addAndSelectDroppedPrefab = useCallback((data: PrefabData, filename: string) => {
    setActiveTab('prefabs');
    prefabPanelRef.current?.addAndSelectPrefab(data, filename);
  }, []);

  /** Switch to the Prefabs tab and hand raw dropped file text to PrefabPanel, which parses
   *  it (as .prefab.json or a whole map .yml/.yaml) and shows a visible error if that fails,
   *  instead of a silent no-op. */
  const handleDroppedFileContent = useCallback((content: string, filename: string) => {
    setActiveTab('prefabs');
    prefabPanelRef.current?.handleDroppedFile(content, filename);
  }, []);

  useImperativeHandle(ref, () => ({
    addAndSelectDroppedPrefab,
  }), [addAndSelectDroppedPrefab]);

  // Dropping a file onto this panel (entities/prefabs/etc.) saves it as a prefab instead of
  // replacing the current map, unlike dropping onto the canvas — this lets a whole exported
  // station .yml or a .prefab.json be turned into a stampable prefab without leaving the map.
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handlePanelDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingOver(true);
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingOver(false);
  }, []);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    file.text().then(content => handleDroppedFileContent(content, file.name));
  }, [handleDroppedFileContent]);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragEnter={handlePanelDragEnter}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      {isDraggingOver && (
        // pointer-events: none — this is a purely visual indicator. Native dragover/drop
        // already bubble up through the DOM to this panel's own handlers below regardless of
        // which descendant (e.g. a prefab list row) is directly under the cursor, so making
        // this overlay itself interactive isn't needed and previously caused rapid
        // dragenter/dragleave flicker as the cursor crossed the overlay's own boundary.
        <div
          className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: 'rgba(30, 100, 220, 0.35)' }}
        >
          <div className="text-sm font-bold text-white text-center px-3" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
            {t('palettePanel.dropAsPrefab')}
          </div>
        </div>
      )}
      <div className="flex border-b border-subtle bg-surface">
        <TabButton label={t('palettePanel.tabs.tiles')} active={activeTab === 'tiles'} onClick={() => setActiveTab('tiles')} />
        <TabButton label={t('palettePanel.tabs.entities')} active={activeTab === 'entities'} onClick={() => setActiveTab('entities')} />
        <TabButton label={t('palettePanel.tabs.decals')} active={activeTab === 'decals'} onClick={() => setActiveTab('decals')} />
        <TabButton label={t('palettePanel.tabs.prefabs')} active={activeTab === 'prefabs'} onClick={() => setActiveTab('prefabs')} />
      </div>

      {/* All tab contents stay mounted at all times (visibility toggled via CSS) instead of
          being conditionally rendered, so switching tabs never discards their state — this
          matters most for PrefabPanel, whose locally-imported/dropped prefab list previously
          reset every time the Prefabs tab was left and re-entered. */}
      <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'tiles' ? '' : 'hidden'}`}>
        <TilePalette registry={registry} selectedItem={selectedItem} onSelect={onSelect} />
      </div>
      <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'entities' ? '' : 'hidden'}`}>
        <EntityPalette registry={registry} selectedItem={selectedItem} onSelect={onSelect} />
      </div>
      {decalPlacementSettingsRef && (
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'decals' ? '' : 'hidden'}`}>
          <DecalPalette
            registry={registry}
            selectedItem={selectedItem}
            onSelect={onSelect}
            placementSettingsRef={decalPlacementSettingsRef}
          />
        </div>
      )}
      {onSelectPrefab && (
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'prefabs' ? '' : 'hidden'}`}>
          <PrefabPanel ref={prefabPanelRef} onSelectPrefab={onSelectPrefab} />
        </div>
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
