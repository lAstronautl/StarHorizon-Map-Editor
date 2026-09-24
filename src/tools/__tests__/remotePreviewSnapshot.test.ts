import { describe, it, expect } from 'vitest';
import { PaintTool } from '../paintTool';
import { SelectTool } from '../selectTool';
import type { ToolContext } from '../toolTypes';
import { createInitialState, ensureGridContainsBounds } from '../../state/editorState';

function makeToolContext(paletteItem: ToolContext['paletteItem'] = { type: 'tile', id: 'Plating' }): ToolContext {
  const state = createInitialState();
  state.grid = ensureGridContainsBounds(state.grid, -16, -16, 15, 15);
  state.grids[0].grid = state.grid;
  state.selectedPaletteItem = paletteItem;

  return {
    state,
    dispatch: () => {},
    camera: { tileScreenSize: 32, worldToScreenX: (x: number) => x * 32, worldToScreenY: (y: number) => y * 32 } as any,
    canvasW: 800,
    canvasH: 600,
    paletteItem,
    shiftHeld: false,
    ctrlHeld: false,
  };
}

describe('PaintTool.getRemotePreviewSnapshot', () => {
  it('returns null when nothing is queued', () => {
    const tool = new PaintTool();
    expect(tool.getRemotePreviewSnapshot()).toBeNull();
  });

  it('returns the queued tile changes mid-drag', () => {
    const tool = new PaintTool();
    const ctx = makeToolContext({ type: 'tile', id: 'FloorSteel' });
    tool.onMouseDown(ctx, 0, 0, 0);
    tool.onMouseMove(ctx, 1, 0);

    const snapshot = tool.getRemotePreviewSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tool).toBe('paint');
    expect(snapshot!.tileChanges.length).toBeGreaterThan(0);
  });

  it('clears after mouse-up (committed, nothing left to preview)', () => {
    const tool = new PaintTool();
    const ctx = makeToolContext({ type: 'tile', id: 'FloorSteel' });
    tool.onMouseDown(ctx, 0, 0, 0);
    tool.onMouseUp(ctx);
    expect(tool.getRemotePreviewSnapshot()).toBeNull();
  });
});

describe('SelectTool.getRemotePreviewSnapshot', () => {
  it('returns null when idle', () => {
    const tool = new SelectTool();
    expect(tool.getRemotePreviewSnapshot()).toBeNull();
  });

  it('returns the in-progress marquee rectangle while selecting', () => {
    const tool = new SelectTool();
    const ctx = makeToolContext();
    tool.onMouseDown(ctx, 2, 3, 0);
    tool.onMouseMove(ctx, 5, 7);

    const snapshot = tool.getRemotePreviewSnapshot();
    expect(snapshot).toEqual({ tool: 'select', phase: 'selecting', minX: 2, minY: 3, maxX: 5, maxY: 7 });
  });

  it('clears after mouse-up commits the selection', () => {
    const tool = new SelectTool();
    const ctx = makeToolContext();
    tool.onMouseDown(ctx, 2, 3, 0);
    tool.onMouseMove(ctx, 5, 7);
    tool.onMouseUp(ctx);
    expect(tool.getRemotePreviewSnapshot()).toBeNull();
  });
});
