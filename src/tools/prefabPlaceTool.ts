import type { ITool, ToolContext } from './toolTypes';
import type { PrefabData } from '../prefab/prefabTypes';
import { placePrefab } from '../prefab/prefabPlacer';
import { ensureGridContainsBounds } from '../state/editorState';
import { markSceneDirty, markOverlayDirty } from '../rendering/dirtyFlags';
import { peerUid } from '../multiplayer/uidAllocation';

export class PrefabPlaceTool implements ITool {
  name = 'prefabPlace';
  cursor = 'crosshair';

  private prefab: PrefabData | null = null;
  private cursorX = 0;
  private cursorY = 0;

  setPrefab(prefab: PrefabData | null): void {
    this.prefab = prefab;
    markOverlayDirty();
  }

  getPrefab(): PrefabData | null {
    return this.prefab;
  }

  getPreviewWidth(): number {
    return this.prefab?.width ?? 0;
  }

  getPreviewHeight(): number {
    return this.prefab?.height ?? 0;
  }

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number): void {
    if (button === 2) {
      // Right-click cancels prefab placement instead of placing/opening a context menu.
      if (this.prefab) {
        this.setPrefab(null);
        ctx.dispatch({ type: 'SET_TOOL', tool: 'select' });
      }
      return;
    }
    if (button !== 0) return;
    if (!this.prefab) return;

    const prefab = this.prefab;

    // Expand grid to contain the prefab footprint
    const expanded = ensureGridContainsBounds(
      ctx.state.grid,
      tileX, tileY,
      tileX + prefab.width - 1, tileY + prefab.height - 1,
      0,
    );
    if (expanded !== ctx.state.grid) {
      ctx.state.grid = expanded;
    }

    // Place prefab
    const activeGrid = ctx.state.grids[ctx.state.activeGridIndex];
    const result = placePrefab({
      prefab,
      placeX: tileX,
      placeY: tileY,
      grid: ctx.state.grid,
      entities: ctx.state.entities,
      nextEntityId: peerUid(ctx.state.localPeerIndex, ctx.state.localEntityCounter),
      nextDecalId: activeGrid.decals.nextDecalId,
    });

    // Dispatch the command
    ctx.dispatch({ type: 'APPLY_COMMAND', command: result.command });
    // Note: raw YAML lines are intentionally NOT preserved for prefab-placed entities
    // because entity positions have changed from the original prefab

    markSceneDirty();
    // Stay in placement mode, don't clear prefab
  }

  onMouseMove(_ctx: ToolContext, tileX: number, tileY: number): void {
    if (tileX !== this.cursorX || tileY !== this.cursorY) {
      this.cursorX = tileX;
      this.cursorY = tileY;
      markOverlayDirty();
    }
  }

  onMouseUp(_ctx: ToolContext, _tileX: number, _tileY: number): void {
    // no-op
  }

  renderPreview(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ): void {
    if (!this.prefab) {
      // No prefab loaded, just show a cursor highlight
      const { camera, canvasW, canvasH } = toolCtx;
      const sx = camera.worldToScreenX(cursorTileX, canvasW);
      const sy = camera.worldToScreenY(cursorTileY, canvasH);
      canvasCtx.strokeStyle = '#ffffff';
      canvasCtx.lineWidth = 1;
      canvasCtx.setLineDash([4, 4]);
      canvasCtx.strokeRect(sx, sy, camera.tileScreenSize, camera.tileScreenSize);
      canvasCtx.setLineDash([]);
      return;
    }

    const { camera, canvasW, canvasH } = toolCtx;
    const tileScreenSize = camera.tileScreenSize;
    const prefab = this.prefab;

    // Ghost preview of tiles (blue semi-transparent)
    canvasCtx.globalAlpha = 0.5;
    for (const tile of prefab.tiles) {
      const sx = camera.worldToScreenX(cursorTileX + tile.dx, canvasW);
      const sy = camera.worldToScreenY(cursorTileY + tile.dy, canvasH);
      canvasCtx.fillStyle = '#c0c0c0';
      canvasCtx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
    }

    // Ghost preview of entities (green semi-transparent)
    for (const ent of prefab.entities) {
      const ex = cursorTileX + Math.floor(ent.dx);
      const ey = cursorTileY + Math.floor(ent.dy);
      const sx = camera.worldToScreenX(ex, canvasW);
      const sy = camera.worldToScreenY(ey, canvasH);
      canvasCtx.fillStyle = '#44ff88';
      canvasCtx.fillRect(sx + 2, sy + 2, tileScreenSize - 4, tileScreenSize - 4);
    }

    // Ghost preview of decals (yellow semi-transparent dots)
    canvasCtx.fillStyle = '#ffcc44';
    for (const decal of prefab.decals ?? []) {
      const sx = camera.worldToScreenX(cursorTileX + decal.dx, canvasW);
      const sy = camera.worldToScreenY(cursorTileY + decal.dy, canvasH);
      const r = Math.max(2, tileScreenSize * 0.12);
      canvasCtx.beginPath();
      canvasCtx.arc(sx, sy, r, 0, Math.PI * 2);
      canvasCtx.fill();
    }
    canvasCtx.globalAlpha = 1.0;

    // Border rectangle with dashed line
    // Y-axis: worldToScreenY(cursorTileY + height - 1) gives top-left screen Y (Y-up to Y-down)
    const screenX = camera.worldToScreenX(cursorTileX, canvasW);
    const screenY = camera.worldToScreenY(cursorTileY + prefab.height - 1, canvasH);
    const w = prefab.width * tileScreenSize;
    const h = prefab.height * tileScreenSize;

    canvasCtx.strokeStyle = '#44ff88';
    canvasCtx.lineWidth = 2;
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.strokeRect(screenX, screenY, w, h);
    canvasCtx.setLineDash([]);

    // Name + dimensions label above the border
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.font = '11px monospace';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(
      `${prefab.name} (${prefab.width}x${prefab.height})`,
      screenX + w / 2,
      screenY - 4,
    );
  }

  deactivate(): void {
    this.prefab = null;
  }
}
