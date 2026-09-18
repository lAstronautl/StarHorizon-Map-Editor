import { describe, it, expect } from 'vitest';
import { PaintTool } from '../paintTool';
import type { ToolContext } from '../toolTypes';
import { createInitialState, ensureGridContainsBounds, getCell } from '../../state/editorState';
import type { ImportedEntity } from '../../import/mapImporter';

function makeToolContext(entities: ImportedEntity[] = [], paletteItem: ToolContext['paletteItem'] = { type: 'tile', id: 'Plating' }): { ctx: ToolContext; dispatched: any[] } {
  const state = createInitialState();
  state.grid = ensureGridContainsBounds(state.grid, 0, 0, 15, 15);
  state.grids[0].grid = state.grid;
  state.entities = [...entities];
  state.grids[0].entities = state.entities;
  state.nextEntityId = entities.length > 0 ? Math.max(...entities.map(e => e.uid)) + 1 : 1;
  state.selectedPaletteItem = paletteItem;

  const dispatched: any[] = [];
  const ctx: ToolContext = {
    state,
    dispatch: (action: any) => {
      dispatched.push(action);
      if (action.type === 'APPLY_COMMAND') {
        for (const ec of action.command.entityChanges) {
          if (ec.action === 'add') {
            state.entities.push(ec.entity);
            if (ec.entity.uid >= state.nextEntityId) state.nextEntityId = ec.entity.uid + 1;
          }
          if (ec.action === 'remove') {
            const idx = state.entities.findIndex((e: ImportedEntity) => e.uid === ec.entity.uid);
            if (idx >= 0) state.entities.splice(idx, 1);
          }
        }
        for (const tc of action.command.tileChanges) {
          const lx = tc.x - state.grid.offsetX, ly = tc.y - state.grid.offsetY;
          state.grid.cells[ly * state.grid.width + lx] = tc.after;
        }
      }
    },
    camera: { tileScreenSize: 32, worldToScreenX: (x: number) => x * 32, worldToScreenY: (y: number) => y * 32 } as any,
    canvasW: 800,
    canvasH: 600,
    paletteItem,
    shiftHeld: false,
    ctrlHeld: false,
  };
  return { ctx, dispatched };
}

describe('PaintTool merged with entity placement', () => {
  it('still paints tiles along a drag as before (tile palette item)', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'tile', id: 'FloorSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 6, 5);
    tool.onMouseUp(ctx);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].command.tileChanges.length).toBeGreaterThanOrEqual(2);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('FloorSteel');
    expect(getCell(ctx.state.grid, 6, 5)?.tileId).toBe('FloorSteel');
  });

  it('places one entity per click via the internal entityPlaceTool (not drag-per-tile)', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'entity', id: 'TableSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 0);

    expect(dispatched).toHaveLength(1);
    const added = dispatched[0].command.entityChanges.filter((c: any) => c.action === 'add');
    expect(added).toHaveLength(1);
    expect(added[0].entity.prototype).toBe('TableSteel');
    expect(added[0].entity.position).toEqual({ x: 5.5, y: 5.5 });
  });

  it('applies the entityPlaceTool rotation state when placing', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'entity', id: 'AirlockGlass' });
    const tool = new PaintTool();

    tool.entityPlaceTool.cycleRotation('cw');
    tool.onMouseDown(ctx, 0, 0, 0);

    const added = dispatched[0].command.entityChanges[0];
    // cycleRotation('cw') applies -pi/2, normalized into [0, 2pi) as 3pi/2.
    expect(added.entity.rotation).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('erases the entity under the cursor on right-click', () => {
    const existing: ImportedEntity = {
      uid: 100, prototype: 'TableSteel', position: { x: 5.5, y: 5.5 }, rotation: 0, components: [],
    };
    const { ctx, dispatched } = makeToolContext([existing], { type: 'entity', id: 'TableSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 2);

    expect(ctx.state.entities).toHaveLength(0);
    const removed = dispatched[0].command.entityChanges.find((c: any) => c.action === 'remove');
    expect(removed.entity.uid).toBe(100);
  });

  it('does not erase entities of a different prototype on right-click', () => {
    const existing: ImportedEntity = {
      uid: 100, prototype: 'ChairPilotSeat', position: { x: 5.5, y: 5.5 }, rotation: 0, components: [],
    };
    const { ctx, dispatched } = makeToolContext([existing], { type: 'entity', id: 'TableSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 2);

    expect(ctx.state.entities).toHaveLength(1);
    expect(dispatched).toHaveLength(0);
  });

  it('free-places at fractional coordinates when shiftHeld is true', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'entity', id: 'TableSteel' });
    ctx.shiftHeld = true;
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5.3, 5.7, 0);

    const added = dispatched[0].command.entityChanges[0];
    expect(added.entity.position).toEqual({ x: 5.3, y: 5.7 });
  });
});

describe('PaintTool deferred tile painting (ghost preview)', () => {
  it('does not mutate the grid while dragging, only on mouse-up', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'tile', id: 'FloorSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 6, 5);

    // Nothing committed yet: no dispatch, and the grid still reads the original tile.
    expect(dispatched).toHaveLength(0);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).not.toBe('FloorSteel');
    expect(getCell(ctx.state.grid, 6, 5)?.tileId).not.toBe('FloorSteel');

    tool.onMouseUp(ctx);

    // Now committed as a single command, and the grid reflects the result.
    expect(dispatched).toHaveLength(1);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('FloorSteel');
    expect(getCell(ctx.state.grid, 6, 5)?.tileId).toBe('FloorSteel');
  });

  it('does not mutate the grid while erasing, only on mouse-up', () => {
    const { ctx, dispatched } = makeToolContext([], { type: 'tile', id: 'FloorSteel' });
    const paintTool = new PaintTool();
    paintTool.onMouseDown(ctx, 5, 5, 0);
    paintTool.onMouseUp(ctx);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('FloorSteel');

    const eraseTool = new PaintTool();
    eraseTool.onMouseDown(ctx, 5, 5, 2);
    expect(dispatched).toHaveLength(1); // still just the paint from above
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('FloorSteel'); // not yet erased

    eraseTool.onMouseUp(ctx);
    expect(dispatched).toHaveLength(2);
    expect(getCell(ctx.state.grid, 5, 5)?.tileId).toBe('Space');
  });

  it('renderPreview draws a ghost tile for the pending change at the cursor', () => {
    const { ctx } = makeToolContext([], { type: 'tile', id: 'FloorSteel' });
    const tool = new PaintTool();
    const calls: string[] = [];
    const canvasCtx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      drawImage: () => calls.push('drawImage'),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
      set globalAlpha(_v: number) { calls.push('globalAlpha'); },
      set fillStyle(_v: string) { calls.push('fillStyle'); },
      set strokeStyle(_v: string) { calls.push('strokeStyle'); },
      set lineWidth(_v: number) { /* noop */ },
    } as unknown as CanvasRenderingContext2D;

    tool.renderPreview(canvasCtx, ctx, 5, 5);

    // A ghost fill/draw at reduced opacity must happen before the cursor outline is stroked.
    expect(calls).toContain('globalAlpha');
    expect(calls).toContain('strokeRect');
    expect(calls.indexOf('globalAlpha')).toBeLessThan(calls.indexOf('strokeRect'));
  });

  it('accumulates multiple pending tile changes visible to renderPreview during a drag', () => {
    const { ctx } = makeToolContext([], { type: 'tile', id: 'FloorSteel' });
    const tool = new PaintTool();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 6, 5);
    tool.onMouseMove(ctx, 7, 5);

    // Reach into the accumulated pending changes the same way renderPreview does.
    const pending = (tool as unknown as { tileChanges: { x: number; y: number; after: { tileId: string } }[] }).tileChanges;
    expect(pending.map(c => `${c.x},${c.y}`)).toEqual(['5,5', '6,5', '7,5']);
    expect(pending.every(c => c.after.tileId === 'FloorSteel')).toBe(true);
  });
});
