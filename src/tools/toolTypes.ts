import type { EditorState } from '../state/editorState';
import type { EditorAction } from '../state/actions';
import type { Camera } from '../rendering/camera';
import type { PaletteItem, ToolType } from '../types';
import type { ContextMenuItem } from '../components/ContextMenu';
import type { DecalPlacementOptions } from './decalBrushHelper';
import type { LayerVisibility } from '../rendering/entityRenderer';
import type { EraseSettings } from './eraseTool';
import type { SymmetrySettings } from './symmetrySettings';
import type { ToolPreviewSnapshot } from '../multiplayer/messages';

export interface ToolContext {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  camera: Camera;
  canvasW: number;
  canvasH: number;
  paletteItem: PaletteItem | null;
  shiftHeld: boolean;
  ctrlHeld: boolean;
  decalSettings?: DecalPlacementOptions;
  /** Update the decal placement color (used by eyedropper to pick decal colors). */
  setDecalColor?: (color: string | null) => void;
  /** Current layer visibility, tools should respect this for selection/interaction. */
  layerVisibility?: LayerVisibility;
  /** Erase tool mode/toggles (palette-driven vs. selective tiles/entities). */
  eraseSettings?: EraseSettings;
  /** Mirror/symmetry painting mode (currently supported by PaintTool). */
  symmetrySettings?: SymmetrySettings;
  /** Tool that was active before switching to the eyedropper; picking an item restores it. */
  previousTool?: ToolType;
}

export interface ITool {
  name: string;
  cursor: string;
  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number): void;
  onMouseMove(ctx: ToolContext, tileX: number, tileY: number): void;
  onMouseUp(ctx: ToolContext, tileX: number, tileY: number): void;
  renderPreview?(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ): void;
  /** Handle scroll wheel. Return true to suppress default zoom behavior. */
  onWheel?(ctx: ToolContext, tileX: number, tileY: number, deltaY: number): boolean;
  deactivate?(): void;
  getContextMenuItems?(ctx: ToolContext, tileX: number, tileY: number): ContextMenuItem[];
  /** Snapshot of this tool's uncommitted/in-progress edit, for broadcasting as a "ghost"
   *  preview to other players in a multiplayer session. Null when there's nothing to show. */
  getRemotePreviewSnapshot?(): ToolPreviewSnapshot | null;
}
