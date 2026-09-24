import { t } from './i18n';

// ---- Geometry ----

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- Tile Grid ----

export interface TileCell {
  tileId: string;
  flags?: number;            // byte, preserved from import
  variant?: number;          // byte, preserved from import
  rotationMirroring?: number; // byte, format 7+ only
}

export interface TileGrid {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  cells: TileCell[];
  firelockPositions?: { gx: number; gy: number }[];
}

// ---- Directions ----

export type CardinalDirection = 'north' | 'south' | 'east' | 'west';

// ---- Infrastructure (kept for legacy rendering compatibility) ----

export interface CableSegment {
  type: string;
  tiles: Point[];
}

export interface PipeSegment {
  tiles: Point[];
  color?: string;
}

export interface ProcessedPipe {
  x: number;
  y: number;
  prototype: string;
  rotation: number;
  color?: string;
}

export interface InfrastructureLayout {
  entities: import('./import/mapImporter').ImportedEntity[];
  cableSegments: CableSegment[];
  pipeSegments: PipeSegment[];
  processedPipes: ProcessedPipe[];
  disposalSegments: PipeSegment[];
  processedDisposal: ProcessedPipe[];
}

// ---- Editor-specific types ----

export type ToolType = 'paint' | 'erase' | 'eyedropper' | 'fill' | 'rectangle' | 'line' | 'circle' | 'select' | 'polygon' | 'pan' | 'zoom' | 'entitySelect' | 'cableDraw' | 'pipeDraw' | 'deviceLink' | 'prefabPlace';

// ---- Infrastructure drawing ----

export type CableType = 'CableHV' | 'CableMV' | 'CableApcExtension';
export type PipeType = 'supply' | 'return' | 'disposal';
/** SS14 supports up to 3 independent gas pipe runs overlapping the same tiles
 *  (AtmosPipeLayer: Primary/Secondary/Tertiary); disposal has no layer system. */
export type PipeLayerSelection = 'Primary' | 'Secondary' | 'Tertiary';

export interface InfrastructureSelection {
  mode: 'cable' | 'pipe';
  cableType: CableType;
  pipeType: PipeType;
  pipeLayer: PipeLayerSelection;
  /** Overrides the supply/return default color with an arbitrary hex string (e.g. "#00FF00FF")
   *  when set. Pipes only auto-connect to others sharing the exact same color, so a custom
   *  color creates its own independent network distinct from supply/return/other customs. */
  customPipeColor?: string;
}

export const PIPE_COLORS: Record<'supply' | 'return', string> = {
  supply: '#0055CCFF',
  return: '#990000FF',
};

const CABLE_COLORS: Record<CableType, string> = {
  CableHV: '#ff8800',
  CableMV: '#ffcc00',
  CableApcExtension: '#00cc44',
};

/** Builds the cable display table (label + color) using the current locale. Call at use-time, not at module load. */
export function getCableDisplay(): Record<CableType, { label: string; color: string }> {
  return {
    CableHV: { label: t('types.cableDisplay.CableHV'), color: CABLE_COLORS.CableHV },
    CableMV: { label: t('types.cableDisplay.CableMV'), color: CABLE_COLORS.CableMV },
    CableApcExtension: { label: t('types.cableDisplay.CableApcExtension'), color: CABLE_COLORS.CableApcExtension },
  };
}

const PIPE_LABEL_COLORS: Record<PipeType, string> = {
  supply: '#0088ff',
  return: '#cc2200',
  disposal: '#886644',
};

/** Builds the pipe display table (label + color) using the current locale. Call at use-time, not at module load. */
export function getPipeDisplay(): Record<PipeType, { label: string; color: string }> {
  return {
    supply: { label: t('types.pipeDisplay.supply'), color: PIPE_LABEL_COLORS.supply },
    return: { label: t('types.pipeDisplay.return'), color: PIPE_LABEL_COLORS.return },
    disposal: { label: t('types.pipeDisplay.disposal'), color: PIPE_LABEL_COLORS.disposal },
  };
}

export interface PaletteItem {
  type: 'tile' | 'entity' | 'decal';
  id: string; // tile ID or entity prototype ID
}

export interface TileChange {
  x: number;
  y: number;
  before: TileCell;
  after: TileCell;
}

export interface EntityChange {
  action: 'add' | 'remove';
  entity: import('./import/mapImporter').ImportedEntity;
}

export interface ContainedEntityChange {
  action: 'add' | 'remove';
  parentUid: number;
  entity: import('./import/mapImporter').ImportedEntity;
  previousParentComponents?: Record<string, unknown>[];
}

export interface DecalChange {
  action: 'add' | 'remove' | 'update';
  decal: import('./import/decalParser').DecalInstance;
  previousDecal?: import('./import/decalParser').DecalInstance; // for undo of 'update'
}

export interface Command {
  label: string;
  tileChanges: TileChange[];
  entityChanges: EntityChange[];
  containedEntityChanges?: ContainedEntityChange[];
  decalChanges?: DecalChange[];
  /** When present, undo/redo targets this specific grid. When absent, targets active grid. */
  gridUid?: number;
}

export interface GridCommand {
  type: 'ADD_GRID' | 'REMOVE_GRID' | 'RENAME_GRID';
  gridData: import('./state/gridData').GridData;
  previousName?: string;    // for undo of rename
  insertIndex?: number;     // where the grid was in the array (for undo of remove)
}

export type UndoableCommand = Command | GridCommand;
