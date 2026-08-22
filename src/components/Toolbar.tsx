import React, { useCallback } from 'react';
import type { ToolType } from '../types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { triggerSpaceClown } from '../rendering/spaceClown';
import { withBase } from '../basePath';
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

const TILE_TOOLS: ToolDef[] = [
  { id: 'pan', label: 'Рука', shortcut: 'H', icon: faHandPaper },
  { id: 'paint', label: 'Кисть', shortcut: 'B', icon: faPaintBrush },
  { id: 'erase', label: 'Ластик', shortcut: 'E', icon: faEraser },
  { id: 'eyedropper', label: 'Пипетка', shortcut: 'I', icon: faEyeDropper },
  { id: 'fill', label: 'Заливка', shortcut: 'G', icon: faFillDrip },
  { id: 'rectangle', label: 'Прямоуг.', shortcut: 'R', icon: faSquare },
  { id: 'line', label: 'Линия', shortcut: 'L', icon: faGripLines },
  { id: 'circle', label: 'Круг', shortcut: 'C', icon: faCircle },
  { id: 'select', label: 'Выбор', shortcut: 'S', icon: faObjectGroup },
];

const ENTITY_TOOLS: ToolDef[] = [
  { id: 'entitySelect', label: 'Выбор Э.', shortcut: 'V', icon: faMousePointer },
  { id: 'entityPlace', label: 'Разм. Э.', shortcut: 'P', icon: faCube },
  { id: 'deviceLink', label: 'Связь', shortcut: 'D', icon: faLink },
];

const INFRA_TOOLS: ToolDef[] = [
  { id: 'cableDraw', label: 'Кабели', shortcut: 'K', icon: faBolt },
  { id: 'pipeDraw', label: 'Трубы', shortcut: 'J', icon: faWater },
];

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
  return (
    <div className="flex flex-col w-[76px] bg-panel border-r border-subtle py-1 overflow-y-auto">
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">Тайлы</div>
      {TILE_TOOLS.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="h-px bg-subtle mx-2 my-1" />
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">Сущности</div>
      {ENTITY_TOOLS.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="h-px bg-subtle mx-2 my-1" />
      <div className="text-[9px] text-muted uppercase text-center tracking-wider py-0.5">Инфра</div>
      {INFRA_TOOLS.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onSelect={onSelectTool} />
      ))}

      <div className="text-[8px] text-muted text-center mt-2 leading-tight opacity-60">
        Пробел+ЛКМ<br />для панорамы
      </div>

      <div className="mt-auto pb-2">
        <button
          onClick={() => triggerSpaceClown(window.innerWidth, window.innerHeight)}
          className="flex flex-col items-center justify-center w-full py-2 text-[10px] cursor-pointer border-none bg-transparent text-muted hover:bg-hover hover:text-primary gap-0.5"
          title="Хонк!"
        >
          <img src={withBase('/images/clown.png')} alt="🤡" style={{ width: 20, height: 20, imageRendering: 'pixelated' }} />
          <span className="leading-tight">Клоун?</span>
        </button>
      </div>
    </div>
  );
};
