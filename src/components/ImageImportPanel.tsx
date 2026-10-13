import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import type { PrefabData } from '../prefab/prefabTypes';
import type { ColorAssignment } from '../imageImport/colorMapping';
import { createEmptyAssignment, buildPrefabFromColorGrid } from '../imageImport/colorMapping';
import { extractUniquePixelColors, extractPixelGrid, quantizeImageData, COLOR_LIMIT } from '../imageImport/pixelColors';
import type { PixelColorInfo, PixelGrid } from '../imageImport/pixelColors';
import { buildTileColorCache, findClosestTileByColor } from '../imageImport/tileColorAverages';
import type { RgbaColor } from '../imageImport/tileColorAverages';
import { getTileImage } from '../rendering/gridRenderer';
import { PreviewCanvas, createPreviewCamera, fitPreviewCamera } from './PreviewCanvas';
import type { PreviewCamera } from './PreviewCanvas';
import { useT } from '../i18n';

interface Props {
  registry: IPrototypeRegistry | null;
  /** Registers the converted prefab (as if imported/dropped) and switches to the Prefabs
   *  tab so the result is immediately visible there, instead of just handing back the
   *  PrefabData for silent selection. */
  onConverted: (data: PrefabData, filename: string, folder?: string) => void;
}

/** Converted images are grouped into their own prefab folder so they don't clutter the
 *  root list alongside manually imported/dropped prefabs. */
const CONVERTATION_FOLDER = 'convertation';

/** Caps how many entities can be stacked on a single pixel color — unbounded stacking has
 *  no real use case here and just makes the per-color row grow without limit. */
const MAX_ENTITIES_PER_COLOR = 3;

/** Small (not full-resolution) preview thumbnail, rendered as a data URL so it's cheap to
 *  keep around (no lingering blob: URL / object-URL leak to manage or forget to revoke). */
const PREVIEW_THUMBNAIL_SIZE = 64;

async function decodeImageFile(file: File): Promise<{ previewDataUrl: string; imageData: ImageData; sourceCanvas: HTMLCanvasElement }> {
  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  const scale = Math.min(1, PREVIEW_THUMBNAIL_SIZE / Math.max(img.width, img.height));
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = Math.max(1, Math.round(img.width * scale));
  thumbCanvas.height = Math.max(1, Math.round(img.height * scale));
  const thumbCtx = thumbCanvas.getContext('2d');
  if (thumbCtx) thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const previewDataUrl = thumbCtx ? thumbCanvas.toDataURL() : '';

  return { previewDataUrl, imageData, sourceCanvas: canvas };
}

export const ImageImportPanel: React.FC<Props> = ({ registry, onConverted }) => {
  const { t } = useT();
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [grid, setGrid] = useState<PixelGrid | null>(null);
  const [colors, setColors] = useState<PixelColorInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, ColorAssignment>>({});
  const [openSearchFor, setOpenSearchFor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [autogenBusy, setAutogenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [tooManyColorsCount, setTooManyColorsCount] = useState<number | null>(null);
  const [quantizeBusy, setQuantizeBusy] = useState(false);
  // Mirrors tileColorCacheRef into React state once loaded, purely so the result preview
  // (drawResult) re-renders with real tile colors instead of the source pixel color once
  // the cache becomes available — the ref alone wouldn't trigger a redraw.
  const [tileColorsReady, setTileColorsReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tileColorCacheRef = useRef<Map<string, RgbaColor> | null>(null);
  // Kept only for re-quantizing on demand (see handleReduceColors) — never rendered directly,
  // so it lives in a ref rather than state to avoid re-render churn on every load.
  const rawImageDataRef = useRef<ImageData | null>(null);
  const quantizeLevelsRef = useRef(256);
  // Full-resolution source image, used by the "Source" preview canvas to draw at any zoom
  // level (the small `previewUrl` thumbnail above is for the collapsed/header view only).
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // One shared camera object for both preview canvases — mutated directly by pan/zoom
  // gestures in either one (see PreviewCanvas), so panning/zooming one view moves both.
  const previewCameraRef = useRef<PreviewCamera>(createPreviewCamera());
  // Bumped on every camera mutation to force both PreviewCanvas instances to redraw —
  // the camera itself is a plain mutable object, not React state, so this is how its
  // changes get reflected without re-running pan/zoom through the render cycle.
  const [cameraTick, setCameraTick] = useState(0);
  const bumpCamera = useCallback(() => setCameraTick(t => t + 1), []);

  const tileIds = useMemo(() => {
    if (!registry) return [];
    return registry.getAllTiles().map(tl => tl.id).filter(id => id !== 'Space').sort();
  }, [registry]);

  const filteredTileIds = useMemo(() => {
    if (!searchQuery) return tileIds;
    const lower = searchQuery.toLowerCase();
    return tileIds.filter(id => id.toLowerCase().includes(lower));
  }, [tileIds, searchQuery]);

  /** Applies imageData to the panel's state, building the color list — the one expensive
   *  step whose cost scales with unique-color count, not pixel count. Rejects (via the
   *  too-many-colors warning) instead of rendering a mapping row per color when there are
   *  more than COLOR_LIMIT: a noisy 100x100 JPEG can easily have several thousand unique
   *  colors from lossy compression, and a React list that size is what actually caused the
   *  reported lag — not the pixel count itself. */
  const applyImageData = useCallback((imageData: ImageData) => {
    const uniqueColors = extractUniquePixelColors(imageData);
    if (uniqueColors.length > COLOR_LIMIT) {
      setTooManyColorsCount(uniqueColors.length);
      setGrid(null);
      setColors([]);
      return;
    }
    setTooManyColorsCount(null);
    setGrid(extractPixelGrid(imageData));
    setColors(uniqueColors.sort((a, b) => b.count - a.count));
    setAssignments({});
    setOpenSearchFor(null);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    quantizeLevelsRef.current = 256;
    try {
      const { previewDataUrl, imageData, sourceCanvas } = await decodeImageFile(file);
      setFileName(file.name);
      setPreviewUrl(previewDataUrl);
      rawImageDataRef.current = imageData;
      sourceCanvasRef.current = sourceCanvas;
      fitPreviewCamera(previewCameraRef.current, imageData.width, imageData.height, 400, 400);
      bumpCamera();
      applyImageData(imageData);
    } catch (err) {
      setError(t('imageImportPanel.loadFailed', { error: String(err instanceof Error ? err.message : err) }));
    }
  }, [t, applyImageData, bumpCamera]);

  /** Re-quantizes the original (unquantized) image to progressively fewer color levels
   *  until it's under COLOR_LIMIT, or gives up after a few steps rather than looping
   *  forever on a pathological image (e.g. pure noise). */
  const handleReduceColors = useCallback(() => {
    const raw = rawImageDataRef.current;
    if (!raw) return;
    setQuantizeBusy(true);
    setError(null);
    // Ceded to a microtask so the "reducing..." busy state actually paints before the
    // (synchronous, potentially slow-ish on a big image) quantize+recount work runs.
    setTimeout(() => {
      try {
        let levels = quantizeLevelsRef.current;
        let quantized = raw;
        let uniqueCount = Infinity;
        for (let attempt = 0; attempt < 6 && uniqueCount > COLOR_LIMIT; attempt++) {
          levels = Math.max(2, Math.floor(levels / 2));
          quantized = quantizeImageData(raw, levels);
          uniqueCount = extractUniquePixelColors(quantized).length;
        }
        quantizeLevelsRef.current = levels;
        applyImageData(quantized);
      } finally {
        setQuantizeBusy(false);
      }
    }, 0);
  }, [applyImageData]);

  /** Drop the loaded image entirely — the full-resolution pixel grid (width×height array
   *  of hex strings) is the heavy part and has no reason to stay in memory once the user is
   *  done or wants to start over; there was previously no way to release it at all. */
  const handleClear = useCallback(() => {
    setFileName(null);
    setPreviewUrl(null);
    setGrid(null);
    setColors([]);
    setAssignments({});
    setOpenSearchFor(null);
    setSearchQuery('');
    setError(null);
    setTooManyColorsCount(null);
    rawImageDataRef.current = null;
    sourceCanvasRef.current = null;
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const assignTile = useCallback((hex: string, tileId: string) => {
    setAssignments(prev => ({
      ...prev,
      [hex]: { ...(prev[hex] ?? createEmptyAssignment()), tileId },
    }));
    setOpenSearchFor(null);
    setSearchQuery('');
  }, []);

  const addEntitySlot = useCallback((hex: string) => {
    setAssignments(prev => {
      const current = prev[hex] ?? createEmptyAssignment();
      if (current.entityIds.length >= MAX_ENTITIES_PER_COLOR) return prev;
      return { ...prev, [hex]: { ...current, entityIds: [...current.entityIds, ''] } };
    });
  }, []);

  const updateEntitySlot = useCallback((hex: string, index: number, value: string) => {
    setAssignments(prev => {
      const current = prev[hex] ?? createEmptyAssignment();
      const next = [...current.entityIds];
      next[index] = value;
      return { ...prev, [hex]: { ...current, entityIds: next } };
    });
  }, []);

  const removeEntitySlot = useCallback((hex: string, index: number) => {
    setAssignments(prev => {
      const current = prev[hex] ?? createEmptyAssignment();
      return { ...prev, [hex]: { ...current, entityIds: current.entityIds.filter((_, i) => i !== index) } };
    });
  }, []);

  const handleAutogenerate = useCallback(async () => {
    if (!registry) return;
    setAutogenBusy(true);
    setError(null);
    try {
      if (!tileColorCacheRef.current) {
        tileColorCacheRef.current = await buildTileColorCache(registry);
        setTileColorsReady(true);
      }
      const cache = tileColorCacheRef.current;
      setAssignments(prev => {
        const next = { ...prev };
        for (const { hex } of colors) {
          if (next[hex]?.tileId) continue; // don't override an existing manual choice
          const tileId = findClosestTileByColor(hex, cache);
          if (tileId) next[hex] = { ...(next[hex] ?? createEmptyAssignment()), tileId };
        }
        return next;
      });
    } catch (err) {
      setError(t('imageImportPanel.autogenFailed', { error: String(err instanceof Error ? err.message : err) }));
    } finally {
      setAutogenBusy(false);
    }
  }, [registry, colors, t]);

  const handleConvert = useCallback(() => {
    if (!grid) return;
    const name = fileName ? fileName.replace(/\.[^.]+$/, '') : 'image-import';
    const prefab = buildPrefabFromColorGrid(grid, assignments, name);
    onConverted(prefab, `${name}.prefab.json`, CONVERTATION_FOLDER);
    // The heavy full-resolution pixel grid has done its job — drop it so it doesn't keep
    // sitting in memory once the result has been handed off to the Prefabs list.
    handleClear();
  }, [grid, assignments, fileName, onConverted, handleClear]);

  const mappedCount = colors.filter(c => assignments[c.hex]?.tileId || (assignments[c.hex]?.entityIds.length ?? 0) > 0).length;

  // Loads tile sprite colors as soon as there's something to preview, not just when
  // Autogenerate is clicked — otherwise a manually-chosen tile would show in its source
  // pixel color in the result preview instead of the actual tile's color until the user
  // happened to also run Autogenerate.
  useEffect(() => {
    if (!registry || !grid || tileColorCacheRef.current) return;
    let cancelled = false;
    buildTileColorCache(registry).then(cache => {
      if (cancelled) return;
      tileColorCacheRef.current = cache;
      setTileColorsReady(true);
    });
    return () => { cancelled = true; };
  }, [registry, grid]);

  const drawSource = useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    ctx.drawImage(canvas, 0, 0);
  }, []);

  // Renders what the converted prefab will actually look like — a tile cell draws the
  // actual tile sprite (same texture/cache the main map canvas uses, via getTileImage),
  // falling back to the tile's average sprite color (and finally the source pixel color)
  // only until the real sprite has finished loading. Entity slots show as a dot so it's
  // clear which cells will also spawn something on top of the tile.
  const drawResult = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!grid) return;
    const tileColors = tileColorCacheRef.current;
    let pendingSprite = false;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const hex = grid.pixels[y * grid.width + x];
        if (!hex) continue;
        const assignment = assignments[hex];
        if (!assignment) continue;
        if (assignment.tileId) {
          const img = registry ? getTileImage(assignment.tileId, registry) : null;
          if (img) {
            const tile = registry!.getTile(assignment.tileId);
            const srcSize = img.width / Math.max(1, tile?.variants ?? 1);
            ctx.drawImage(img, 0, 0, srcSize, img.height, x, y, 1, 1);
          } else {
            pendingSprite = true;
            const tileColor = tileColors?.get(assignment.tileId);
            ctx.fillStyle = tileColor
              ? `rgba(${tileColor.r}, ${tileColor.g}, ${tileColor.b}, ${tileColor.a / 255})`
              : (hex.length >= 8 ? `#${hex.slice(1, 7)}` : hex);
            ctx.fillRect(x, y, 1, 1);
          }
        }
        if (assignment.entityIds.some(id => id.trim())) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + 0.25, y + 0.25, 0.5, 0.5);
        }
      }
    }
    // Tile sprites load asynchronously (getTileImage kicks off a fetch and returns null
    // the first time); since this preview isn't wired into the main canvas's redraw loop,
    // poll once more shortly after so newly-loaded sprites actually appear.
    if (pendingSprite) {
      window.setTimeout(() => bumpCamera(), 150);
    }
  }, [grid, assignments, tileColorsReady, registry, bumpCamera]);

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: 'rgba(30, 100, 220, 0.35)' }}
        >
          <div className="text-sm font-bold text-white text-center px-3" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}>
            {t('imageImportPanel.dropHint')}
          </div>
        </div>
      )}

      <div className="p-2 border-b border-subtle flex flex-col gap-2">
        <div className="flex gap-1.5">
          <button
            className="flex-1 min-w-0 px-2 py-1.5 bg-elevated border border-subtle rounded-sm text-primary text-xs cursor-pointer hover:bg-hover truncate"
            onClick={() => fileInputRef.current?.click()}
          >
            {fileName ? fileName : t('imageImportPanel.chooseImage')}
          </button>
          {fileName && (
            <button
              onClick={handleClear}
              title={t('imageImportPanel.clear')}
              className="px-2 py-1.5 bg-elevated border border-subtle rounded-sm text-muted hover:text-danger hover:bg-hover cursor-pointer"
            >
              &times;
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
        {!fileName && (
          <div className="text-[10px] text-muted text-center leading-relaxed">{t('imageImportPanel.dropHint')}</div>
        )}

        {previewUrl && grid && (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2 h-80">
              <PreviewCanvas
                camera={previewCameraRef.current}
                onCameraChange={bumpCamera}
                draw={drawSource}
                label={t('imageImportPanel.sourceLabel')}
              />
              <PreviewCanvas
                camera={previewCameraRef.current}
                onCameraChange={bumpCamera}
                draw={drawResult}
                label={t('imageImportPanel.resultLabel')}
              />
            </div>
            <div className="text-[11px] text-muted text-center">
              {t('imageImportPanel.dimensions', { width: grid.width, height: grid.height })}
              {' · '}
              {t('imageImportPanel.mappedCount', { mapped: mappedCount, total: colors.length })}
            </div>
          </div>
        )}

        {tooManyColorsCount !== null && (
          <div className="flex flex-col gap-1.5 bg-elevated border border-warning rounded-sm p-2">
            <div className="text-[11px] text-warning leading-snug">
              {t('imageImportPanel.tooManyColors', { count: tooManyColorsCount, limit: COLOR_LIMIT })}
            </div>
            <button
              onClick={handleReduceColors}
              disabled={quantizeBusy}
              className="px-2 py-1 bg-elevated border border-subtle rounded-sm text-primary text-[11px] cursor-pointer hover:bg-hover disabled:opacity-50"
            >
              {quantizeBusy ? t('imageImportPanel.reducingColors') : t('imageImportPanel.reduceColors')}
            </button>
          </div>
        )}

        {grid && (
          <div className="flex gap-1.5">
            <button
              onClick={handleAutogenerate}
              disabled={autogenBusy || !registry}
              className="flex-1 px-2 py-1 bg-elevated border border-subtle rounded-sm text-primary text-[11px] cursor-pointer hover:bg-hover disabled:opacity-50"
            >
              {autogenBusy ? t('imageImportPanel.autogenBusy') : t('imageImportPanel.autogenerate')}
            </button>
            <button
              onClick={handleConvert}
              className="flex-1 px-2 py-1 bg-accent text-white rounded-sm text-[11px] font-medium cursor-pointer hover:brightness-110 border-none"
            >
              {t('imageImportPanel.convert')}
            </button>
          </div>
        )}

        {error && <div className="text-[11px] text-danger">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {colors.map(({ hex, count }) => {
          const assignment = assignments[hex];
          const isOpen = openSearchFor === hex;
          return (
            <div key={hex} className="border-b border-subtle px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-4 h-4 rounded-sm border border-subtle shrink-0"
                  style={{ backgroundColor: hex.length >= 8 ? `#${hex.slice(1, 7)}` : hex }}
                  title={hex}
                />
                <span className="text-[10px] text-muted shrink-0 w-20 truncate">{hex}</span>
                <span className="text-[10px] text-muted shrink-0">&times;{count}</span>
                <input
                  type="text"
                  value={isOpen ? searchQuery : (assignment?.tileId ?? '')}
                  onFocus={() => { setOpenSearchFor(hex); setSearchQuery(''); }}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('imageImportPanel.tileSearchPlaceholder')}
                  className="flex-1 min-w-0 bg-elevated border border-subtle rounded-sm text-primary text-[11px] px-1.5 py-0.5"
                />
              </div>
              <div className="flex flex-col gap-1 mt-1">
                {(assignment?.entityIds ?? []).map((entityId, index) => (
                  <div key={index} className="flex gap-1">
                    <input
                      type="text"
                      value={entityId}
                      onChange={e => updateEntitySlot(hex, index, e.target.value)}
                      placeholder={t('imageImportPanel.entityIdPlaceholder')}
                      className="flex-1 min-w-0 bg-elevated border border-subtle rounded-sm text-primary text-[11px] px-1.5 py-0.5"
                    />
                    <button
                      onClick={() => removeEntitySlot(hex, index)}
                      title={t('imageImportPanel.removeEntity')}
                      className="px-1.5 bg-elevated border border-subtle rounded-sm text-muted hover:text-danger hover:bg-hover cursor-pointer text-[11px]"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {(assignment?.entityIds.length ?? 0) < MAX_ENTITIES_PER_COLOR && (
                  <button
                    onClick={() => addEntitySlot(hex)}
                    className="self-start px-2 py-0.5 bg-elevated border border-subtle rounded-sm text-primary text-[11px] cursor-pointer hover:bg-hover"
                  >
                    + {t('imageImportPanel.addEntity')}
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="mt-1 max-h-32 overflow-y-auto bg-panel border border-subtle rounded-sm">
                  {filteredTileIds.slice(0, 100).map(id => (
                    <div
                      key={id}
                      onMouseDown={() => assignTile(hex, id)}
                      className="px-2 py-1 text-[11px] text-primary cursor-pointer hover:bg-hover"
                    >
                      {id}
                    </div>
                  ))}
                  {filteredTileIds.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-muted italic">{t('common.noResults')}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
