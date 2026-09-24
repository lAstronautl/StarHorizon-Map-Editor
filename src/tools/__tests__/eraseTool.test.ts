import { describe, it, expect } from 'vitest';
import { EraseTool } from '../eraseTool';
import type { ToolContext } from '../toolTypes';
import { createInitialState, ensureGridContainsBounds, getCell, setCell } from '../../state/editorState';

function makeToolContext(): { ctx: ToolContext; dispatched: any[] } {
  const state = createInitialState();
  state.grid = ensureGridContainsBounds(state.grid, -16, -16, 15, 15);
  state.grids[0].grid = state.grid;
  for (let x = 5; x <= 7; x++) setCell(state.grid, x, 5, { tileId: 'FloorSteel' });

  const dispatched: any[] = [];
  const ctx: ToolContext = {
    state,
    dispatch: (action: any) => {
      dispatched.push(action);
      if (action.type === 'APPLY_COMMAND') {
        for (const tc of action.command.tileChanges) {
          const lx = tc.x - state.grid.offsetX, ly = tc.y - state.grid.offsetY;
          state.grid.cells[ly * state.grid.width + lx] = tc.after;
        }
      }
    },
    camera: { tileScreenSize: 32, worldToScreenX: (x: number) => x * 32, worldToScreenY: (y: number) => y * 32 } as any,
    canvasW: 800,
    canvasH: 600,
    paletteItem: null,
    shiftHeld: false,
    ctrlHeld: false,
  };
  return { ctx, dispatched };
}

describe('EraseTool', () => {
  it('erases tiles along a drag by default (hold mode)', () => {
    const { ctx, dispatched } = makeToolContext();
    const tool = new EraseTool();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 6, 5);
    tool.onMouseUp(ctx);

    expect(dispatched).toHaveLength(1);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('Space');
    expect(getCell(ctx.state.grid, 6, 5)?.tileId).toBe('Space');
  });

  it('with strokeMode "click", erases only the clicked tile and ignores drag movement', () => {
    const { ctx, dispatched } = makeToolContext();
    ctx.brushSettings = { strokeMode: 'click' };
    const tool = new EraseTool();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 6, 5);
    tool.onMouseMove(ctx, 7, 5);
    tool.onMouseUp(ctx);

    expect(dispatched).toHaveLength(1);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('Space');
    expect(getCell(ctx.state.grid, 6, 5)?.tileId).toBe('FloorSteel');
    expect(getCell(ctx.state.grid, 7, 5)?.tileId).toBe('FloorSteel');
  });
});
