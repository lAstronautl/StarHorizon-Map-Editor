import React from 'react';
import { useT } from '../i18n';

interface Props {
  onUpdate: () => void;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<Props> = ({ onUpdate, onDismiss }) => {
  const { t } = useT();

  return (
    <div className="flex items-center justify-center gap-3 bg-accent text-white text-xs px-3 py-1.5 shrink-0">
      <span>{t('app.updateBanner.message')}</span>
      <button
        onClick={onUpdate}
        className="bg-white/20 hover:bg-white/30 border-none rounded-sm text-white text-xs px-3 py-1 cursor-pointer font-medium"
      >
        {t('app.updateBanner.reload')}
      </button>
      <button
        onClick={onDismiss}
        title={t('app.updateBanner.dismiss')}
        className="bg-transparent hover:bg-white/20 border-none rounded-sm text-white text-xs w-5 h-5 flex items-center justify-center cursor-pointer"
      >
        &times;
      </button>
    </div>
  );
};
