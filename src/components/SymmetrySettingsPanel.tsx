import React, { useState, useEffect } from 'react';
import type { SymmetrySettings, SymmetryMode, MirrorAxis } from '../tools/symmetrySettings';
import { useT } from '../i18n';

interface Props {
  settingsRef: React.MutableRefObject<SymmetrySettings>;
}

export const SymmetrySettingsPanel: React.FC<Props> = ({ settingsRef }) => {
  const { t } = useT();
  const [mode, setMode] = useState<SymmetryMode>(settingsRef.current.mode);
  const [axis, setAxis] = useState<MirrorAxis>(settingsRef.current.axis);

  useEffect(() => {
    settingsRef.current = { mode, axis };
  }, [mode, axis, settingsRef]);

  return (
    <div className="p-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="symmetryMode"
            checked={mode === 'none'}
            onChange={() => setMode('none')}
            className="accent-accent w-3 h-3"
          />
          <span className="text-[11px] text-primary">{t('symmetrySettings.mode.none')}</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="symmetryMode"
            checked={mode === 'mirror'}
            onChange={() => setMode('mirror')}
            className="accent-accent w-3 h-3"
          />
          <span className="text-[11px] text-primary">{t('symmetrySettings.mode.mirror')}</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="symmetryMode"
            checked={mode === 'fourWay'}
            onChange={() => setMode('fourWay')}
            className="accent-accent w-3 h-3"
          />
          <span className="text-[11px] text-primary">{t('symmetrySettings.mode.fourWay')}</span>
        </label>
      </div>

      {mode === 'mirror' && (
        <div className="flex flex-col gap-1 pl-4 border-l border-subtle">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="symmetryAxis"
              checked={axis === 'vertical'}
              onChange={() => setAxis('vertical')}
              className="accent-accent w-3 h-3"
            />
            <span className="text-[11px] text-primary">{t('symmetrySettings.axis.vertical')}</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="symmetryAxis"
              checked={axis === 'horizontal'}
              onChange={() => setAxis('horizontal')}
              className="accent-accent w-3 h-3"
            />
            <span className="text-[11px] text-primary">{t('symmetrySettings.axis.horizontal')}</span>
          </label>
        </div>
      )}
    </div>
  );
};
