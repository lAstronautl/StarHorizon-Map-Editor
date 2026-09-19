import type { TileGrid } from '../types';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import { loadImage } from '../loaders/rsiLoader';
import { getActiveProvider } from '../loaders/resourceProvider';
import { Camera } from './camera';
import { markSceneDirty } from './dirtyFlags';

const TILE_SIZE = 32;

/** Minimal fallback colors when no texture is available. */
const FALLBACK_COLORS: Record<string, string> = {
  Space: '#111122',
  fallback: '#555566',
  wall: '#3a3a4a',
};

/**
 * Tile image cache. Maps tile ID to loaded HTMLImageElement, or null if
 * loading failed / no sprite exists for that tile.
 */
const tileImageCache = new Map<string, HTMLImageElement | null>();

/** Clear the tile image cache (e.g., when switching maps or reloading). */
export function clearTileImageCache(): void {
  tileImageCache.clear();
}

/**
 * Retrieve a cached tile image synchronously.
 * If the image hasn't been requested yet, kicks off an async load and
 * returns null (the next render frame will pick it up once loaded).
 */
export function getTileImage(
  tileId: string,
  registry: IPrototypeRegistry,
): HTMLImageElement | null {
  if (tileImageCache.has(tileId)) return tileImageCache.get(tileId)!;

  const tile = registry.getTile(tileId);
  if (!tile || !tile.sprite) {
    tileImageCache.set(tileId, null);
    return null;
  }

  // Mark as loading (null placeholder) so we don't re-request
  tileImageCache.set(tileId, null);

  const provider = getActiveProvider();
  const url = provider.getImageUrl(tile.sprite);
  if (!url) {
    return null;
  }
  loadImage(url)
    .then((img) => {
      tileImageCache.set(tileId, img);
      markSceneDirty();
    })
    .catch(() => {
      tileImageCache.set(tileId, null);
    });

  return null;
}

/**
 * Get a simple fallback color for a tile when no texture is available.
 */
export function getFallbackColor(tileId: string): string {
  if (tileId === 'Space') return FALLBACK_COLORS.Space;
  if (tileId.startsWith('Wall')) return FALLBACK_COLORS.wall;
  return FALLBACK_COLORS.fallback;
}

/**
 * Render the tile grid onto a canvas.
 */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  grid: TileGrid,
  camera: Camera,
  canvasW: number,
  canvasH: number,
  registry: IPrototypeRegistry | null,
): void {
  // Clear tile layer (background drawn separately on main canvas)
  ctx.clearRect(0, 0, canvasW, canvasH);

  const tileScreenSize = camera.tileScreenSize;

  // Compute visible world-coordinate range for culling
  const topLeft = camera.screenToTile(0, 0, canvasW, canvasH);
  const bottomRight = camera.screenToTile(canvasW, canvasH, canvasW, canvasH);
  const visMinWorldX = Math.floor(Math.min(topLeft.x, bottomRight.x)) - 1;
  const visMaxWorldX = Math.ceil(Math.max(topLeft.x, bottomRight.x)) + 1;
  const visMinWorldY = Math.floor(Math.min(topLeft.y, bottomRight.y)) - 1;
  const visMaxWorldY = Math.ceil(Math.max(topLeft.y, bottomRight.y)) + 1;

  // Clamp to grid bounds (convert world to grid-local)
  const startX = Math.max(0, visMinWorldX - grid.offsetX);
  const endX = Math.min(grid.width, visMaxWorldX - grid.offsetX + 1);
  const startY = Math.max(0, visMinWorldY - grid.offsetY);
  const endY = Math.min(grid.height, visMaxWorldY - grid.offsetY + 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const cell = grid.cells[y * grid.width + x];
      if (!cell || cell.tileId === 'Space') continue;

      const worldX = x + grid.offsetX;
      const worldY = y + grid.offsetY;
      const drawX = camera.worldToScreenX(worldX, canvasW);
      const drawY = camera.worldToScreenY(worldY, canvasH);

      // Try to get a real texture from the registry
      const img = registry ? getTileImage(cell.tileId, registry) : null;

      if (img) {
        // Determine variant count from registry
        const tile = registry!.getTile(cell.tileId);
        const variants = tile ? tile.variants : 1;
        const variant = variants > 1
          ? ((x * 7 + y * 13) & 0x7fffffff) % variants
          : 0;
        const srcSize = img.width / variants;

        ctx.drawImage(
          img,
          variant * srcSize, 0, srcSize, img.height,
          drawX, drawY, tileScreenSize, tileScreenSize,
        );
      } else {
        // Fallback: solid color fill
        ctx.fillStyle = getFallbackColor(cell.tileId);
        ctx.fillRect(drawX, drawY, tileScreenSize, tileScreenSize);
      }
    }
  }
}
