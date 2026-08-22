import React, { useRef, useState, useEffect, useCallback } from 'react';

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
                  {item.checked !== undefined ? (item.checked ? '\u2713' : '') : ''}
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
    if (dirty && !window.confirm('Несохранённые изменения будут потеряны. Продолжить?')) return;
    onNewMap();
  };

  const openMenuFn = useCallback((name: string) => setOpenMenu(name), []);
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const fileItems: MenuItem[] = [
    { label: 'Новая карта', shortcut: 'Ctrl+N', action: handleNewMap },
    { label: 'separator', separator: true },
    { label: 'Импорт .yml...', shortcut: 'Ctrl+O', action: handleImportClick },
    { label: 'Экспорт .yml', shortcut: 'Ctrl+S', action: onExport },
  ];

  const editItems: MenuItem[] = [
    { label: 'Отменить', shortcut: 'Ctrl+Z', action: onUndo, disabled: !canUndo },
    { label: 'Повторить', shortcut: 'Ctrl+Y', action: onRedo, disabled: !canRedo },
  ];

  const viewItems: MenuItem[] = [
    { label: 'Показать сетку', action: onToggleGrid, checked: showGrid },
    { label: 'Показать сущности', action: onToggleEntities, checked: showEntities },
    { label: 'Фон космоса', action: onToggleSpaceBackground, checked: showSpaceBackground },
    { label: 'Предпросмотр освещения', action: onToggleLighting, checked: showLighting },
    { label: 'separator', separator: true },
    { label: 'HUD производительности', action: onTogglePerfHUD, checked: showPerfHUD },
    { label: 'Инструмент бенчмарка', action: onToggleBenchmark, checked: showBenchmark },
    { label: 'separator', separator: true },
    { label: 'Управление', shortcut: '?', action: onShowShortcuts },
  ];

  const menus: { name: string; items: MenuItem[] }[] = [
    { name: 'Файл', items: fileItems },
    { name: 'Правка', items: editItems },
    { name: 'Вид', items: viewItems },
  ];

  return (
    <div ref={barRef} className="flex items-center h-9 bg-surface border-b border-subtle px-2 gap-1">
      <span className="text-[13px] font-bold text-accent mr-3">
        SS14 Map Editor
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
            title="\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0444\u043E\u0440\u043A"
          >
            <span className="text-[10px]">{'\uD83D\uDCC1'}</span>
            <span>{forkName}</span>
          </button>
          {showForkMenu && (
            <div className="absolute left-0 top-full mt-1 bg-elevated border border-subtle rounded shadow-lg z-50 py-1 min-w-[160px]">
              <button
                onClick={() => { setShowForkMenu(false); onSwitchFork?.(); }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-primary hover:bg-hover cursor-pointer bg-transparent border-none"
              >
                \u0421\u043C\u0435\u043D\u0438\u0442\u044C \u0444\u043E\u0440\u043A...
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {dirty && (
        <span className="text-warning text-[10px]">\u0415\u0441\u0442\u044C \u043D\u0435\u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F</span>
      )}

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

const SHORTCUT_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: '\u0412\u044b\u0431\u043e\u0440 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430',
    rows: [
      ['B', '\u041a\u0438\u0441\u0442\u044c'],
      ['E', '\u041b\u0430\u0441\u0442\u0438\u043a'],
      ['I', '\u041f\u0438\u043f\u0435\u0442\u043a\u0430'],
      ['H', '\u0420\u0443\u043a\u0430'],
      ['G', '\u0417\u0430\u043b\u0438\u0432\u043a\u0430'],
      ['R', '\u041f\u0440\u044f\u043c\u043e\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a'],
      ['L', '\u041b\u0438\u043d\u0438\u044f'],
      ['C', '\u041a\u0440\u0443\u0433'],
      ['S', '\u0412\u044b\u0431\u043e\u0440 (\u0442\u0430\u0439\u043b\u044b + \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0438)'],
      ['V', '\u0412\u044b\u0431\u043e\u0440 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0438'],
      ['P', '\u0420\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0438'],
      ['K', '\u0420\u0438\u0441\u043e\u0432\u0430\u043d\u0438\u0435 \u043a\u0430\u0431\u0435\u043b\u0435\u0439'],
      ['J', '\u0420\u0438\u0441\u043e\u0432\u0430\u043d\u0438\u0435 \u0442\u0440\u0443\u0431'],
      ['D', '\u0421\u0432\u044f\u0437\u044c \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432'],
    ],
  },
  {
    title: '\u041e\u0431\u0449\u0435\u0435',
    rows: [
      ['Ctrl+Z', '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c'],
      ['Ctrl+Y / Ctrl+Shift+Z', '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c'],
      ['Ctrl+N', '\u041d\u043e\u0432\u0430\u044f \u043a\u0430\u0440\u0442\u0430'],
      ['Ctrl+O', '\u0418\u043c\u043f\u043e\u0440\u0442 .yml'],
      ['Ctrl+S', '\u042d\u043a\u0441\u043f\u043e\u0440\u0442 .yml'],
      ['Ctrl+F', '\u041f\u043e\u0438\u0441\u043a \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0435\u0439 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435'],
      ['Space (\u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435)', '\u0420\u0435\u0436\u0438\u043c \u043f\u0430\u043d\u043e\u0440\u0430\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f'],
      ['Escape', '\u041e\u0442\u043c\u0435\u043d\u0430 / \u0437\u0430\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e'],
      ['?', '\u042d\u0442\u043e \u043e\u043a\u043d\u043e'],
    ],
  },
  {
    title: '\u0411\u0443\u0444\u0435\u0440 \u043e\u0431\u043c\u0435\u043d\u0430 (\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 "\u0412\u044b\u0431\u043e\u0440")',
    rows: [
      ['Ctrl+C', '\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c'],
      ['Ctrl+X', '\u0412\u044b\u0440\u0435\u0437\u0430\u0442\u044c'],
      ['Ctrl+V', '\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c'],
      ['Delete / Backspace', '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u044b\u0434\u0435\u043b\u0435\u043d\u043d\u043e\u0435'],
    ],
  },
  {
    title: '\u041f\u043e\u0432\u043e\u0440\u043e\u0442 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0438',
    rows: [
      ['R', '\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u043f\u043e \u0447\u0430\u0441\u043e\u0432\u043e\u0439 (90\u00b0)'],
      ['Shift+R', '\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u043f\u0440\u043e\u0442\u0438\u0432 \u0447\u0430\u0441\u043e\u0432\u043e\u0439 (90\u00b0)'],
    ],
  },
  {
    title: '\u041c\u044b\u0448\u044c',
    rows: [
      ['\u041f\u0440\u043e\u043a\u0440\u0443\u0442\u043a\u0430', '\u041f\u0440\u0438\u0431\u043b\u0438\u0436\u0435\u043d\u0438\u0435 / \u043e\u0442\u0434\u0430\u043b\u0435\u043d\u0438\u0435'],
      ['\u041f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u043d\u0438\u0435 \u0421\u041a\u041c', '\u041f\u0430\u043d\u043e\u0440\u0430\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435'],
      ['\u041a\u043b\u0438\u043a + \u043f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u043d\u0438\u0435', '\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442'],
      ['Shift + \u043a\u043b\u0438\u043a', '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u043e\u0435 \u0440\u0430\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435 / \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0432\u044b\u0431\u043e\u0440\u0430'],
      ['Shift + \u043f\u0435\u0440\u0435\u0442\u0430\u0441\u043a\u0438\u0432\u0430\u043d\u0438\u0435', '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u043e\u0435 \u043f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0438 (\u0434\u0440\u043e\u0431\u043d\u043e\u0435)'],
      ['\u041f\u041a\u041c', '\u0421\u043d\u044f\u0442\u044c \u0432\u044b\u0434\u0435\u043b\u0435\u043d\u0438\u0435 / \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u043d\u043e\u0435 \u043c\u0435\u043d\u044e / \u0441\u0442\u0435\u0440\u0435\u0442\u044c'],
      ['\u041f\u0440\u043e\u043a\u0440\u0443\u0442\u043a\u0430 \u043d\u0430 \u0441\u0442\u043e\u043f\u043a\u0435 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0435\u0439', '\u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043f\u0435\u0440\u0435\u043a\u0440\u044b\u0432\u0430\u044e\u0449\u0438\u0445\u0441\u044f \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u0435\u0439'],
    ],
  },
];

const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
          <h2 className="text-base font-semibold text-accent m-0">Управление</h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {SHORTCUT_SECTIONS.map((section) => (
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
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
