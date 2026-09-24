import React, { useState, useEffect } from 'react';
import type { BrushSettings, StrokeMode } from '../tools/brushSettings';
import { useT } from '../i18n';

interface Props {
  settingsRef: React.MutableRefObject<BrushSettings>;
}

export const BrushSettingsPanel: React.FC<Props> = ({ settingsRef }) => {
  const { t } = useT();
  const [strokeMode, setStrokeMode] = useState<StrokeMode>(settingsRef.current.strokeMode);

  useEffect(() => {
    settingsRef.current = { strokeMode };
  }, [strokeMode, settingsRef]);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="strokeMode"
          checked={strokeMode === 'hold'}
          onChange={() => setStrokeMode('hold')}
          className="accent-accent w-3 h-3"
        />
        <span className="text-[11px] text-primary">{t('brushSettings.mode.hold')}</span>
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="strokeMode"
          checked={strokeMode === 'click'}
          onChange={() => setStrokeMode('click')}
          className="accent-accent w-3 h-3"
        />
        <span className="text-[11px] text-primary">{t('brushSettings.mode.click')}</span>
      </label>
    </div>
  );
};
