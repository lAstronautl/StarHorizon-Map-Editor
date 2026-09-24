import type { Camera } from './camera';
import type { RemotePresence } from '../multiplayer/roomSession';

/**
 * Draw other players' cursors and uncommitted tool previews (paint strokes, marquees)
 * as colored ghost overlays. Runs every frame regardless of local panning/space-hold,
 * unlike the local tool's own renderPreview — other players' work stays visible even
 * while the local user pans around.
 */
export function renderRemotePresence(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  canvasW: number,
  canvasH: number,
  presenceByPeerId: Record<string, RemotePresence>,
): void {
  const tileScreenSize = camera.tileScreenSize;

  for (const presence of Object.values(presenceByPeerId)) {
    const { color, preview } = presence;

    if (preview) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      if (preview.tool === 'paint') {
        ctx.fillStyle = color;
        for (const tc of preview.tileChanges) {
          const sx = camera.worldToScreenX(tc.x, canvasW);
          const sy = camera.worldToScreenY(tc.y, canvasH);
          ctx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
        }
      } else if (preview.tool === 'select') {
        const offsetX = preview.offsetX ?? 0;
        const offsetY = preview.offsetY ?? 0;
        const sx = camera.worldToScreenX(preview.minX + offsetX, canvasW);
        const sy = camera.worldToScreenY(preview.minY + offsetY, canvasH);
        const width = (preview.maxX - preview.minX + 1) * tileScreenSize;
        const height = (preview.maxY - preview.minY + 1) * tileScreenSize;
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, width, height);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, width, height);
      }
      ctx.restore();
    }

    if (presence.cursorTileX !== null && presence.cursorTileY !== null) {
      const sx = camera.worldToScreenX(presence.cursorTileX, canvasW);
      const sy = camera.worldToScreenY(presence.cursorTileY, canvasH);

      ctx.save();
      // Small pointer triangle, cursor's tip anchored at the cell's top-left corner.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + 14);
      ctx.lineTo(sx + 4, sy + 10);
      ctx.lineTo(sx + 8, sy + 16);
      ctx.lineTo(sx + 10, sy + 14);
      ctx.lineTo(sx + 6, sy + 8);
      ctx.lineTo(sx + 11, sy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Nickname label just below the pointer.
      ctx.font = '11px sans-serif';
      const labelX = sx + 12;
      const labelY = sy + 16;
      const textWidth = ctx.measureText(presence.name).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(labelX - 2, labelY - 1, textWidth + 4, 14);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(presence.name, labelX, labelY);
      ctx.restore();
    }
  }
}
