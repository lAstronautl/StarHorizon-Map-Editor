import type { ITool, ToolContext } from './toolTypes';
import type { TileChange, EntityChange, DecalChange } from '../types';
import { ensureGridContains, getCell, setCell } from '../state/editorState';
import { removeEntitiesAtPositions } from './entityBrushHelper';
import { createDecalsAtPositions, removeDecalsAtPositions } from './decalBrushHelper';
import { markSceneDirty } from '../rendering/dirtyFlags';
import { EntityPlaceTool } from './entityPlaceTool';

export class PaintTool implements ITool {
  name = 'paint';
  cursor = 'crosshair';

  private painting = false;
  private erasing = false;
  private tileChanges: TileChange[] = [];
  private entityChanges: EntityChange[] = [];
  private decalChanges: DecalChange[] = [];
  private visited = new Set<string>();

  /** Entities are placed one-at-a-time with rotation/free-placement support, via the
   *  same logic the old standalone "entityPlace" tool used — the brush's drag-paint
   *  model (one entity per tile, no rotation) doesn't apply to entities. */
  readonly entityPlaceTool = new EntityPlaceTool();

  private isEntityMode(ctx: ToolContext): boolean {
    return ctx.paletteItem?.type === 'entity';
  }

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number) {
    if (this.isEntityMode(ctx)) {
      if (button === 2) {
        // Right-click still erases the entity under the cursor, same as before merging.
        // Dispatched immediately (not batched via this.onMouseUp) since entity mode's
        // mouse-up is handled entirely by entityPlaceTool, which knows nothing about erasing.
        const removals = removeEntitiesAtPositions(
          [[Math.floor(tileX), Math.floor(tileY)]], ctx.state.entities, ctx.paletteItem?.id,
        );
        if (removals.length > 0) {
          ctx.dispatch({
            type: 'APPLY_COMMAND',
            command: { label: 'Erase entity', tileChanges: [], entityChanges: removals },
          });
        }
        return;
      }
      this.entityPlaceTool.onMouseDown(ctx, tileX, tileY, button);
      return;
    }

    if (button !== 0 && button !== 2) return;
    this.painting = button === 0;
    this.erasing = button === 2;
    this.tileChanges = [];
    this.entityChanges = [];
    this.decalChanges = [];
    this.visited.clear();
    if (this.erasing) {
      this.eraseAt(ctx, tileX, tileY);
    } else {
      this.paintAt(ctx, tileX, tileY);
    }
  }

  onMouseMove(ctx: ToolContext, tileX: number, tileY: number) {
    if (this.isEntityMode(ctx)) {
      this.entityPlaceTool.onMouseMove();
      return;
    }

    if (this.erasing) {
      this.eraseAt(ctx, tileX, tileY);
    } else if (this.painting) {
      this.paintAt(ctx, tileX, tileY);
    }
  }

  onMouseUp(ctx: ToolContext) {
    if (this.isEntityMode(ctx)) {
      this.entityPlaceTool.onMouseUp();
      return;
    }

    if (!this.painting && !this.erasing) return;
    const wasErasing = this.erasing;
    this.painting = false;
    this.erasing = false;
    if (this.tileChanges.length > 0 || this.entityChanges.length > 0 || this.decalChanges.length > 0) {
      const verb = wasErasing ? 'Erase' : 'Paint';
      const label = this.decalChanges.length > 0 ? `${verb} decals`
        : this.entityChanges.length > 0 ? `${verb} entities` : `${verb} tiles`;
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label,
          tileChanges: this.tileChanges,
          entityChanges: this.entityChanges,
          decalChanges: this.decalChanges.length > 0 ? this.decalChanges : undefined,
        },
      });
    }
    this.tileChanges = [];
    this.entityChanges = [];
    this.decalChanges = [];
    this.visited.clear();
  }

  renderPreview(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ) {
    if (!toolCtx.paletteItem) return;

    if (this.isEntityMode(toolCtx)) {
      this.entityPlaceTool.renderPreview(canvasCtx, toolCtx, cursorTileX, cursorTileY);
      return;
    }

    const { camera, canvasW, canvasH } = toolCtx;
    const tileScreenSize = camera.tileScreenSize;
    const drawX = camera.worldToScreenX(cursorTileX, canvasW);
    const drawY = camera.worldToScreenY(cursorTileY, canvasH);

    canvasCtx.strokeStyle = this.erasing ? '#ff4444' : '#00ff00';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(drawX, drawY, tileScreenSize, tileScreenSize);
  }

  private paintAt(ctx: ToolContext, worldX: number, worldY: number) {
    const { state, paletteItem } = ctx;
    if (!paletteItem) return;

    const key = `${worldX},${worldY}`;
    if (this.visited.has(key)) return;
    this.visited.add(key);

    if (paletteItem.type === 'tile') {
      // Tile painting
      const expanded = ensureGridContains(state.grid, worldX, worldY);
      if (expanded !== state.grid) {
        state.grid = expanded;
      }

      const cell = getCell(state.grid, worldX, worldY);
      if (!cell || cell.tileId === paletteItem.id) return;

      const before = { ...cell };
      // Reset variant/flags/rotationMirroring when changing tile type.
      // Preserving the old tile's variant on a new type can produce out-of-range
      // variants that crash the SS14 MapRenderer.
      const after = { tileId: paletteItem.id };
      setCell(state.grid, worldX, worldY, after);

      this.tileChanges.push({ x: worldX, y: worldY, before, after });
      markSceneDirty(); // Invalidate compositor tile layer so changes appear during drag
    } else if (paletteItem.type === 'decal' && ctx.decalSettings) {
      // Decal painting, place one decal per tile
      const activeGrid = state.grids[state.activeGridIndex];
      const { decalChanges, nextDecalId } = createDecalsAtPositions(
        [[worldX, worldY]],
        paletteItem.id,
        activeGrid.decals.decals,
        activeGrid.decals.nextDecalId,
        ctx.decalSettings,
      );
      if (decalChanges.length > 0) {
        this.decalChanges.push(...decalChanges);
        // Update nextDecalId for subsequent placements in same stroke
        activeGrid.decals.nextDecalId = nextDecalId;
        markSceneDirty();
      }
    }
  }

  private eraseAt(ctx: ToolContext, worldX: number, worldY: number) {
    const { state, paletteItem } = ctx;

    const key = `${worldX},${worldY}`;
    if (this.visited.has(key)) return;
    this.visited.add(key);

    // Entity erasing (right-click) is handled directly in onMouseDown before reaching here,
    // since entity placement no longer goes through this brush's drag/batch-on-mouseup flow.

    if (paletteItem && paletteItem.type === 'decal') {
      const activeGrid = state.grids[state.activeGridIndex];
      const removals = removeDecalsAtPositions(
        [[worldX, worldY]], activeGrid.decals.decals, paletteItem.id,
      );
      this.decalChanges.push(...removals);
      if (removals.length > 0) markSceneDirty();
      return;
    }

    const cell = getCell(state.grid, worldX, worldY);
    if (!cell || cell.tileId === 'Space') return;

    const before = { ...cell };
    const after = { tileId: 'Space' };
    setCell(state.grid, worldX, worldY, after);

    this.tileChanges.push({ x: worldX, y: worldY, before, after });
    markSceneDirty();
  }

  deactivate() {
    this.painting = false;
    this.erasing = false;
    this.tileChanges = [];
    this.entityChanges = [];
    this.decalChanges = [];
    this.visited.clear();
  }
}
