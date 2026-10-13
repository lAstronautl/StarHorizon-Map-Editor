/** One unique pixel color found in an imported image, with how many pixels use it. */
export interface PixelColorInfo {
  /** "#rrggbbaa" hex, lowercase. */
  hex: string;
  count: number;
}

function toHex(r: number, g: number, b: number, a: number): string {
  const c = (n: number) => n.toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}${c(a)}`;
}

/**
 * Scans every pixel of a decoded image and returns the set of unique colors present,
 * each with how many pixels use it. Fully transparent pixels (alpha 0) are treated as
 * "no tile" (the SS14 map equivalent of Space) and excluded — they don't need a mapping
 * row of their own, mirroring how `map-converter-ss14` special-cases "#00000000".
 */
export function extractUniquePixelColors(imageData: ImageData): PixelColorInfo[] {
  const counts = new Map<string, number>();
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const hex = toHex(data[i], data[i + 1], data[i + 2], a);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].map(([hex, count]) => ({ hex, count }));
}

/** Full per-pixel color grid (row-major, including transparent pixels as `null`), used to
 *  rebuild the tile/entity layout once every color has a tile/entity assignment. */
export interface PixelGrid {
  width: number;
  height: number;
  /** `hex` per pixel in row-major order (top-to-bottom, left-to-right), or `null` for a
   *  fully transparent pixel. */
  pixels: (string | null)[];
}

export function extractPixelGrid(imageData: ImageData): PixelGrid {
  const { data, width, height } = imageData;
  const pixels: (string | null)[] = new Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    pixels[p] = a === 0 ? null : toHex(data[i], data[i + 1], data[i + 2], a);
  }
  return { width, height, pixels };
}

/** Above this many unique colors, the per-color mapping list (one row + inputs per color)
 *  gets slow to render and unwieldy to fill in by hand — photos/JPEGs routinely produce
 *  several thousand unique colors from a single 100x100 image due to lossy compression
 *  noise. Mirrors map-converter-ss14's own `colorsLimit` warning threshold. */
export const COLOR_LIMIT = 256;

/**
 * Reduces the number of distinct colors in an image by rounding each RGB channel down to
 * `levels` evenly-spaced steps (posterize) — a fast, dependency-free approximation of the
 * palette-reduction quantization map-converter-ss14 offers via Pillow's `Image.quantize`.
 * Alpha is left untouched (only fully-transparent-or-not matters for tile mapping).
 * `levels` must be >= 2; lower values merge more colors together more aggressively.
 */
export function quantizeImageData(imageData: ImageData, levels: number): ImageData {
  const step = 255 / (levels - 1);
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = Math.round(Math.round(data[i] / step) * step);
    out[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
    out[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
    out[i + 3] = data[i + 3];
  }
  return { data: out, width, height, colorSpace: imageData.colorSpace } as ImageData;
}
