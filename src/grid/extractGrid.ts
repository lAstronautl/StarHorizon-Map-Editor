/**
 * Cut a grid out of a selection: the selected tiles, everything standing on them and the decals
 * under them become a grid of their own, positioned in the map exactly where the selection was.
 *
 * Entities keep their uids (this is a move, or a save into a separate file, never a second copy
 * inside the same map), so every reference between them stays valid.
 */
import type { TileCell, TileGrid } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import type { DecalInstance } from '../import/decalParser';
import type { GridData } from '../state/gridData';
import { getCell } from '../state/editorState';
import { formatVector } from '../export/gridStructure';

export class EmptySelectionError extends Error {}

export interface ExtractGridInput {
  source: GridData;
  /** Selected tiles as "x,y" in the source grid's tile coordinates. */
  selectedTiles: ReadonlySet<string>;
  /** Uid of the new grid, free in the destination map/file. */
  gridUid: number;
  name: string;
}

export interface ExtractedGrid {
  gridData: GridData;
  /** Top-level entities taken from the source (their contained entities went along). */
  entities: ImportedEntity[];
  decals: DecalInstance[];
}

function parseKey(key: string): { x: number; y: number } {
  const comma = key.indexOf(',');
  return { x: parseInt(key.substring(0, comma), 10), y: parseInt(key.substring(comma + 1), 10) };
}

function rotationOf(components: readonly Record<string, unknown>[]): number {
  const rot = components.find(c => c.type === 'Transform')?.rot;
  if (typeof rot === 'number') return rot;
  const m = typeof rot === 'string' ? /^(-?[\d.eE+-]+)\s*rad$/.exec(rot.trim()) : null;
  return m ? parseFloat(m[1]) : 0;
}

function shiftTransform(components: Record<string, unknown>[], dx: number, dy: number, parent: number): Record<string, unknown>[] {
  return components.map(c => {
    if (c.type !== 'Transform') return { ...c };
    const [px, py] = typeof c.pos === 'string' ? c.pos.split(',').map(Number) : [0, 0];
    const moved: Record<string, unknown> = { ...c, parent };
    const x = (px || 0) - dx, y = (py || 0) - dy;
    if (x === 0 && y === 0) delete moved.pos; else moved.pos = formatVector(x, y);
    return moved;
  });
}

/** Source components with the new tile data, minus what describes the source grid's own contents. */
export function extractGridFromSelection(input: ExtractGridInput, sourceComponents: Record<string, unknown>[] = []): ExtractedGrid {
  const { source, selectedTiles, gridUid, name } = input;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const key of selectedTiles) {
    const { x, y } = parseKey(key);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) throw new EmptySelectionError('Nothing is selected');

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells: TileCell[] = Array.from({ length: width * height }, () => ({ tileId: 'Space' }));
  let filled = 0;
  for (const key of selectedTiles) {
    const { x, y } = parseKey(key);
    const cell = getCell(source.grid, x, y);
    if (!cell || cell.tileId === 'Space') continue;
    cells[(y - minY) * width + (x - minX)] = { ...cell };
    filled++;
  }
  if (filled === 0) throw new EmptySelectionError('The selection has no tiles');
  const grid: TileGrid = { width, height, offsetX: 0, offsetY: 0, cells };

  // Entities standing on the selected tiles, plus everything inside them.
  const taken: ImportedEntity[] = source.entities.filter(e =>
    selectedTiles.has(`${Math.floor(e.position.x)},${Math.floor(e.position.y)}`));
  const entities: ImportedEntity[] = taken.map(e => ({
    ...e,
    position: { x: e.position.x - minX, y: e.position.y - minY },
    components: shiftTransform(e.components, minX, minY, gridUid),
  }));

  const containedEntities: Record<number, ImportedEntity[]> = {};
  const queue = taken.map(e => e.uid);
  while (queue.length > 0) {
    const parent = queue.pop()!;
    const kids = source.containedEntities[parent];
    if (!kids) continue;
    containedEntities[parent] = kids.map(k => ({ ...k, components: k.components.map(c => ({ ...c })) }));
    for (const k of kids) queue.push(k.uid);
  }

  const decals: DecalInstance[] = source.decals.decals.filter(d =>
    selectedTiles.has(`${Math.floor(d.position.x)},${Math.floor(d.position.y)}`));
  const movedDecals = decals.map(d => ({ ...d, position: { x: d.position.x - minX, y: d.position.y - minY } }));

  // The cut-out sits where the selection was: the source grid's pose, shifted by the selection's corner.
  const rot = rotationOf(sourceComponents.length > 0 ? sourceComponents : source.structuralComponents);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const worldPosition = {
    x: source.worldPosition.x + cos * minX - sin * minY,
    y: source.worldPosition.y + sin * minX + cos * minY,
  };

  const components = (sourceComponents.length > 0 ? sourceComponents : source.structuralComponents)
    .map(c => JSON.parse(JSON.stringify(c)) as Record<string, unknown>);

  return {
    gridData: {
      gridUid,
      name,
      grid,
      entities,
      containedEntities,
      worldPosition,
      structuralComponents: components,
      chunkKeyOrder: [],
      decals: {
        decals: movedDecals,
        nextDecalId: movedDecals.reduce((max, d) => Math.max(max, d.id + 1), 0),
      },
    },
    entities: taken,
    decals,
  };
}
