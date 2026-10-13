import React, { useRef, useEffect, useCallback } from 'react';

/** Minimal shared pan/zoom state for a pair of synced preview canvases — a lighter
 *  stand-in for the main editor's `Camera` (src/rendering/camera.ts), which is wired into
 *  a global dirty-flag redraw loop this standalone preview doesn't need. `x`/`y` are the
 *  viewport center in source-image pixel space, `zoom` is screen-pixels-per-source-pixel. */
export interface PreviewCamera {
  x: number;
  y: number;
  zoom: number;
}

export function createPreviewCamera(): PreviewCamera {
  return { x: 0, y: 0, zoom: 1 };
}

/** Centers and scales the camera so the given image size fills most of a canvas of the
 *  given size — same idea as Camera.fitBounds, just in pixel- rather than tile-space. */
export function fitPreviewCamera(camera: PreviewCamera, imageW: number, imageH: number, canvasW: number, canvasH: number): void {
  camera.x = imageW / 2;
  camera.y = imageH / 2;
  if (imageW > 0 && imageH > 0 && canvasW > 0 && canvasH > 0) {
    camera.zoom = Math.min(canvasW / imageW, canvasH / imageH) * 0.9;
  }
}

interface Props {
  camera: PreviewCamera;
  /** Called after the camera object is mutated by a pan/zoom gesture, so the owner can
   *  trigger a redraw of both synced canvases (this component doesn't own React state —
   *  the camera is a plain mutable object shared between two instances). */
  onCameraChange: () => void;
  /** Draws the preview content into the given context, in source-image pixel space —
   *  the canvas's own transform already accounts for camera pan/zoom and DPR. */
  draw: (ctx: CanvasRenderingContext2D) => void;
  label: string;
}

/** A single pannable/zoomable preview surface. Two instances sharing the same `camera`
 *  object (and both calling `onCameraChange` into a redraw of each other) stay in sync,
 *  mirroring "одинаковое перемещение и приближение" between the source and result views. */
export const PreviewCanvas: React.FC<Props> = ({ camera, onCameraChange, draw, label }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;
    // World (source-pixel) space -> screen space: center the camera's (x, y) in the canvas.
    ctx.translate(cssW / 2 - camera.x * camera.zoom, cssH / 2 - camera.y * camera.zoom);
    ctx.scale(camera.zoom, camera.zoom);
    drawRef.current(ctx);
    ctx.restore();
  }, [camera]);

  useEffect(() => {
    render();
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(el);
    return () => observer.disconnect();
  }, [render]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldXBefore = (screenX - rect.width / 2) / camera.zoom + camera.x;
    const worldYBefore = (screenY - rect.height / 2) / camera.zoom + camera.y;

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    camera.zoom = Math.max(0.05, Math.min(50, camera.zoom * factor));

    camera.x = worldXBefore - (screenX - rect.width / 2) / camera.zoom;
    camera.y = worldYBefore - (screenY - rect.height / 2) / camera.zoom;
    onCameraChange();
  }, [camera, onCameraChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    onCameraChange();
  }, [camera, onCameraChange]);

  const stopPanning = useCallback(() => {
    isPanning.current = false;
  }, []);

  return (
    <div className="flex flex-col flex-1 min-w-0 gap-0.5">
      <span className="text-[10px] text-muted text-center">{label}</span>
      <div ref={containerRef} className="flex-1 min-h-0 bg-panel border border-subtle rounded-sm overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopPanning}
          onMouseLeave={stopPanning}
        />
      </div>
    </div>
  );
};
