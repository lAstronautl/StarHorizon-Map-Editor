import type { ITool, ToolContext } from './toolTypes';
import type { TileChange, EntityChange } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import { getCell, ensureGridContains, setCell } from '../state/editorState';
import { buildTransformComponent } from './entityHelpers';
import { spatialGetAt } from '../rendering/spatialIndex';
import { t } from '../i18n';

export class FillTool implements ITool {
  name = 'fill';
  cursor = 'crosshair';

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number) {
    if (button !== 0) return;
    const { state, paletteItem } = ctx;
    if (!paletteItem) return;

    if (paletteItem.type === 'entity') {
      this.fillEntities(ctx, tileX, tileY, paletteItem.id);
      return;
    }
    if (paletteItem.type !== 'tile') return;

    const cell = getCell(state.grid, tileX, tileY);
    if (!cell) return;

    const targetId = cell.tileId;
    if (targetId === paletteItem.id) return; // Already the same tile

    const changes: TileChange[] = [];
    const visited = new Set<string>();
    const queue: [number, number][] = [[tileX, tileY]];
    const MAX_FILL = 50_000; // Safety limit

    while (queue.length > 0 && changes.length < MAX_FILL) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const c = getCell(state.grid, x, y);
      if (!c || c.tileId !== targetId) continue;

      const before = { ...c };
      const after = { tileId: paletteItem.id };
      setCell(state.grid, x, y, after);
      changes.push({ x, y, before, after });

      // 4-directional neighbors
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    if (changes.length > 0) {
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label: t('fillTool.command.fillTiles'),
          tileChanges: changes,
          entityChanges: [],
        },
      });
    }
  }

  /**
   * Flood-fill a connected region of entities sharing the same prototype as the one
   * clicked, replacing each with the selected palette entity.
   */
  private fillEntities(ctx: ToolContext, tileX: number, tileY: number, prototypeId: string) {
    const { state } = ctx;
    const startX = Math.floor(tileX);
    const startY = Math.floor(tileY);

    const startEntities = spatialGetAt(startX, startY);
    if (startEntities.length === 0) return;

    const targetProto = startEntities[0].prototype;
    if (targetProto === prototypeId) return; // Already the target prototype

    const entityChanges: EntityChange[] = [];
    const visited = new Set<string>();
    const queue: [number, number][] = [[startX, startY]];
    const MAX_FILL = 50_000; // Safety limit
    let uid = state.nextEntityId;

    while (queue.length > 0 && entityChanges.length < MAX_FILL) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const here = spatialGetAt(x, y).find(e => e.prototype === targetProto);
      if (!here) continue;

      entityChanges.push({ action: 'remove', entity: here });

      const pos = { x: x + 0.5, y: y + 0.5 };
      const replacement: ImportedEntity = {
        uid: uid++,
        prototype: prototypeId,
        position: pos,
        rotation: 0,
        components: buildTransformComponent(pos, 0, state.gridUid),
      };
      entityChanges.push({ action: 'add', entity: replacement });

      // 4-directional neighbors
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    if (entityChanges.length > 0) {
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label: t('fillTool.command.fillTiles'),
          tileChanges: [],
          entityChanges,
        },
      });
    }
  }

  onMouseMove() {}
  onMouseUp() {}

  renderPreview(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ) {
    if (!toolCtx.paletteItem || (toolCtx.paletteItem.type !== 'tile' && toolCtx.paletteItem.type !== 'entity')) return;

    const { camera, canvasW, canvasH } = toolCtx;
    const tileScreenSize = camera.tileScreenSize;
    const drawX = camera.worldToScreenX(cursorTileX, canvasW);
    const drawY = camera.worldToScreenY(cursorTileY, canvasH);

    canvasCtx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    canvasCtx.fillRect(drawX, drawY, tileScreenSize, tileScreenSize);
    canvasCtx.strokeStyle = '#00ff88';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(drawX, drawY, tileScreenSize, tileScreenSize);
  }
}
