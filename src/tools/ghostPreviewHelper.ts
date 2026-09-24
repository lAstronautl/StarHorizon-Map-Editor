/**
 * Shared "ghost preview" drawing helpers — a semi-transparent rendering of what a
 * placement/paint tool is about to commit, used by both entityPlaceTool (entity sprites,
 * optionally rotated) and paintTool (tile textures). Keeping the actual canvas calls in
 * one place means both tools render ghosts the same way instead of duplicating the
 * save/globalAlpha/restore dance with slightly different details.
 */

export interface GhostImageSource {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Draw an image ghost at reduced opacity, optionally rotated around the tile's center.
 * `rotationRad`/`needsCanvasRotation` mirror the real entity renderer's convention
 * (canvas rotation is the negative of the world rotation — see entityRenderer.ts).
 */
export function drawImageGhost(
  ctx: CanvasRenderingContext2D,
  source: GhostImageSource,
  screenX: number,
  screenY: number,
  tileScreenSize: number,
  opacity: number,
  rotationRad = 0,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  if (rotationRad !== 0) {
    const cx = screenX + tileScreenSize / 2;
    const cy = screenY + tileScreenSize / 2;
    ctx.translate(cx, cy);
    ctx.rotate(-rotationRad);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(
    source.image,
    source.sx, source.sy, source.sw, source.sh,
    screenX, screenY, tileScreenSize, tileScreenSize,
  );
  ctx.restore();
}

/** Solid-color ghost fill, used as a fallback when no texture/sprite is available yet. */
export function drawFillGhost(
  ctx: CanvasRenderingContext2D,
  color: string,
  screenX: number,
  screenY: number,
  tileScreenSize: number,
  opacity: number,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(screenX, screenY, tileScreenSize, tileScreenSize);
  ctx.restore();
}

/** Dashed outline ghost — used as a fallback when no texture/sprite is available at all. */
export function drawOutlineGhost(
  ctx: CanvasRenderingContext2D,
  color: string,
  screenX: number,
  screenY: number,
  tileScreenSize: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(screenX, screenY, tileScreenSize, tileScreenSize);
  ctx.setLineDash([]);
}
