import type { ITool, ToolContext } from './toolTypes';
import type { ImportedEntity } from '../import/mapImporter';
import type { CardinalDirection } from '../types';
import type { EntityChange } from '../types';
import { buildTransformComponent, normalizeRotation } from './entityHelpers';
import { getEntitySprite } from '../rendering/entityRenderer';
import { drawImageGhost, drawOutlineGhost } from './ghostPreviewHelper';
import { getSymmetricWorldPositions } from './symmetrySettings';

function rotToDir(rotation: number): CardinalDirection {
  const TWO_PI = 2 * Math.PI;
  const norm = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
  if (norm < Math.PI / 4 || norm >= 7 * Math.PI / 4) return 'south';
  if (norm < 3 * Math.PI / 4) return 'east';
  if (norm < 5 * Math.PI / 4) return 'north';
  return 'west';
}

export class EntityPlaceTool implements ITool {
  name = 'entityPlace';
  cursor = 'crosshair';

  private _rotation = 0;

  get currentRotation(): number {
    return this._rotation;
  }

  onMouseDown(ctx: ToolContext, tileX: number, tileY: number, button: number) {
    if (button !== 0) return;

    const { state, dispatch, shiftHeld } = ctx;
    if (!state.selectedPaletteItem || state.selectedPaletteItem.type !== 'entity') return;

    const protoId = state.selectedPaletteItem.id;

    // Free placement: use exact fractional coords; grid-snap: center of tile
    const pos = shiftHeld
      ? { x: tileX, y: tileY }
      : { x: Math.floor(tileX) + 0.5, y: Math.floor(tileY) + 0.5 };
    const rot = this.currentRotation;

    // Symmetry places one entity per mirrored position, all sharing the same rotation
    // (mirroring the rotation too would misrepresent directional entities like doors —
    // see symmetrySettings.ts for the reflection convention).
    const symmetry = ctx.symmetrySettings;
    const positions = symmetry ? getSymmetricWorldPositions(pos.x, pos.y, symmetry) : [pos];

    let uid = state.nextEntityId;
    const entityChanges: EntityChange[] = positions.map((p) => ({
      action: 'add',
      entity: {
        uid: uid++,
        prototype: protoId,
        position: p,
        rotation: rot,
        components: buildTransformComponent(p, rot, state.gridUid),
      },
    }));

    dispatch({
      type: 'APPLY_COMMAND',
      command: {
        label: `Place ${protoId}`,
        tileChanges: [],
        entityChanges,
      },
    });
  }

  onMouseMove() {}

  onMouseUp() {}

  renderPreview(
    canvasCtx: CanvasRenderingContext2D,
    toolCtx: ToolContext,
    cursorTileX: number,
    cursorTileY: number,
  ) {
    const { state, camera, canvasW, canvasH, shiftHeld } = toolCtx;
    if (!state.selectedPaletteItem || state.selectedPaletteItem.type !== 'entity') return;

    const tileScreenSize = camera.tileScreenSize;
    const protoId = state.selectedPaletteItem.id;
    const direction = rotToDir(this.currentRotation);

    // Center position under the cursor, same convention as onMouseDown, so mirrored
    // ghost positions line up exactly with where mirrored copies will actually land.
    const centerPos = shiftHeld
      ? { x: cursorTileX, y: cursorTileY }
      : { x: Math.floor(cursorTileX) + 0.5, y: Math.floor(cursorTileY) + 0.5 };
    const symmetry = toolCtx.symmetrySettings;
    const centers = symmetry ? getSymmetricWorldPositions(centerPos.x, centerPos.y, symmetry) : [centerPos];

    const sprite = state.registry ? getEntitySprite(protoId, direction, state.registry) : null;
    const needsRotation = this.currentRotation !== 0 && !!sprite && sprite.sh === sprite.image.height;

    for (const center of centers) {
      // In free mode, center sprite on cursor (position is entity center, draw from top-left)
      // In grid mode, draw at tile top-left (entity will be placed at tile center)
      const drawOriginX = shiftHeld ? center.x - 0.5 : Math.floor(center.x);
      const drawOriginY = shiftHeld ? center.y - 0.5 : Math.floor(center.y);
      const drawX = camera.worldToScreenX(drawOriginX, canvasW);
      const drawY = camera.worldToScreenY(drawOriginY, canvasH);

      if (sprite) {
        drawImageGhost(canvasCtx, sprite, drawX, drawY, tileScreenSize, 0.5, needsRotation ? this.currentRotation : 0);
      } else {
        drawOutlineGhost(canvasCtx, shiftHeld ? 'rgba(100, 200, 255, 0.6)' : 'rgba(0, 255, 100, 0.6)', drawX, drawY, tileScreenSize);
      }

      // Rotation indicator arrow
      if (this.currentRotation !== 0) {
        const cx = drawX + tileScreenSize / 2;
        const cy = drawY + tileScreenSize / 2;
        const arrowLen = tileScreenSize * 0.3;

        canvasCtx.save();
        canvasCtx.translate(cx, cy);
        canvasCtx.rotate(-this.currentRotation + Math.PI / 2);

        canvasCtx.strokeStyle = shiftHeld ? 'rgba(100, 200, 255, 0.8)' : 'rgba(0, 255, 100, 0.8)';
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, -arrowLen);
        canvasCtx.lineTo(0, arrowLen);
        canvasCtx.moveTo(-arrowLen * 0.4, arrowLen * 0.5);
        canvasCtx.lineTo(0, arrowLen);
        canvasCtx.lineTo(arrowLen * 0.4, arrowLen * 0.5);
        canvasCtx.stroke();

        canvasCtx.restore();
      }

      // Label
      if (tileScreenSize > 16) {
        canvasCtx.font = '10px sans-serif';
        canvasCtx.fillStyle = shiftHeld ? 'rgba(100, 200, 255, 0.8)' : 'rgba(0, 255, 100, 0.8)';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'top';
        const label = shiftHeld ? `${protoId} (free)` : protoId;
        canvasCtx.fillText(label, drawX + tileScreenSize / 2, drawY + tileScreenSize + 2);
      }
    }
  }

  /** Cycle placement rotation by 90° in the given direction (called from keyboard shortcut). */
  cycleRotation(direction: 'cw' | 'ccw' = 'cw') {
    const delta = direction === 'cw' ? -Math.PI / 2 : Math.PI / 2;
    this._rotation = normalizeRotation(this._rotation + delta);
  }

  /** Apply smooth fractional rotation (called from R + scroll). */
  smoothRotate(deltaRadians: number) {
    this._rotation = normalizeRotation(this._rotation + deltaRadians);
  }

  /** Reset rotation to default (0). Called when switching palette entities. */
  resetRotation() {
    this._rotation = 0;
  }

  deactivate() {
    this._rotation = 0;
  }
}
