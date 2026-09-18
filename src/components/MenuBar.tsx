import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useT, setLocale } from '../i18n';

interface Props {
  onNewMap: () => void;
  onImport: (content: string) => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  showGrid: boolean;
  onToggleGrid: () => void;
  showEntities: boolean;
  onToggleEntities: () => void;
  showSpaceBackground: boolean;
  onToggleSpaceBackground: () => void;
  showLighting: boolean;
  onToggleLighting: () => void;
  showPerfHUD: boolean;
  onTogglePerfHUD: () => void;
  showBenchmark: boolean;
  onToggleBenchmark: () => void;
  showShortcuts: boolean;
  onShowShortcuts: () => void;
  onCloseShortcuts: () => void;
  forkName?: string;
  onSwitchFork?: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

const MenuDropdown: React.FC<{
  label: string;
  items: MenuItem[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  hoverOpen: boolean;
  onHoverOpen: () => void;
}> = ({ label, items, isOpen, onOpen, onClose, hoverOpen, onHoverOpen }) => {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="relative">
      <button
        className={`px-3 py-1 text-xs text-primary cursor-pointer hover:bg-hover rounded-sm border-none h-full ${
          isOpen ? 'bg-active' : 'bg-transparent'
        }`}
        onClick={() => isOpen ? onClose() : onOpen()}
        onMouseEnter={() => { if (hoverOpen) onHoverOpen(); }}
      >
        {label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 min-w-[160px] bg-elevated border border-subtle rounded-sm shadow-lg z-50 py-1">
          {items.map((item, i) => {
            if (item.separator) {
              return <div key={i} className="h-px bg-subtle mx-2 my-1" />;
            }
            return (
              <button
                key={i}
                disabled={item.disabled}
                onClick={() => {
                  item.action?.();
                  onClose();
                }}
                className={`flex w-full px-3 py-1.5 text-xs text-left items-center gap-2 border-none bg-transparent ${
                  item.disabled
                    ? 'text-muted cursor-default hover:bg-transparent'
                    : 'text-primary cursor-pointer hover:bg-hover'
                }`}
              >
                <span className="w-[18px] text-center text-[11px]">
                  {item.checked !== undefined ? (item.checked ? '✓' : '') : ''}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-muted ml-4 text-[10px]">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MenuBar: React.FC<Props> = ({
  onNewMap, onImport, onExport, onUndo, onRedo, canUndo, canRedo, dirty,
  showGrid, onToggleGrid, showEntities, onToggleEntities,
  showSpaceBackground, onToggleSpaceBackground,
  showLighting, onToggleLighting,
  showPerfHUD, onTogglePerfHUD,
  showBenchmark, onToggleBenchmark,
  showShortcuts, onShowShortcuts, onCloseShortcuts,
  forkName, onSwitchFork,
}) => {
  const { t, locale } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showForkMenu, setShowForkMenu] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const forkMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // Close fork menu when clicking outside
  useEffect(() => {
    if (!showForkMenu) return;
    const handler = (e: MouseEvent) => {
      if (forkMenuRef.current && !forkMenuRef.current.contains(e.target as Node)) {
        setShowForkMenu(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showForkMenu]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(onImport);
    e.target.value = '';
  };

  const handleNewMap = () => {
    if (dirty && !window.confirm(t('menuBar.confirmUnsavedNewMap'))) return;
    onNewMap();
  };

  const openMenuFn = useCallback((name: string) => setOpenMenu(name), []);
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const fileItems: MenuItem[] = [
    { label: t('menuBar.file.newMap'), shortcut: 'Ctrl+N', action: handleNewMap },
    { label: 'separator', separator: true },
    { label: t('menuBar.file.import'), shortcut: 'Ctrl+O', action: handleImportClick },
    { label: t('menuBar.file.export'), shortcut: 'Ctrl+S', action: onExport },
  ];

  const editItems: MenuItem[] = [
    { label: t('menuBar.edit.undo'), shortcut: 'Ctrl+Z', action: onUndo, disabled: !canUndo },
    { label: t('menuBar.edit.redo'), shortcut: 'Ctrl+Y', action: onRedo, disabled: !canRedo },
  ];

  const viewItems: MenuItem[] = [
    { label: t('menuBar.view.showGrid'), action: onToggleGrid, checked: showGrid },
    { label: t('menuBar.view.showEntities'), action: onToggleEntities, checked: showEntities },
    { label: t('menuBar.view.spaceBackground'), action: onToggleSpaceBackground, checked: showSpaceBackground },
    { label: t('menuBar.view.lightingPreview'), action: onToggleLighting, checked: showLighting },
    { label: 'separator', separator: true },
    { label: t('menuBar.view.perfHud'), action: onTogglePerfHUD, checked: showPerfHUD },
    { label: t('menuBar.view.benchmarkTool'), action: onToggleBenchmark, checked: showBenchmark },
    { label: 'separator', separator: true },
    { label: t('menuBar.view.controls'), shortcut: '?', action: onShowShortcuts },
  ];

  const menus: { name: string; items: MenuItem[] }[] = [
    { name: t('menuBar.menu.file'), items: fileItems },
    { name: t('menuBar.menu.edit'), items: editItems },
    { name: t('menuBar.menu.view'), items: viewItems },
  ];

  return (
    <div ref={barRef} className="flex items-center h-9 bg-surface border-b border-subtle px-2 gap-1">
      <span className="text-[13px] font-bold text-accent mr-3">
        {t('menuBar.title')}
      </span>

      {menus.map(menu => (
        <MenuDropdown
          key={menu.name}
          label={menu.name}
          items={menu.items}
          isOpen={openMenu === menu.name}
          onOpen={() => openMenuFn(menu.name)}
          onClose={closeMenu}
          hoverOpen={openMenu !== null}
          onHoverOpen={() => openMenuFn(menu.name)}
        />
      ))}

      {forkName && (
        <div className="relative ml-2" ref={forkMenuRef}>
          <button
            onClick={() => setShowForkMenu(!showForkMenu)}
            className="flex items-center gap-1.5 text-[11px] text-muted hover:text-primary cursor-pointer bg-transparent border border-subtle rounded-sm px-2 py-0.5"
            title={t('menuBar.activeFork')}
          >
            <span className="text-[10px]">{'📁'}</span>
            <span>{forkName}</span>
          </button>
          {showForkMenu && (
            <div className="absolute left-0 top-full mt-1 bg-elevated border border-subtle rounded shadow-lg z-50 py-1 min-w-[160px]">
              <button
                onClick={() => { setShowForkMenu(false); onSwitchFork?.(); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-primary hover:bg-hover cursor-pointer bg-transparent border-none"
              >
                {t('menuBar.switchFork')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {dirty && (
        <span className="text-warning text-[10px] mr-2">{t('menuBar.unsavedChanges')}</span>
      )}

      <button
        onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
        className="text-[11px] text-muted hover:text-primary cursor-pointer bg-transparent border border-subtle rounded-sm px-2 py-0.5 mr-1"
        title="Language / Язык"
      >
        {locale === 'ru' ? 'RU' : 'EN'}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {showShortcuts && <ShortcutsModal onClose={onCloseShortcuts} />}
    </div>
  );
};

/* ── Shortcuts Modal ─────────────────────────────────────── */

function useShortcutSections(): { title: string; rows: [string, string][] }[] {
  const { t } = useT();
  return [
    {
      title: t('menuBar.shortcuts.toolSelection'),
      rows: [
        ['B', t('menuBar.shortcuts.paint')],
        ['E', t('menuBar.shortcuts.erase')],
        ['I', t('menuBar.shortcuts.eyedropper')],
        ['H', t('menuBar.shortcuts.pan')],
        ['G', t('menuBar.shortcuts.fill')],
        ['R', t('menuBar.shortcuts.rectangle')],
        ['L', t('menuBar.shortcuts.line')],
        ['C', t('menuBar.shortcuts.circle')],
        ['S', t('menuBar.shortcuts.selectTilesEntities')],
        ['V', t('menuBar.shortcuts.entitySelect')],
        ['K', t('menuBar.shortcuts.cableDraw')],
        ['J', t('menuBar.shortcuts.pipeDraw')],
        ['D', t('menuBar.shortcuts.deviceLink')],
      ],
    },
    {
      title: t('menuBar.shortcuts.general'),
      rows: [
        ['Ctrl+Z', t('menuBar.shortcuts.undo')],
        ['Ctrl+Y / Ctrl+Shift+Z', t('menuBar.shortcuts.redo')],
        ['Ctrl+N', t('menuBar.shortcuts.newMap')],
        ['Ctrl+O', t('menuBar.shortcuts.importYml')],
        ['Ctrl+S', t('menuBar.shortcuts.exportYml')],
        ['Ctrl+F', t('menuBar.shortcuts.searchEntities')],
        [t('menuBar.shortcuts.panModeKey'), t('menuBar.shortcuts.panMode')],
        ['Escape', t('menuBar.shortcuts.cancelClose')],
        ['?', t('menuBar.shortcuts.thisDialog')],
      ],
    },
    {
      title: t('menuBar.shortcuts.clipboard'),
      rows: [
        ['Ctrl+C', t('menuBar.shortcuts.copy')],
        ['Ctrl+X', t('menuBar.shortcuts.cut')],
        ['Ctrl+V', t('menuBar.shortcuts.paste')],
        [t('menuBar.shortcuts.deleteSelectionKey'), t('menuBar.shortcuts.deleteSelection')],
      ],
    },
    {
      title: t('menuBar.shortcuts.entityRotation'),
      rows: [
        ['R', t('menuBar.shortcuts.rotateCw')],
        ['Shift+R', t('menuBar.shortcuts.rotateCcw')],
      ],
    },
    {
      title: t('menuBar.shortcuts.mouse'),
      rows: [
        [t('menuBar.shortcuts.scrollKey'), t('menuBar.shortcuts.zoomInOut')],
        [t('menuBar.shortcuts.middleDragKey'), t('menuBar.shortcuts.panAction')],
        [t('menuBar.shortcuts.clickDragKey'), t('menuBar.shortcuts.useActiveTool')],
        [t('menuBar.shortcuts.shiftClickKey'), t('menuBar.shortcuts.freePlacementToggle')],
        [t('menuBar.shortcuts.shiftDragKey'), t('menuBar.shortcuts.freeMoveEntity')],
        [t('menuBar.shortcuts.rightClickKey'), t('menuBar.shortcuts.deselectContextErase')],
        [t('menuBar.shortcuts.scrollOnStackKey'), t('menuBar.shortcuts.cycleOverlapping')],
      ],
    },
  ];
}

const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useT();
  const sections = useShortcutSections();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-elevated border border-subtle rounded-lg p-6 max-w-[560px] w-full max-h-[80vh] overflow-y-auto text-primary text-[13px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-accent m-0">{t('menuBar.view.controls')}</h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {sections.map((section) => (
          <div key={section.title} className="mb-4">
            <h3 className="text-[11px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
              {section.title}
            </h3>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              {section.rows.map(([key, desc]) => (
                <React.Fragment key={key + desc}>
                  <kbd className="text-accent font-mono text-[12px] text-right whitespace-nowrap">{key}</kbd>
                  <span className="text-primary">{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}

        <div className="text-center mt-4">
          <button
            onClick={onClose}
            className="bg-active border border-subtle rounded text-primary text-[13px] px-6 py-2 cursor-pointer hover:bg-hover"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
