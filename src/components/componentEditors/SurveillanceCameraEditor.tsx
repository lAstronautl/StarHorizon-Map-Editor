import React from 'react';
import type { ComponentEditorProps } from './types';
import { useT } from '../../i18n';

export const SurveillanceCameraEditor: React.FC<ComponentEditorProps> = ({ component, onChange }) => {
  const { t } = useT();
  const id = (component.id as string) ?? '';
  const networks = (component.setupAvailableNetworks as string[]) ?? [];
  const networksStr = networks.join(', ');

  return (
    <div className="py-0.5">
      <div className="mb-0.5">
        <label className="text-muted text-[10px] block mb-px">id</label>
        <input
          type="text"
          value={id}
          onChange={(e) => onChange({ ...component, id: e.target.value })}
          className="bg-elevated border border-subtle rounded-sm text-primary text-[10px] px-1 py-0.5 w-full box-border"
        />
      </div>
      <div>
        <label className="text-muted text-[10px] block mb-px">setupAvailableNetworks</label>
        <input
          type="text"
          value={networksStr}
          onChange={(e) => {
            const arr = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            onChange({ ...component, setupAvailableNetworks: arr });
          }}
          placeholder={t('surveillanceCameraEditor.networksPlaceholder')}
          className="bg-elevated border border-subtle rounded-sm text-primary text-[10px] px-1 py-0.5 w-full box-border"
        />
        <div className="text-[#666] text-[9px] mt-px">{t('surveillanceCameraEditor.networksHint')}</div>
      </div>
    </div>
  );
};
