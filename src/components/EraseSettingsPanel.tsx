import React, { useState, useEffect } from 'react';
import type { EraseSettings } from '../tools/eraseTool';
import { useT } from '../i18n';

interface Props {
  settingsRef: React.MutableRefObject<EraseSettings>;
}

export const EraseSettingsPanel: React.FC<Props> = ({ settingsRef }) => {
  const { t } = useT();
  const [mode, setMode] = useState<EraseSettings['mode']>(settingsRef.current.mode);
  const [eraseTiles, setEraseTiles] = useState(settingsRef.current.eraseTiles);
  const [eraseEntities, setEraseEntities] = useState(settingsRef.current.eraseEntities);

  useEffect(() => {
    settingsRef.current = { mode, eraseTiles, eraseEntities };
  }, [mode, eraseTiles, eraseEntities, settingsRef]);

  return (
    <div className="p-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="eraseMode"
            checked={mode === 'palette'}
            onChange={() => setMode('palette')}
            className="accent-accent w-3 h-3"
          />
          <span className="text-[11px] text-primary">{t('eraseSettings.mode.palette')}</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="eraseMode"
            checked={mode === 'selective'}
            onChange={() => setMode('selective')}
            className="accent-accent w-3 h-3"
          />
          <span className="text-[11px] text-primary">{t('eraseSettings.mode.selective')}</span>
        </label>
      </div>

      {mode === 'selective' && (
        <div className="flex flex-col gap-1 pl-4 border-l border-subtle">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={eraseTiles}
              onChange={(e) => setEraseTiles(e.target.checked)}
              className="accent-accent w-3 h-3"
            />
            <span className="text-[11px] text-primary">{t('eraseSettings.eraseTiles')}</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={eraseEntities}
              onChange={(e) => setEraseEntities(e.target.checked)}
              className="accent-accent w-3 h-3"
            />
            <span className="text-[11px] text-primary">{t('eraseSettings.eraseEntities')}</span>
          </label>
        </div>
      )}
    </div>
  );
};
