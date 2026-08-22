import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import type { TileGrid } from '../types';
import { getComponentEditor } from './componentEditors';
import { autoLinkDeviceList } from '../algorithms/autoLink';
import { ContainerContentsEditor, isContainerEntity } from './ContainerContentsEditor';
import { LightEditor, hasPointLight } from './LightEditor';
import { getAvailableStates } from '../loaders/spriteStateHelper';
import { loadSprite } from '../loaders/rsiLoader';
import { useT } from '../i18n';

interface Props {
  entities: ImportedEntity[];
  allEntities?: ImportedEntity[];
  registry: IPrototypeRegistry | null;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onDelete: () => void;
  onDeselect: () => void;
  onUpdateEntity?: (entity: ImportedEntity) => void;
  containedEntities?: Record<number, ImportedEntity[]>;
  onAddContainedEntity?: (parentUid: number, prototypeId: string) => void;
  onRemoveContainedEntity?: (parentUid: number, entityUid: number) => void;
  grid?: TileGrid;
}

export const EntityInfoPanel: React.FC<Props> = ({
  entities, allEntities, registry, onRotateCW, onRotateCCW, onDelete, onDeselect, onUpdateEntity,
  containedEntities, onAddContainedEntity, onRemoveContainedEntity, grid,
}) => {
  const { t } = useT();
  const [showComponents, setShowComponents] = useState(true);
  const [addingComponent, setAddingComponent] = useState(false);
  const [newCompType, setNewCompType] = useState('');
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  if (entities.length === 0) return null;

  // Multi-select summary
  if (entities.length > 1) {
    return (
      <div className="p-3 text-xs">
        <div className="flex justify-between items-center mb-1.5">
          <span className="font-bold text-xs">{t('entityInfoPanel.multi.selected', { count: entities.length })}</span>
          <button onClick={onDeselect} className="bg-transparent border-none text-muted text-[16px] cursor-pointer px-1 leading-none" title={t('entityInfoPanel.multi.deselectAll')}>&times;</button>
        </div>

        <div className="text-muted text-[10px] mb-1.5">
          {summarizePrototypes(entities, t)}
        </div>

        <div className="flex gap-1 mt-2">
          <ActionButton label="&#x21B6;" onClick={onRotateCCW} title={t('entityInfoPanel.multi.rotateAllCcw')} />
          <ActionButton label="&#x21B7;" onClick={onRotateCW} title={t('entityInfoPanel.multi.rotateAllCw')} />
          <ActionButton label={t('entityInfoPanel.multi.deleteAll')} onClick={onDelete} color="#c44" />
        </div>
      </div>
    );
  }

  // Single entity detail view
  const entity = entities[0];
  const resolved = registry?.getEntity(entity.prototype);
  const name = resolved?.name ?? entity.prototype;
  const category = resolved?.sourceCategory ?? t('entityInfoPanel.unknown');
  const description = resolved?.description ?? '';
  const suffix = resolved?.suffix ?? '';

  const rotDeg = Math.round((entity.rotation * 180) / Math.PI);

  const handleComponentChange = (index: number, updated: Record<string, unknown>) => {
    if (!onUpdateEntity) return;
    const newComponents = entity.components.map((c, i) =>
      i === index ? updated : c,
    );
    onUpdateEntity({ ...entity, components: newComponents });
  };

  const handleRemoveComponent = (index: number) => {
    if (!onUpdateEntity) return;
    const newComponents = entity.components.filter((_, i) => i !== index);
    onUpdateEntity({ ...entity, components: newComponents });
  };

  const handleAddComponent = () => {
    if (!onUpdateEntity || !newCompType.trim()) return;
    const newComp: Record<string, unknown> = { type: newCompType.trim() };
    onUpdateEntity({ ...entity, components: [...entity.components, newComp] });
    setNewCompType('');
    setAddingComponent(false);
  };

  return (
    <div className="p-3 text-xs">
      <div className="flex justify-between items-center mb-1.5">
        <span className="font-bold text-xs">{t('entityInfoPanel.title')}</span>
        <button onClick={onDeselect} className="bg-transparent border-none text-muted text-[16px] cursor-pointer px-1 leading-none" title={t('entityInfoPanel.deselect')}>&times;</button>
      </div>

      <InfoRow label={t('entityInfoPanel.name')} value={suffix ? `${name} (${String(suffix)})` : name} />
      <InfoRow label={t('entityInfoPanel.prototype')} value={entity.prototype} />
      <InfoRow label="UID" value={String(entity.uid)} />
      <InfoRow label={t('entityInfoPanel.position')} value={`${entity.position.x.toFixed(1)}, ${entity.position.y.toFixed(1)}`} />
      <InfoRow label={t('entityInfoPanel.rotation')} value={`${rotDeg}°`} />

      {onUpdateEntity && registry && (
        <SpriteStateSelector
          entity={entity}
          registry={registry}
          onUpdateEntity={onUpdateEntity}
        />
      )}

      <InfoRow label={t('entityInfoPanel.category')} value={category} />
      {description && (
        <div className="text-muted text-[10px] mt-1 italic">
          {description}
        </div>
      )}

      <div className="flex gap-1 mt-2">
        <ActionButton label="&#x21B6;" onClick={onRotateCCW} title={t('entityInfoPanel.rotateCcw')} />
        <ActionButton label="&#x21B7;" onClick={onRotateCW} title={t('entityInfoPanel.rotateCw')} />
        <ActionButton label={t('entityInfoPanel.delete')} onClick={onDelete} color="#c44" />
      </div>

      {onAddContainedEntity && onRemoveContainedEntity && (
        isContainerEntity(entity, registry) || (containedEntities?.[entity.uid]?.length ?? 0) > 0
      ) && (
        <ContainerContentsEditor
          entity={entity}
          containedEntities={containedEntities?.[entity.uid] ?? []}
          registry={registry}
          onAdd={onAddContainedEntity}
          onRemove={onRemoveContainedEntity}
        />
      )}

      {onUpdateEntity && hasPointLight(entity, registry) && (
        <LightEditor
          entity={entity}
          registry={registry}
          onUpdateEntity={onUpdateEntity}
        />
      )}

      {onUpdateEntity && allEntities && grid && registry && hasDeviceList(entity) && (
        <div className="mt-1.5">
          <button
            onClick={() => {
              const result = autoLinkDeviceList(entity, allEntities, grid, registry);
              if (result) {
                onUpdateEntity(result.updatedEntity);
                setLinkMessage(t('entityInfoPanel.linkedDevices', { count: result.linkedCount }));
                setTimeout(() => setLinkMessage(null), 2500);
              } else {
                setLinkMessage(t('entityInfoPanel.noNewDevicesFound'));
                setTimeout(() => setLinkMessage(null), 2000);
              }
            }}
            className="w-full px-1.5 py-1 rounded-sm text-[10px] cursor-pointer border"
            style={{ backgroundColor: '#1a3e1a', borderColor: '#2a5a2a', color: '#b0e0b0' }}
          >
            {t('entityInfoPanel.autoLinkRoom')}
          </button>
          {linkMessage && (
            <div className="text-success text-[9px] mt-0.5">{linkMessage}</div>
          )}
        </div>
      )}

      <div className="mt-2">
        <button
          onClick={() => setShowComponents(!showComponents)}
          className="bg-transparent border-none text-[#aaa] text-[10px] cursor-pointer p-0"
        >
          {showComponents ? '▾' : '▸'} {t('entityInfoPanel.componentsCount', { count: entity.components.length })}
        </button>
        {showComponents && (
          <div className="mt-1 max-h-[300px] overflow-auto">
            {entity.components.map((comp, i) => {
              const compType = (comp as Record<string, unknown>).type as string;
              return (
                <EditableComponentRow
                  key={`${entity.uid}-${i}-${compType}`}
                  comp={comp}
                  compType={compType}
                  allEntities={allEntities ?? entities}
                  onChange={(updated) => handleComponentChange(i, updated)}
                  onRemove={() => handleRemoveComponent(i)}
                  editable={!!onUpdateEntity}
                />
              );
            })}
            {onUpdateEntity && (
              <div className="mt-1">
                {addingComponent ? (
                  <div className="flex gap-0.5 items-center">
                    <input
                      type="text"
                      value={newCompType}
                      onChange={(e) => setNewCompType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddComponent();
                        if (e.key === 'Escape') { setAddingComponent(false); setNewCompType(''); }
                      }}
                      placeholder="ComponentType"
                      className="bg-elevated border border-subtle rounded-sm text-primary text-[10px] px-1 py-0.5 flex-1"
                      autoFocus
                    />
                    <button onClick={handleAddComponent} className="bg-active border border-subtle rounded-sm text-primary text-[10px] px-1.5 py-px cursor-pointer">+</button>
                    <button
                      onClick={() => { setAddingComponent(false); setNewCompType(''); }}
                      className="bg-active border border-subtle rounded-sm text-muted text-[10px] px-1.5 py-px cursor-pointer"
                    >
                      x
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingComponent(true)}
                    className="bg-transparent border border-dashed border-subtle rounded-sm text-[#666] text-[9px] cursor-pointer px-1.5 py-0.5 w-full"
                  >
                    + {t('entityInfoPanel.addComponent')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Summarize the prototypes in a multi-selection. */
function summarizePrototypes(entities: ImportedEntity[], t: (key: string, vars?: Record<string, string | number>) => string): string {
  const counts = new Map<string, number>();
  for (const e of entities) {
    counts.set(e.prototype, (counts.get(e.prototype) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = sorted.slice(0, 3).map(([proto, count]) => `${proto} x${count}`);
  if (sorted.length > 3) top3.push(t('entityInfoPanel.moreTypes', { count: sorted.length - 3 }));
  return top3.join(', ');
}

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between py-px">
    <span className="text-muted">{label}:</span>
    <span className="text-primary max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-right" title={value}>{value}</span>
  </div>
);

const ActionButton: React.FC<{ label: string; onClick: () => void; color?: string; title?: string }> = ({ label, onClick, color, title }) => (
  <button
    onClick={onClick}
    title={title}
    className={`flex-1 px-1.5 py-1 rounded-sm border border-subtle text-primary text-[10px] cursor-pointer hover:brightness-110 ${color ? '' : 'bg-elevated hover:bg-hover'}`}
    style={color ? { backgroundColor: color } : undefined}
  >
    {label}
  </button>
);

interface EditableComponentRowProps {
  comp: Record<string, unknown>;
  compType: string;
  allEntities: ImportedEntity[];
  onChange: (updated: Record<string, unknown>) => void;
  onRemove: () => void;
  editable: boolean;
}

const EditableComponentRow: React.FC<EditableComponentRowProps> = ({
  comp, compType, allEntities, onChange, onRemove, editable,
}) => {
  const { t } = useT();
  const [expanded, setExpanded] = useState(true);
  const fieldCount = Object.keys(comp).length - 1; // exclude 'type'

  const Editor = getComponentEditor(compType);

  const handleEditorChange = useCallback((updated: Record<string, unknown>) => {
    // Deep clone to avoid mutating undo stack objects
    const cloned = JSON.parse(JSON.stringify(updated));
    onChange(cloned);
  }, [onChange]);

  return (
    <div className="border-b border-surface py-0.5">
      <div className="flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="bg-transparent border-none text-[#aaa] text-[10px] cursor-pointer p-0 flex-1 text-left"
        >
          {expanded ? '▾' : '▸'} {compType} <span className="text-[#666]">({fieldCount})</span>
        </button>
        {editable && (
          <button
            onClick={onRemove}
            className="bg-transparent border-none text-danger text-[10px] cursor-pointer px-1 leading-none"
            title={t('entityInfoPanel.removeComponent', { compType })}
          >
            x
          </button>
        )}
      </div>
      {expanded && editable && (
        <div className="my-0.5 ml-3">
          <Editor
            component={comp}
            onChange={handleEditorChange}
            allEntities={allEntities}
          />
        </div>
      )}
      {expanded && !editable && (
        <pre className="text-[9px] text-[#999] my-0.5 ml-3 whitespace-pre-wrap break-all max-h-[100px] overflow-auto">
          {JSON.stringify(comp, null, 2)}
        </pre>
      )}
    </div>
  );
};

// ---- Sprite State Selector ----

interface SpriteStateSelectorProps {
  entity: ImportedEntity;
  registry: IPrototypeRegistry;
  onUpdateEntity: (entity: ImportedEntity) => void;
}

const SpriteStateSelector: React.FC<SpriteStateSelectorProps> = ({ entity, registry, onUpdateEntity }) => {
  const { t } = useT();
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load available states when prototype changes
  useEffect(() => {
    let cancelled = false;
    setAvailableStates([]);
    setThumbnails(new Map());
    setDropdownOpen(false);

    getAvailableStates(entity.prototype, registry).then((states) => {
      if (!cancelled) setAvailableStates(states);
    });

    return () => { cancelled = true; };
  }, [entity.prototype, registry]);

  // Load thumbnails when states are loaded
  useEffect(() => {
    if (availableStates.length <= 1) return;

    let cancelled = false;
    const spriteInfo = registry.getSpriteInfo(entity.prototype);
    if (!spriteInfo) return;

    const thumbMap = new Map<string, string>();

    const loadAll = async () => {
      await Promise.all(availableStates.map(async (stateName) => {
        if (cancelled) return;
        try {
          const drawInfo = await loadSprite(spriteInfo, 'south', 0, stateName);
          if (drawInfo && !cancelled) {
            const canvas = document.createElement('canvas');
            canvas.width = 24;
            canvas.height = 24;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(
                drawInfo.image,
                drawInfo.sx, drawInfo.sy, drawInfo.sw, drawInfo.sh,
                0, 0, 24, 24,
              );
              thumbMap.set(stateName, canvas.toDataURL());
            }
          }
        } catch {
          // Skip failed thumbnails
        }
      }));
      if (!cancelled) setThumbnails(new Map(thumbMap));
    };

    loadAll();
    return () => { cancelled = true; };
  }, [availableStates, entity.prototype, registry]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Don't render if only 0 or 1 state
  if (availableStates.length <= 1) return null;

  const currentState = entity.spriteStateOverride ?? t('entityInfoPanel.default');

  const handleSelect = (state: string | undefined) => {
    onUpdateEntity({ ...entity, spriteStateOverride: state });
    setDropdownOpen(false);
  };

  return (
    <div className="py-0.5 relative" ref={dropdownRef}>
      <div className="flex justify-between items-center">
        <span className="text-muted">{t('entityInfoPanel.state')}:</span>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="bg-active border border-subtle rounded-sm text-primary text-[10px] px-1.5 py-0.5 cursor-pointer max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-right"
          title={t('entityInfoPanel.changeSpriteState')}
        >
          {currentState}
          <span className="ml-1 text-[8px]">{dropdownOpen ? '▴' : '▾'}</span>
        </button>
      </div>
      {dropdownOpen && (
        <div className="absolute right-0 top-full z-[100] bg-surface border border-subtle rounded-sm max-h-[200px] overflow-y-auto min-w-[140px] max-w-[200px] shadow-lg">
          <div
            onClick={() => handleSelect(undefined)}
            className={`flex items-center gap-1.5 px-1.5 py-[3px] cursor-pointer text-[10px] text-primary ${!entity.spriteStateOverride ? 'bg-active' : ''}`}
          >
            <span className="text-[#aaa] italic">{t('entityInfoPanel.default')}</span>
          </div>
          {availableStates.map((state) => (
            <div
              key={state}
              onClick={() => handleSelect(state)}
              className={`flex items-center gap-1.5 px-1.5 py-[3px] cursor-pointer text-[10px] text-primary ${entity.spriteStateOverride === state ? 'bg-active' : ''}`}
            >
              {thumbnails.get(state) && (
                <img
                  src={thumbnails.get(state)}
                  alt={state}
                  className="w-6 h-6 shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
              )}
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function hasDeviceList(entity: ImportedEntity): boolean {
  return entity.components.some(
    (c) => (c as Record<string, unknown>).type === 'DeviceList',
  );
}
