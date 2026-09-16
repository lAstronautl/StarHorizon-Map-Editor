import React from 'react';
import type { InfrastructureSelection, CableType, PipeType, PipeLayerSelection } from '../types';
import { getCableDisplay, getPipeDisplay } from '../types';
import { useT } from '../i18n';

interface Props {
  selection: InfrastructureSelection;
  onChange: (selection: InfrastructureSelection) => void;
}

const CABLES: CableType[] = ['CableHV', 'CableMV', 'CableApcExtension'];
const PIPES: PipeType[] = ['supply', 'return', 'disposal'];
const PIPE_LAYERS: PipeLayerSelection[] = ['Primary', 'Secondary', 'Tertiary'];

export const InfrastructurePanel: React.FC<Props> = ({ selection, onChange }) => {
  const { t, locale } = useT();
  const cableDisplay = React.useMemo(() => getCableDisplay(), [locale]);
  const pipeDisplay = React.useMemo(() => getPipeDisplay(), [locale]);
  return (
    <div className="p-3">
      <div className="text-muted text-[10px] uppercase tracking-wider mb-1">{t('infrastructurePanel.cables')}</div>
      {CABLES.map(type => {
        const { label, color } = cableDisplay[type];
        const active = selection.mode === 'cable' && selection.cableType === type;
        return (
          <button
            key={type}
            onClick={() => onChange({ ...selection, mode: 'cable', cableType: type })}
            className={`w-full px-2 py-1 rounded-sm border text-primary text-[10px] cursor-pointer mb-0.5 text-left flex items-center gap-1.5
                        ${active ? 'border-accent ring-1 ring-accent' : 'border-subtle hover:border-muted'}`}
            style={{ backgroundColor: active ? '#0f3460' : 'transparent' }}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: color }}
            />
            {label}
          </button>
        );
      })}

      <div className="text-muted text-[10px] uppercase tracking-wider mb-1 mt-3">{t('infrastructurePanel.pipes')}</div>
      {PIPES.map(type => {
        const { label, color } = pipeDisplay[type];
        const active = selection.mode === 'pipe' && selection.pipeType === type;
        return (
          <button
            key={type}
            onClick={() => onChange({ ...selection, mode: 'pipe', pipeType: type })}
            className={`w-full px-2 py-1 rounded-sm border text-primary text-[10px] cursor-pointer mb-0.5 text-left flex items-center gap-1.5
                        ${active ? 'border-accent ring-1 ring-accent' : 'border-subtle hover:border-muted'}`}
            style={{ backgroundColor: active ? '#0f3460' : 'transparent' }}
          >
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: color }}
            />
            {label}
          </button>
        );
      })}

      {selection.pipeType !== 'disposal' && (
        <>
          <div className="text-muted text-[10px] uppercase tracking-wider mb-1 mt-3">{t('infrastructurePanel.pipeLayer')}</div>
          <div className="flex gap-0.5">
            {PIPE_LAYERS.map(layer => {
              const active = selection.pipeLayer === layer;
              return (
                <button
                  key={layer}
                  onClick={() => onChange({ ...selection, pipeLayer: layer })}
                  title={t(`infrastructurePanel.pipeLayerHint.${layer}`)}
                  className={`flex-1 px-1 py-1 rounded-sm border text-primary text-[10px] cursor-pointer text-center
                              ${active ? 'border-accent ring-1 ring-accent' : 'border-subtle hover:border-muted'}`}
                  style={{ backgroundColor: active ? '#0f3460' : 'transparent' }}
                >
                  {t(`infrastructurePanel.pipeLayerName.${layer}`)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
