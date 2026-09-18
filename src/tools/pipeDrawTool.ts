import type { ITool, ToolContext } from './toolTypes';
import type { ImportedEntity } from '../import/mapImporter';
import type { PipeType } from '../types';
import { PIPE_COLORS, getPipeDisplay } from '../types';
import { computePipeChanges, fitPipes, type PipeFamily, type PipeLayer } from '../algorithms/pipeFittings';
import { getEntityPipeDirections } from '../algorithms/pipeDirections';
import { buildTransformComponent } from './entityHelpers';
import { getEntitySprite, rotationToDirection } from '../rendering/entityRenderer';

/** Pipe prototypes that belong to gas pipe network */
const GAS_PIPE_PROTOTYPES = new Set([
  'GasPipeStraight', 'GasPipeBend', 'GasPipeTJunction', 'GasPipeFourway', 'GasPipeHalf',
  'GasPipeStraightAlt1', 'GasPipeBendAlt1', 'GasPipeTJunctionAlt1', 'GasPipeFourwayAlt1',
  'GasPipeStraightAlt2', 'GasPipeBendAlt2', 'GasPipeTJunctionAlt2', 'GasPipeFourwayAlt2',
]);

/** Pipe prototypes that belong to disposal network */
const DISPOSAL_PIPE_PROTOTYPES = new Set([
  'DisposalPipe', 'DisposalBend', 'DisposalJunction', 'DisposalYJunction',
  'DisposalJunctionFlipped', 'DisposalTrunk',
]);

/**
 * Determine which of the 3 overlapping gas pipe layers an entity belongs to.
 * The Alt1/Alt2 prototype families bake in Secondary/Tertiary in-game, so the
 * prototype name is authoritative; an explicit AtmosPipeLayers component (as used
 * to override the layer on single-port devices like vents/ports) takes precedence
 * when present. Defaults to Primary, matching the game's component default.
 */
function getEntityPipeLayer(entity: ImportedEntity): PipeLayer {
  for (const comp of entity.components) {
    const c = comp as Record<string, unknown>;
    if (c.type === 'AtmosPipeLayers' && typeof c.pipeLayer === 'string') {
      if (c.pipeLayer === 'Secondary' || c.pipeLayer === 'Tertiary') return c.pipeLayer;
      return 'Primary';
    }
  }
  if (entity.prototype.endsWith('Alt1')) return 'Secondary';
  if (entity.prototype.endsWith('Alt2')) return 'Tertiary';
  return 'Primary';
}

/**
 * Pipe draw tool, drag to lay pipe paths with auto-fitting on commit.
 *
 * On mouseup, collects existing pipe entities of the same network,
 * merges with new tile positions, runs the fitting algorithm on
 * affected tiles, and dispatches a command that removes old fittings
 * and adds new correctly-fitted ones.
 */
export class PipeDrawTool implements ITool {
  name = 'pipeDraw';
  cursor = 'crosshair';

  /** Set externally from infrastructure panel selection */
  pipeType: PipeType = 'supply';

  /** Set externally from infrastructure panel selection. Lets up to 3 independent gas
   *  pipe runs (Primary/Secondary/Tertiary) overlap the same tiles without cross-fitting.
   *  Disposal pipes ignore this (always Primary in-game). */
  pipeLayer: PipeLayer = 'Primary';

  /** Set externally from infrastructure panel selection. When present, overrides the
   *  supply/return default color for gas pipes — an arbitrary hex string that only
   *  connects to other pipes sharing that exact color. */
  customColor: string | undefined = undefined;

  private drawing = false;
  private visitedTiles: { x: number; y: number }[] = [];
  private visitedSet = new Set<string>();

  private get family(): PipeFamily {
    return this.pipeType === 'disposal' ? 'disposal' : 'gas';
  }

  private get color(): string | undefined {
    if (this.pipeType === 'disposal') return undefined;
    if (this.customColor) return this.customColor;
    if (this.pipeType === 'supply') return PIPE_COLORS.supply;
    if (this.pipeType === 'return') return PIPE_COLORS.return;
    return undefined;
  }

  private get prototypeSet(): Set<string> {
    return this.family === 'gas' ? GAS_PIPE_PROTOTYPES : DISPOSAL_PIPE_PROTOTYPES;
  }

  /** Disposal pipes have no in-game layer system; only gas pipes support Secondary/Tertiary. */
  private get effectiveLayer(): PipeLayer {
    return this.family === 'gas' ? this.pipeLayer : 'Primary';
  }

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number) {
    if (button === 2) {
      this.erasePipeAt(ctx, tileX, tileY);
      return;
    }
    if (button !== 0) return;
    this.drawing = true;
    this.visitedTiles = [];
    this.visitedSet.clear();
    this.hasLastTile = false;
    this.addTile(tileX, tileY);
  }

  onMouseMove(_ctx: ToolContext, tileX: number, tileY: number) {
    if (!this.drawing) return;
    this.addTile(tileX, tileY);
  }

  onMouseUp(ctx: ToolContext) {
    if (!this.drawing) return;
    this.drawing = false;

    if (this.visitedTiles.length === 0) return;

    // Collect existing pipe entities of the same network type
    // For gas pipes, also filter by color and layer to separate overlapping networks
    const existingPipes = this.getMatchingPipeEntities(ctx);

    const { removedUids, fittedPipes } = computePipeChanges(
      this.visitedTiles,
      existingPipes.map(e => ({
        uid: e.uid,
        x: Math.floor(e.position.x),
        y: Math.floor(e.position.y),
      })),
      this.family,
      this.color,
      this.effectiveLayer,
      this.getMatchingDevicePorts(ctx),
    );

    // Build entity changes
    const entityChanges: { action: 'add' | 'remove'; entity: ImportedEntity }[] = [];

    // Remove old entities that are being refitted
    for (const uid of removedUids) {
      const entity = ctx.state.entities.find(e => e.uid === uid);
      if (entity) {
        entityChanges.push({ action: 'remove', entity });
      }
    }

    // Add new fitted entities
    let nextUid = ctx.state.nextEntityId;
    const gridUid = ctx.state.gridUid;
    for (const pipe of fittedPipes) {
      const pos = { x: pipe.x + 0.5, y: pipe.y + 0.5 };
      const components: Record<string, unknown>[] = buildTransformComponent(pos, pipe.rotation, gridUid);
      if (pipe.color) {
        components.push({ type: 'AtmosPipeColor', color: pipe.color });
      }
      if (pipe.pipeLayer) {
        components.push({ type: 'AtmosPipeLayers', pipeLayer: pipe.pipeLayer });
      }
      const entity: ImportedEntity = {
        uid: nextUid++,
        prototype: pipe.prototype,
        position: pos,
        rotation: pipe.rotation,
        components,
      };
      entityChanges.push({ action: 'add', entity });
    }

    if (entityChanges.length > 0) {
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label: `Draw ${getPipeDisplay()[this.pipeType].label}`,
          tileChanges: [],
          entityChanges,
        },
      });
    }

    this.visitedTiles = [];
    this.visitedSet.clear();
  }

  renderPreview(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ) {
    const { camera, canvasW, canvasH } = toolCtx;
    const tileScreenSize = camera.tileScreenSize;
    const color = (this.pipeType !== 'disposal' && this.customColor)
      ? this.customColor.slice(0, 7) // strip alpha for the preview stroke/fill
      : getPipeDisplay()[this.pipeType].color;

    // Tiles to preview: the in-progress drag path, plus the tile under the cursor
    // (covers both "drawing" and "about to place a single pipe" states).
    const cursorTile = { x: Math.floor(cursorTileX), y: Math.floor(cursorTileY) };
    const previewTiles = this.drawing ? this.visitedTiles : [cursorTile];

    // Run the same auto-fit used on commit, against existing pipes/devices, so the
    // preview shows the real prototype/rotation the pipe will be placed with.
    const registry = toolCtx.state.registry;
    const existingPipes = this.getMatchingPipeEntities(toolCtx);
    const devicePorts = this.getMatchingDevicePorts(toolCtx);
    const { fittedPipes } = computePipeChanges(
      previewTiles,
      existingPipes.map(e => ({
        uid: e.uid,
        x: Math.floor(e.position.x),
        y: Math.floor(e.position.y),
      })),
      this.family,
      this.color,
      this.effectiveLayer,
      devicePorts,
    );
    // Only draw the tiles actually being placed, not refitted pre-existing neighbors.
    const previewKeys = new Set(previewTiles.map(t => `${t.x},${t.y}`));
    const toDraw = fittedPipes.filter(p => previewKeys.has(`${p.x},${p.y}`));

    canvasCtx.save();
    canvasCtx.globalAlpha = 0.6;
    for (const pipe of toDraw) {
      const sx = camera.worldToScreenX(pipe.x, canvasW);
      const sy = camera.worldToScreenY(pipe.y, canvasH);
      const sprite = registry ? getEntitySprite(pipe.prototype, rotationToDirection(pipe.rotation), registry) : null;

      if (sprite) {
        const needsRotation = pipe.rotation !== 0 && sprite.sh === sprite.image.height;
        if (needsRotation) {
          const cx = sx + tileScreenSize / 2;
          const cy = sy + tileScreenSize / 2;
          canvasCtx.save();
          canvasCtx.translate(cx, cy);
          canvasCtx.rotate(-pipe.rotation);
          canvasCtx.translate(-cx, -cy);
        }
        canvasCtx.drawImage(
          sprite.image,
          sprite.sx, sprite.sy, sprite.sw, sprite.sh,
          sx, sy, tileScreenSize, tileScreenSize,
        );
        if (needsRotation) canvasCtx.restore();
      } else {
        // Fallback while the sprite is still loading or unavailable.
        canvasCtx.fillStyle = color + '44';
        canvasCtx.strokeStyle = color;
        canvasCtx.lineWidth = 1;
        canvasCtx.fillRect(sx, sy, tileScreenSize, tileScreenSize);
        canvasCtx.strokeRect(sx, sy, tileScreenSize, tileScreenSize);
      }
    }
    canvasCtx.restore();

    // Cursor outline
    const drawX = camera.worldToScreenX(cursorTileX, canvasW);
    const drawY = camera.worldToScreenY(cursorTileY, canvasH);
    canvasCtx.strokeStyle = color;
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(drawX, drawY, tileScreenSize, tileScreenSize);
  }

  deactivate() {
    this.drawing = false;
    this.visitedTiles = [];
    this.visitedSet.clear();
    this.hasLastTile = false;
  }

  private lastTileX = 0;
  private lastTileY = 0;
  private hasLastTile = false;

  private addTile(x: number, y: number) {
    if (this.hasLastTile) {
      // Bresenham line interpolation to fill gaps from fast mouse movement
      this.interpolateTo(x, y);
    }
    this.addSingleTile(x, y);
    this.lastTileX = x;
    this.lastTileY = y;
    this.hasLastTile = true;
  }

  private addSingleTile(x: number, y: number) {
    const key = `${x},${y}`;
    if (this.visitedSet.has(key)) return;
    this.visitedSet.add(key);
    this.visitedTiles.push({ x, y });
  }

  /** Fill in skipped tiles between last position and (toX, toY). */
  private interpolateTo(toX: number, toY: number) {
    let x0 = this.lastTileX;
    let y0 = this.lastTileY;
    const dx = Math.abs(toX - x0);
    const dy = Math.abs(toY - y0);
    const sx = x0 < toX ? 1 : -1;
    const sy = y0 < toY ? 1 : -1;
    let err = dx - dy;

    while (x0 !== toX || y0 !== toY) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      // Don't add the final tile, addTile will add it
      if (x0 === toX && y0 === toY) break;
      this.addSingleTile(x0, y0);
    }
  }

  /**
   * Get existing pipe entities that belong to the same network.
   * For gas pipes, separates supply/return by AtmosPipeColor, and separates
   * up to 3 overlapping runs on the same tiles by pipe layer.
   */
  private getMatchingPipeEntities(ctx: ToolContext): ImportedEntity[] {
    const protos = this.prototypeSet;
    return ctx.state.entities.filter(e => {
      if (!protos.has(e.prototype)) return false;
      if (this.family === 'disposal') return true;

      if (getEntityPipeLayer(e) !== this.effectiveLayer) return false;

      // For gas pipes, match by color
      const entityColor = this.getEntityPipeColor(e);
      return entityColor === (this.color ?? null);
    });
  }

  private getEntityPipeColor(entity: ImportedEntity): string | null {
    for (const comp of entity.components) {
      const c = comp as Record<string, unknown>;
      if (c.type === 'AtmosPipeColor' && typeof c.color === 'string') {
        return c.color;
      }
    }
    return null;
  }

  /**
   * Same-network devices (vents/scrubbers/ports/etc — anything with a Pipe-network
   * NodeContainer that isn't itself a plain pipe segment prototype), mapped from tile
   * key to the world-cardinal directions their open port(s) face (post-rotation). Lets
   * `fitPipes` bend a drawn pipe toward a matching-color device the same way it would
   * toward another pipe, instead of only ever recognizing other pipe segments.
   */
  private getMatchingDevicePorts(ctx: ToolContext): Map<string, Set<'N' | 'S' | 'E' | 'W'>> {
    const result = new Map<string, Set<'N' | 'S' | 'E' | 'W'>>();
    if (this.family !== 'gas') return result; // disposal pipes have no devices in this scheme
    const registry = ctx.state.registry;
    if (!registry) return result;
    const protos = this.prototypeSet;

    for (const e of ctx.state.entities) {
      if (protos.has(e.prototype)) continue; // plain pipe segments are handled separately
      if (getEntityPipeLayer(e) !== this.effectiveLayer) continue;
      if (this.getEntityPipeColor(e) !== (this.color ?? null)) continue;

      const dirs = getEntityPipeDirections(e, registry);
      if (dirs.size === 0) continue;

      const key = `${Math.floor(e.position.x)},${Math.floor(e.position.y)}`;
      const mapped = new Set<'N' | 'S' | 'E' | 'W'>();
      for (const d of dirs) mapped.add(d[0] as 'N' | 'S' | 'E' | 'W');
      result.set(key, mapped);
    }
    return result;
  }

  private erasePipeAt(ctx: ToolContext, tileX: number, tileY: number) {
    // Only erase the currently-selected layer/network at this tile, so up to 3
    // overlapping gas pipe runs can be erased independently of one another.
    const matching = this.getMatchingPipeEntities(ctx);
    const toRemove = matching.filter(e =>
      Math.floor(e.position.x) === tileX &&
      Math.floor(e.position.y) === tileY,
    );
    if (toRemove.length === 0) return;

    // After removing, refit neighbors
    const remainingPipes = this.getMatchingPipeEntities(ctx)
      .filter(e => !toRemove.some(r => r.uid === e.uid));

    // Find neighbor positions that need refitting
    const entityChanges: { action: 'add' | 'remove'; entity: ImportedEntity }[] = [];
    for (const e of toRemove) {
      entityChanges.push({ action: 'remove', entity: e });
    }

    // Refit adjacent existing pipes
    const neighbors = new Set<string>();
    for (const e of toRemove) {
      const ex = Math.floor(e.position.x);
      const ey = Math.floor(e.position.y);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        neighbors.add(`${ex + dx},${ey + dy}`);
      }
    }

    // Build tile set of remaining pipes
    const allRemainingTiles = new Set<string>();
    for (const e of remainingPipes) {
      allRemainingTiles.add(`${Math.floor(e.position.x)},${Math.floor(e.position.y)}`);
    }

    if (allRemainingTiles.size > 0) {
      const allFitted = fitPipes(allRemainingTiles, this.family, this.color, this.effectiveLayer, this.getMatchingDevicePorts(ctx));

      // Only refit tiles that are neighbors of removed tiles
      let nextUid = ctx.state.nextEntityId;
      for (const pipe of allFitted) {
        const key = `${pipe.x},${pipe.y}`;
        if (!neighbors.has(key)) continue;

        // Remove old entity at this position
        const oldEntity = remainingPipes.find(e =>
          Math.floor(e.position.x) === pipe.x && Math.floor(e.position.y) === pipe.y,
        );
        if (oldEntity) {
          entityChanges.push({ action: 'remove', entity: oldEntity });
        }

        // Add new fitted entity
        const refitPos = { x: pipe.x + 0.5, y: pipe.y + 0.5 };
        const refitComps: Record<string, unknown>[] = buildTransformComponent(refitPos, pipe.rotation, ctx.state.gridUid);
        if (pipe.color) {
          refitComps.push({ type: 'AtmosPipeColor', color: pipe.color });
        }
        if (pipe.pipeLayer) {
          refitComps.push({ type: 'AtmosPipeLayers', pipeLayer: pipe.pipeLayer });
        }
        entityChanges.push({
          action: 'add',
          entity: {
            uid: nextUid++,
            prototype: pipe.prototype,
            position: refitPos,
            rotation: pipe.rotation,
            components: refitComps,
          },
        });
      }
    }

    if (entityChanges.length > 0) {
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label: `Erase ${getPipeDisplay()[this.pipeType].label}`,
          tileChanges: [],
          entityChanges,
        },
      });
    }
  }
}
