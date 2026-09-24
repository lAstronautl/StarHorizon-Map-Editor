import React from 'react';
import { useT } from '../i18n';

interface Props {
  tileCount: number;
  entityCount: number;
  decalCount: number;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onMirrorHorizontal: () => void;
  onMirrorVertical: () => void;
  onDelete: () => void;
}

export const SelectionInfoPanel: React.FC<Props> = ({
  tileCount, entityCount, decalCount, onRotateCW, onRotateCCW, onMirrorHorizontal, onMirrorVertical, onDelete,
}) => {
  const { t } = useT();

  return (
    <div className="p-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-col gap-0.5 text-[11px] text-primary">
        <div>{t('selectionInfo.tiles', { count: tileCount })}</div>
        <div>{t('selectionInfo.entities', { count: entityCount })}</div>
        {decalCount > 0 && <div>{t('selectionInfo.decals', { count: decalCount })}</div>}
      </div>

      <div className="flex gap-1 mt-1">
        <ActionButton label="&#x21B6;" onClick={onRotateCCW} title={t('selectionInfo.rotateCcw')} />
        <ActionButton label="&#x21B7;" onClick={onRotateCW} title={t('selectionInfo.rotateCw')} />
      </div>
      <div className="flex gap-1">
        <ActionButton label={t('selectionInfo.mirrorHorizontal')} onClick={onMirrorHorizontal} title={t('selectionInfo.mirrorHorizontal')} />
        <ActionButton label={t('selectionInfo.mirrorVertical')} onClick={onMirrorVertical} title={t('selectionInfo.mirrorVertical')} />
      </div>
      <div className="flex gap-1">
        <ActionButton label={t('selectionInfo.delete')} onClick={onDelete} color="#c44" />
      </div>
    </div>
  );
};

function ActionButton({ label, onClick, title, color }: { label: string; onClick: () => void; title?: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-1 py-1.5 text-[11px] rounded border cursor-pointer bg-elevated hover:bg-hover border-subtle text-primary"
      style={color ? { color, borderColor: color } : undefined}
    >
      {label}
    </button>
  );
}
