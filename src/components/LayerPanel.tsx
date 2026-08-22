import React from 'react';
import type { LayerVisibility } from '../rendering/entityRenderer';

interface Props {
  layers: LayerVisibility;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  showSubFloor: boolean;
  onToggleSubFloor: () => void;
  showConnections: boolean;
  onToggleConnections: () => void;
}

const LAYER_DEFS: { key: keyof LayerVisibility; label: string; desc: string }[] = [
  { key: 'subfloor', label: 'Подпол', desc: 'Кабели, трубы, мусоропровод (-22 до -13)' },
  { key: 'floorObjects', label: 'Объ. пола', desc: 'Ковры, напольные предметы (-12 до -5)' },
  { key: 'structures', label: 'Конструкции', desc: 'Стены, окна, решётки (-2 до -1)' },
  { key: 'objects', label: 'Объекты', desc: 'Мебель, машины, настенные крепления (0 до +7)' },
  { key: 'doors', label: 'Двери', desc: 'Шлюзы, противопожарные, бронедвери (+8 до +10)' },
  { key: 'markers', label: 'Маркеры', desc: 'Точки спавна, помощники разметки' },
  { key: 'decals', label: 'Декали', desc: 'Разметка пола, стрелки, оверлеи' },
];

export const LayerPanel: React.FC<Props> = ({
  layers, onToggleLayer, showSubFloor, onToggleSubFloor,
  showConnections, onToggleConnections,
}) => {
  return (
    <div className="p-3">
      {LAYER_DEFS.map(def => (
        <label key={def.key} className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title={def.desc}>
          <input
            type="checkbox"
            checked={layers[def.key]}
            onChange={() => onToggleLayer(def.key)}
            className="accent-accent w-3 h-3"
          />
          {def.label}
        </label>
      ))}

      <div className="h-px bg-subtle my-2" />

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title="Показывать инфраструктуру под тайлами (режим Т-луча)">
        <input
          type="checkbox"
          checked={showSubFloor}
          onChange={onToggleSubFloor}
          className="accent-accent w-3 h-3"
        />
        Т-луч (подпол)
      </label>

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title="Показывать связи и соединения устройств">
        <input
          type="checkbox"
          checked={showConnections}
          onChange={onToggleConnections}
          className="accent-accent w-3 h-3"
        />
        Связи
      </label>
    </div>
  );
};
