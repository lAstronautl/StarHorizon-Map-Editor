import React, { useCallback } from 'react';
import type { ToolType } from '../types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { triggerSpaceClown } from '../rendering/spaceClown';
import { withBase } from '../basePath';
import { useT } from '../i18n';
import {
  faHandPaper,
  faPaintBrush,
  faEraser,
  faEyeDropper,
  faFillDrip,
  faSquare,
  faGripLines,
  faCircle,
  faObjectGroup,
  faMousePointer,
  faCube,
  faLink,
  faBolt,
  faWater,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: IconDefinition;
}

function useToolGroups(): { tileTools: ToolDef[]; entityTools: ToolDef[]; infraTools: ToolDef[] } {
  const { t } = useT();
  const tileTools: ToolDef[] = [
    { id: 'pan', label: t('toolbar.tool.pan'), shortcut: 'H', icon: faHandPaper },
    { id: 'paint', label: t('toolbar.tool.paint'), shortcut: 'B', icon: faPaintBrush },
    { id: 'erase', label: t('toolbar.tool.erase'), shortcut: 'E', icon: faEraser },
    { id: 'eyedropper', label: t('toolbar.tool.eyedropper'), shortcut: 'I', icon: faEyeDropper },
    { id: 'fill', label: t('toolbar.tool.fill'), shortcut: 'G', icon: faFillDrip },
    { id: 'rectangle', label: t('toolbar.tool.rectangle'), shortcut: 'R', icon: faSquare },
    { id: 'line', label: t('toolbar.tool.line'), shortcut: 'L', icon: faGripLines },
    { id: 'circle', label: t('toolbar.tool.circle'), shortcut: 'C', icon: faCircle },
    { id: 'select', label: t('toolbar.tool.select'), shortcut: 'S', icon: faObjectGroup },
  ];

  const entityTools: ToolDef[] = [
    { id: 'entitySelect', label: t('toolbar.tool.entitySelect'), shortcut: 'V', icon: faMousePointer },
    { id: 'entityPlace', label: t('toolbar.tool.entityPlace'), shortcut: 'P', icon: faCube },
    { id: 'deviceLink', label: t('toolbar.tool.deviceLink'), shortcut: 'D', icon: faLink },
  ];

  const infraTools: ToolDef[] = [
    { id: 'cableDraw', label: t('toolbar.tool.cableDraw'), shortcut: 'K', icon: faBolt },
    { id: 'pipeDraw', label: t('toolbar.tool.pipeDraw'), shortcut: 'J', icon: faWater },
  ];

  return { tileTools, entityTools, infraTools };
}

function ToolButton({ tool, active, onSelect }: { tool: ToolDef; active: boolean; onSelect: (tool: ToolType) => void }) {
  return (
    <button
      onClick={() => onSelect(tool.id)}
      className={`flex flex-col items-center justify-center w-full py-2 text-[10px] cursor-pointer border-none gap-0.5
                  ${active ? 'bg-active text-accent' : 'bg-transparent text-muted hover:bg-hover hover:text-primary'}`}
      title={`${tool.label} (${tool.shortcut})`}
    >
      <FontAwesomeIcon icon={tool.icon} className="text-sm" />
      <span className="leading-tight">{tool.label}</span>
      <span className="text-[8px] text-muted opacity-60">{tool.shortcut}</span>
    </button>
  );
}

export const Toolbar: React.FC<Props> = ({ activeTool, onSelectTool }) => {
  const { t } = useT();
  const { tileTools, entityTools, infraTools } = useToolGroups();
  return (
    <div className="flex flex-col w-[76px] bg-panel border-r border-subtle py-1 overflow-y-auto">
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">{t('toolbar.section.tiles')}</div>
      {tileTools.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="h-px bg-subtle mx-2 my-1" />
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">{t('toolbar.section.entities')}</div>
      {entityTools.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="h-px bg-subtle mx-2 my-1" />
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">{t('toolbar.section.infra')}</div>
      {infraTools.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="text-[8px] text-muted text-center mt-2 leading-tight opacity-60">
        {t('toolbar.panHint.line1')}<br />{t('toolbar.panHint.line2')}
      </div>

      <div className="mt-auto pb-2">
        <button
          onClick={() => triggerSpaceClown(window.innerWidth, window.innerHeight)}
          className="flex flex-col items-center justify-center w-full py-2 text-[10px] cursor-pointer border-none bg-transparent text-muted hover:bg-hover hover:text-primary gap-0.5"
          title={t('toolbar.honk')}
        >
          <img src={withBase('/images/clown.png')} alt="🤡" style={{ width: 20, height: 20, imageRendering: 'pixelated' }} />
          <span className="leading-tight">{t('toolbar.clown')}</span>
        </button>
      </div>
    </div>
  );
};
