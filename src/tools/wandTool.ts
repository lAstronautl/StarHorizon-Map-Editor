import type { ITool, ToolContext } from './toolTypes';
import type { ImportedEntity } from '../import/mapImporter';
import { getCell } from '../state/editorState';
import { getEntitiesAtTile } from '../rendering/entityRenderer';
import { spatialGetAt } from '../rendering/spatialIndex';
import { filterVisibleEntities } from './entitySelectTool';
import type { SelectTool } from './selectTool';
import { markOverlayDirty } from '../rendering/dirtyFlags';

/** Safety limit for one click (a whole station is well below this). */
const MAX_REGION = 50_000;

type Mode = 'replace' | 'add' | 'subtract';

/**
 * Magic wand: one click selects everything "like" what was clicked.
 *
 * - Click on an entity: the entities of the same prototype, connected through neighbouring tiles.
 * - Click on a tile with no entity: the connected tiles of the same type.
 * - Alt: everywhere on the grid instead of only the connected region.
 * - Shift adds to the selection, Ctrl subtracts from it.
 *
 * The result lands in the Select tool (tiles) or the Entity Select tool (entities) and that tool
 * becomes active, so move, copy, delete and "Save as Grid" work on it right away.
 */
export class WandTool implements ITool {
  name = 'wand';
  cursor = 'crosshair';

  constructor(private readonly selectTool: SelectTool) {}

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number): void {
    if (button !== 0) return;
    const mode: Mode = ctx.ctrlHeld ? 'subtract' : ctx.shiftHeld ? 'add' : 'replace';
    const global = ctx.altHeld === true;

    const clicked = this.entityAt(ctx, tileX, tileY);
    if (clicked) {
      const uids = this.collectEntities(ctx, tileX, tileY, clicked.prototype, global);
      if (mode === 'replace') ctx.dispatch({ type: 'SELECT_ENTITY', uids });
      else if (mode === 'add') ctx.dispatch({ type: 'ADD_SELECT_ENTITIES', uids });
      else ctx.dispatch({ type: 'REMOVE_SELECT_ENTITIES', uids });
      ctx.dispatch({ type: 'SET_TOOL', tool: 'entitySelect' });
      markOverlayDirty();
      return;
    }

    const cell = getCell(ctx.state.grid, tileX, tileY);
    if (!cell || cell.tileId === 'Space') return; // nothing to grow from

    const tiles = this.collectTiles(ctx, tileX, tileY, cell.tileId, global);
    this.selectTool.applyTileSelection(tiles, mode);
    ctx.dispatch({ type: 'SET_TOOL', tool: 'select' });
    markOverlayDirty();
  }

  onMouseMove(): void {}

  onMouseUp(): void {}

  /** The topmost visible entity on the tile, or null. */
  private entityAt(ctx: ToolContext, x: number, y: number): ImportedEntity | null {
    const { state } = ctx;
    const atTile = state.registry
      ? getEntitiesAtTile(x, y, state.entities, state.registry)
      : spatialGetAt(x, y);
    const visible = state.registry ? filterVisibleEntities(atTile, ctx.layerVisibility, state.registry) : atTile;
    return visible[0] ?? null;
  }

  /** Uids of the entities with `prototype`: connected from (x, y), or every one on the grid. */
  private collectEntities(ctx: ToolContext, x: number, y: number, prototype: string, global: boolean): number[] {
    const { state } = ctx;
    const hasPrototype = (tx: number, ty: number): ImportedEntity[] =>
      spatialGetAt(tx, ty).filter(e => e.prototype === prototype);

    if (global) {
      return state.entities.filter(e => e.prototype === prototype).map(e => e.uid);
    }

    const uids = new Set<number>();
    const visited = new Set<string>();
    const queue: [number, number][] = [[x, y]];
    while (queue.length > 0 && uids.size < MAX_REGION) {
      const [cx, cy] = queue.pop()!;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const here = hasPrototype(cx, cy);
      if (here.length === 0) continue;
      for (const e of here) uids.add(e.uid);
      queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return [...uids];
  }

  /** Tiles of type `tileId`: connected from (x, y), or every one on the grid. */
  private collectTiles(ctx: ToolContext, x: number, y: number, tileId: string, global: boolean): Set<string> {
    const grid = ctx.state.grid;
    const tiles = new Set<string>();

    if (global) {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          if (grid.cells[row * grid.width + col].tileId === tileId) {
            tiles.add(`${grid.offsetX + col},${grid.offsetY + row}`);
          }
        }
      }
      return tiles;
    }

    const visited = new Set<string>();
    const queue: [number, number][] = [[x, y]];
    while (queue.length > 0 && tiles.size < MAX_REGION) {
      const [cx, cy] = queue.pop()!;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (getCell(grid, cx, cy)?.tileId !== tileId) continue;
      tiles.add(key);
      queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return tiles;
  }
}
