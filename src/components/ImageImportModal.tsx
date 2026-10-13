import React, { useEffect } from 'react';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import type { PrefabData } from '../prefab/prefabTypes';
import { ImageImportPanel } from './ImageImportPanel';
import { useT } from '../i18n';

interface Props {
  registry: IPrototypeRegistry | null;
  onConverted: (data: PrefabData, filename: string, folder?: string) => void;
  onClose: () => void;
}

/** Image import has its own tall list (one row per unique color, each with a growable
 *  list of entity slots) that doesn't fit comfortably in the narrow side palette — it
 *  gets a dedicated large modal instead, following the same overlay pattern as
 *  ValidatorModal, but sized for a much taller/wider working area. */
export const ImageImportModal: React.FC<Props> = ({ registry, onConverted, onClose }) => {
  const { t } = useT();

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
      <div className="bg-elevated border border-subtle rounded-lg w-[980px] max-w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-subtle shrink-0">
          <h2 className="text-base font-semibold text-accent m-0">{t('palettePanel.tabs.imageImport')}</h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>
        <ImageImportPanel registry={registry} onConverted={onConverted} />
      </div>
    </div>
  );
};
