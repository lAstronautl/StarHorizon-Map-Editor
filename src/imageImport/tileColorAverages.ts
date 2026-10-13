import type { IPrototypeRegistry } from '../loaders/registryTypes';
import { loadImage } from '../loaders/rsiLoader';
import { getActiveProvider } from '../loaders/resourceProvider';

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Average color of a tile's sprite (first variant only), ignoring fully transparent
 *  pixels so partially-transparent decorative tiles don't get dragged toward black —
 *  an intentional improvement over map-converter-ss14's AvarageColor, which included
 *  every pixel including fully transparent ones. */
export function computeAverageTileColor(img: HTMLImageElement, variants: number): RgbaColor | null {
  const srcSize = img.width / Math.max(1, variants);
  const canvas = document.createElement('canvas');
  canvas.width = srcSize;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, srcSize, img.height, 0, 0, srcSize, img.height);

  const { data } = ctx.getImageData(0, 0, srcSize, img.height);
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    a += data[i + 3];
    n++;
  }
  if (n === 0) return null;
  return { r: r / n, g: g / n, b: b / n, a: a / n };
}

export function hexToRgba(hex: string): RgbaColor {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 255;
  return { r, g, b, a };
}

function euclideanDistance(a: RgbaColor, b: RgbaColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2 + (a.a - b.a) ** 2);
}

/** Port of map-converter-ss14's FindClosestColor: picks the tile whose average sprite
 *  color is closest (Euclidean RGBA distance) to the target pixel color. */
export function findClosestTileByColor(targetHex: string, tileColors: Map<string, RgbaColor>): string | null {
  const target = hexToRgba(targetHex);
  let closestId: string | null = null;
  let minDistance = Infinity;
  for (const [tileId, color] of tileColors) {
    const distance = euclideanDistance(target, color);
    if (distance < minDistance) {
      minDistance = distance;
      closestId = tileId;
    }
  }
  return closestId;
}

/** Builds the tileId -> average sprite color map for every tile in the registry that has
 *  a sprite, loading each sprite image via the active resource provider. Used lazily,
 *  once per session (call site is expected to cache the result), since it touches every
 *  tile prototype's image. */
export async function buildTileColorCache(registry: IPrototypeRegistry): Promise<Map<string, RgbaColor>> {
  const cache = new Map<string, RgbaColor>();
  const provider = getActiveProvider();

  await Promise.all(registry.getAllTiles().map(async (tile) => {
    if (!tile.sprite || tile.isSpace) return;
    const url = provider.getImageUrl(tile.sprite);
    if (!url) return;
    try {
      const img = await loadImage(url);
      const color = computeAverageTileColor(img, tile.variants);
      if (color) cache.set(tile.id, color);
    } catch {
      // Missing/broken sprite — just skip this tile, it won't be offered by autogenerate.
    }
  }));

  return cache;
}
