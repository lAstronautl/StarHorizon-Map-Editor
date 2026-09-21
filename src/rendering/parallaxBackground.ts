import type { Camera } from './camera';
import { getActiveProvider } from '../loaders/resourceProvider';
import { markSceneDirty } from './dirtyFlags';

/**
 * Space parallax background: a single tiled copy of the game's own layer1.png
 * (Resources/Textures/Parallaxes/layer1.png), loaded through the same
 * ResourceProvider as any other game texture — no procedural generation.
 *
 * Two earlier versions of this were wrong:
 *  - A from-scratch procedural star generator, then a faithful pixel-accurate
 *    port of the game's actual C# generator (Content.Client/Parallax/
 *    ParallaxGenerator.cs + its OpenSimplex2 noise). Both still didn't
 *    visually match real screenshots.
 *  - Checking the Godot reimplementation (Space-Station-Paper) explained why:
 *    it doesn't regenerate the star field either — it uses the exact same
 *    image (space_stars.png, a byte-identical copy of layer1.png) inside a
 *    `Parallax2D` node (Godot's built-in infinite-scroll parallax primitive):
 *      Parallax2D: scroll_scale=(0.3, 0.3), repeat_size=(480, 480), repeat_times=20
 *    `repeat_size` matches the source image's own pixel size exactly (plain
 *    tiling, no extra scale factor), and `scroll_scale` is the fraction of
 *    camera movement the layer tracks — this is the same shape of formula
 *    as SS14's own "slowness" (1 = camera-locked/appears distant, matches
 *    Parallax2D's scroll_scale=1 meaning "moves fully with the camera, i.e.
 *    looks stationary on screen" — the two conventions agree at both ends),
 *    just ported here as a direct value rather than SS14's own (much more
 *    subtle, 0.998) default.yml value, since Paper's tuning is the one that
 *    was actually confirmed to look right in a running client/screenshot.
 */

/** One parallax layer: a tiled canvas pattern plus how much it scrolls with the camera. */
export interface ParallaxLayer {
  canvas: HTMLCanvasElement;
  /** World-unit size of one tile of this layer's pattern (matches the game's
   *  texture.Size / PixelsPerMeter * scale). */
  worldSize: number;
  /** Fraction of camera movement this layer tracks: 1 = moves fully with the
   *  camera (looks screen-locked/very distant), 0 = fully world-locked (looks
   *  right up against the grid). Same shape of value as both SS14's own
   *  "slowness" field and Godot's Parallax2D.scroll_scale. */
  slowness: number;
}

/** Ported from Space-Station-Paper's mainRoom.tscn Parallax2D node
 *  (`scroll_scale = Vector2(0.3, 0.3)`) — see file header for why this value,
 *  not SS14's own default.yml slowness, is what's used here. */
export const PARALLAX_SLOWNESS = {
  base: 0.3,
} as const;

let cachedLayer1: HTMLImageElement | null = null;
let layer1Loading = false;

function loadLayer1(): void {
  if (layer1Loading || cachedLayer1) return;
  try {
    const url = getActiveProvider().getImageUrl('/Textures/Parallaxes/layer1.png');
    if (!url) return; // Not ready yet (e.g. RemoteResourceProvider fetching) — retry next call.
    layer1Loading = true;
    const img = new Image();
    img.onload = () => { cachedLayer1 = img; markSceneDirty(); };
    img.onerror = () => { layer1Loading = false; };
    img.src = url;
  } catch {
    // No active provider yet (registry still loading) — retry on the next call.
  }
}

/** Reset all cached/loaded state (for tests). */
export function resetParallaxBackground(): void {
  cachedLayer1 = null;
  layer1Loading = false;
  layer1AsCanvas = null;
  layer1AsCanvasSrc = null;
}

let layer1AsCanvas: HTMLCanvasElement | null = null;
let layer1AsCanvasSrc: HTMLImageElement | null = null;
function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  if (layer1AsCanvas && layer1AsCanvasSrc === img) return layer1AsCanvas;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  layer1AsCanvas = c;
  layer1AsCanvasSrc = img;
  return c;
}

/**
 * Get the current parallax layers. Returns null until layer1.png has loaded.
 */
export function getParallaxLayers(): ParallaxLayer[] | null {
  loadLayer1();
  if (!cachedLayer1) return null;

  const canvas = imageToCanvas(cachedLayer1);
  const worldSize = cachedLayer1.width / 32;

  return [
    { canvas, worldSize, slowness: PARALLAX_SLOWNESS.base },
  ];
}

/**
 * Compute a layer's wrapped screen-space tile offset for the given camera position,
 * per the game's parallax formula: scroll = cameraPos * slowness (world units),
 * converted to pixels and wrapped into [0, tileSizePx). Pure/DOM-free so it's
 * unit-testable without a canvas.
 */
export function computeParallaxOffset(
  cameraX: number,
  cameraY: number,
  slowness: number,
  tileScreenSize: number,
  tileSizePx: number,
): { x: number; y: number } {
  const scrollWorldX = cameraX * slowness;
  const scrollWorldY = cameraY * slowness;
  const x = ((-scrollWorldX * tileScreenSize) % tileSizePx + tileSizePx) % tileSizePx;
  const y = ((scrollWorldY * tileScreenSize) % tileSizePx + tileSizePx) % tileSizePx;
  return { x, y };
}

/**
 * Draw all parallax layers onto the canvas, tiled and offset per the game's
 * parallax formula: origin = (cameraPos) * slowness, snapped to the layer's
 * tile size and tiled across the visible area (painter's algorithm, back to
 * front — same draw order as the layers array).
 */
export function renderParallaxBackground(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): boolean {
  const layers = getParallaxLayers();
  if (!layers) return false;

  const tileScreenSize = camera.tileScreenSize;
  ctx.save();
  // The main canvas renders with imageSmoothingEnabled=false (crisp pixel-art tiles/
  // entities); layer1.png is a painted image, not pixel art, so it should scale
  // smoothly like any other background photo — turn smoothing back on just for
  // this layer, ctx.restore() below undoes it for whatever renders next.
  ctx.imageSmoothingEnabled = true;
  for (const layer of layers) {
    const sizePx = layer.worldSize * tileScreenSize;
    if (sizePx <= 0) continue;

    const offset = computeParallaxOffset(camera.x, camera.y, layer.slowness, tileScreenSize, sizePx);

    const startX = offset.x - sizePx;
    const startY = offset.y - sizePx;
    for (let x = startX; x < canvasW; x += sizePx) {
      for (let y = startY; y < canvasH; y += sizePx) {
        ctx.drawImage(layer.canvas, x, y, sizePx, sizePx);
      }
    }
  }
  ctx.restore();
  return true;
}
