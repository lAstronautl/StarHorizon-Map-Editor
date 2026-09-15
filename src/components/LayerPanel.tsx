import React from 'react';
import type { LayerVisibility } from '../rendering/entityRenderer';
import { useT } from '../i18n';

interface Props {
  layers: LayerVisibility;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  showSubFloor: boolean;
  onToggleSubFloor: () => void;
  showConnections: boolean;
  onToggleConnections: () => void;
}

function useLayerDefs(): { key: keyof LayerVisibility; label: string; desc: string }[] {
  const { t } = useT();
  return [
    { key: 'floorObjects', label: t('layerPanel.layer.floorObjects.label'), desc: t('layerPanel.layer.floorObjects.desc') },
    { key: 'structures', label: t('layerPanel.layer.structures.label'), desc: t('layerPanel.layer.structures.desc') },
    { key: 'objects', label: t('layerPanel.layer.objects.label'), desc: t('layerPanel.layer.objects.desc') },
    { key: 'doors', label: t('layerPanel.layer.doors.label'), desc: t('layerPanel.layer.doors.desc') },
    { key: 'markers', label: t('layerPanel.layer.markers.label'), desc: t('layerPanel.layer.markers.desc') },
    { key: 'decals', label: t('layerPanel.layer.decals.label'), desc: t('layerPanel.layer.decals.desc') },
  ];
}

function useSubfloorSubDefs(): { key: keyof LayerVisibility; label: string }[] {
  const { t } = useT();
  return [
    { key: 'subfloorCables', label: t('layerPanel.layer.subfloorCables.label') },
    { key: 'subfloorPipes', label: t('layerPanel.layer.subfloorPipes.label') },
    { key: 'subfloorDisposal', label: t('layerPanel.layer.subfloorDisposal.label') },
  ];
}

export const LayerPanel: React.FC<Props> = ({
  layers, onToggleLayer, showSubFloor, onToggleSubFloor,
  showConnections, onToggleConnections,
}) => {
  const { t } = useT();
  const LAYER_DEFS = useLayerDefs();
  const SUBFLOOR_SUB_DEFS = useSubfloorSubDefs();
  return (
    <div className="p-3">
      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title={t('layerPanel.layer.subfloor.desc')}>
        <input
          type="checkbox"
          checked={layers.subfloor}
          onChange={() => onToggleLayer('subfloor')}
          className="accent-accent w-3 h-3"
        />
        {t('layerPanel.layer.subfloor.label')}
      </label>
      {layers.subfloor && (
        <div className="flex flex-col pl-5 border-l border-subtle ml-1.5">
          {SUBFLOOR_SUB_DEFS.map(def => (
            <label key={def.key} className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={layers[def.key]}
                onChange={() => onToggleLayer(def.key)}
                className="accent-accent w-3 h-3"
              />
              {def.label}
            </label>
          ))}
        </div>
      )}

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

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title={t('layerPanel.subFloorTitle')}>
        <input
          type="checkbox"
          checked={showSubFloor}
          onChange={onToggleSubFloor}
          className="accent-accent w-3 h-3"
        />
        {t('layerPanel.subFloorLabel')}
      </label>

      <label className="flex items-center gap-2 py-0.5 text-primary text-[11px] cursor-pointer select-none" title={t('layerPanel.connectionsTitle')}>
        <input
          type="checkbox"
          checked={showConnections}
          onChange={onToggleConnections}
          className="accent-accent w-3 h-3"
        />
        {t('layerPanel.connectionsLabel')}
      </label>
    </div>
  );
};
