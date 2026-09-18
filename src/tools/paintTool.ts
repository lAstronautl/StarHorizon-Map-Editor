import type { ITool, ToolContext } from './toolTypes';
import type { TileChange, EntityChange, DecalChange } from '../types';
import { getCell } from '../state/editorState';
import { removeEntitiesAtPositions } from './entityBrushHelper';
import { createDecalsAtPositions, removeDecalsAtPositions } from './decalBrushHelper';
import { markSceneDirty, markOverlayDirty } from '../rendering/dirtyFlags';
import { EntityPlaceTool } from './entityPlaceTool';
import { getTileImage, getFallbackColor } from '../rendering/gridRenderer';
import { drawImageGhost, drawFillGhost } from './ghostPreviewHelper';

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
    // Tile changes are only committed to the grid here (via APPLY_COMMAND above), so the
    // scene needs a repaint now that this.tileChanges (the ghost preview) is cleared.
    markSceneDirty();
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

    // Ghost preview of tiles queued during the current drag (not yet committed to the
    // grid — see paintAt/eraseAt), drawn with the real texture at reduced opacity so
    // it's obvious what will land once the mouse is released. Uses the same
    // drawImageGhost/drawFillGhost helpers entityPlaceTool uses for its own ghost.
    const GHOST_OPACITY = 0.55;
    if (this.tileChanges.length > 0) {
      for (const tc of this.tileChanges) {
        const sx = camera.worldToScreenX(tc.x, canvasW);
        const sy = camera.worldToScreenY(tc.y, canvasH);
        this.drawTileGhost(canvasCtx, toolCtx, tc.after.tileId, sx, sy, tileScreenSize, GHOST_OPACITY);
      }
    }

    const drawX = camera.worldToScreenX(cursorTileX, canvasW);
    const drawY = camera.worldToScreenY(cursorTileY, canvasH);

    // Cursor ghost: the tile that would be painted/erased right here, same reduced opacity.
    if (toolCtx.paletteItem.type === 'tile') {
      this.drawTileGhost(canvasCtx, toolCtx, this.erasing ? 'Space' : toolCtx.paletteItem.id, drawX, drawY, tileScreenSize, GHOST_OPACITY);
    }

    canvasCtx.strokeStyle = this.erasing ? '#ff4444' : '#00ff00';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(drawX, drawY, tileScreenSize, tileScreenSize);
  }

  /** Draw a single tile's real texture (or a fallback fill) as a ghost at reduced opacity.
   *  'Space' (erasing) always renders as a plain red fill — a gap would be indistinguishable
   *  from "nothing queued here yet" since the real grid is untouched until mouse-up. */
  private drawTileGhost(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    tileId: string,
    screenX: number,
    screenY: number,
    tileScreenSize: number,
    opacity: number,
  ) {
    if (tileId === 'Space') {
      drawFillGhost(canvasCtx, '#ff4444', screenX, screenY, tileScreenSize, opacity);
      return;
    }
    const registry = toolCtx.state.registry;
    const img = registry ? getTileImage(tileId, registry) : null;
    if (img) {
      const tile = registry!.getTile(tileId);
      const variants = tile ? tile.variants : 1;
      const srcSize = img.width / variants; // preview always shows variant 0
      drawImageGhost(canvasCtx, { image: img, sx: 0, sy: 0, sw: srcSize, sh: img.height }, screenX, screenY, tileScreenSize, opacity);
    } else {
      drawFillGhost(canvasCtx, getFallbackColor(tileId), screenX, screenY, tileScreenSize, opacity);
    }
  }

  private paintAt(ctx: ToolContext, worldX: number, worldY: number) {
    const { state, paletteItem } = ctx;
    if (!paletteItem) return;

    const key = `${worldX},${worldY}`;
    if (this.visited.has(key)) return;
    this.visited.add(key);

    if (paletteItem.type === 'tile') {
      // Tile painting is deferred: don't touch state.grid or expand its bounds here —
      // just queue the change and let renderPreview draw a ghost. The grid is only
      // actually mutated (and expanded, by the reducer) once onMouseUp dispatches the
      // accumulated tileChanges as a single command, so mid-drag tiles read as a
      // translucent preview rather than the real, opaque result.
      const cell = getCell(state.grid, worldX, worldY);
      const before = cell ? { ...cell } : { tileId: 'Space' };
      if (before.tileId === paletteItem.id) return;

      // Reset variant/flags/rotationMirroring when changing tile type.
      // Preserving the old tile's variant on a new type can produce out-of-range
      // variants that crash the SS14 MapRenderer.
      const after = { tileId: paletteItem.id };
      this.tileChanges.push({ x: worldX, y: worldY, before, after });
      markOverlayDirty(); // Ghost preview lives on the overlay layer, not the tile layer
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

    // Deferred, same as paintAt: queue for the ghost preview, commit on mouse-up.
    const cell = getCell(state.grid, worldX, worldY);
    if (!cell || cell.tileId === 'Space') return;

    const before = { ...cell };
    const after = { tileId: 'Space' };
    this.tileChanges.push({ x: worldX, y: worldY, before, after });
    markOverlayDirty();
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
