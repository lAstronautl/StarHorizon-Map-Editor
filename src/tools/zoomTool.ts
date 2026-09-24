import type { ITool, ToolContext } from './toolTypes';

const ZOOM_STEP = 1.25;

export class ZoomTool implements ITool {
  name = 'zoom';
  cursor = 'zoom-in';

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number) {
    const screenX = ctx.camera.worldToScreenX(tileX, ctx.canvasW);
    // worldToScreenY expects the tile's world Y and returns the screen Y of its top edge
    // (tileY + 1); undo that offset here since tileY is the point we want to zoom onto.
    const screenY = ctx.camera.worldToScreenY(tileY - 1, ctx.canvasH);
    const factor = button === 2 ? 1 / ZOOM_STEP : ZOOM_STEP;
    ctx.camera.zoomAt(factor, screenX, screenY, ctx.canvasW, ctx.canvasH);
  }

  onMouseMove() {}
  onMouseUp() {}
}
