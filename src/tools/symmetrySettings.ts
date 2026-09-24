/**
 * Symmetry/mirror painting settings, shared by tools that support it (currently
 * PaintTool). Mirrors are fixed through world coordinate 0 (X=0 for a vertical axis,
 * Y=0 for a horizontal axis) — not a user-draggable line, per the current scope.
 */

export type SymmetryMode = 'none' | 'mirror' | 'fourWay';
export type MirrorAxis = 'vertical' | 'horizontal';

export interface SymmetrySettings {
  mode: SymmetryMode;
  /** Which axis 'mirror' mode reflects across. Ignored by 'fourWay' (reflects both). */
  axis: MirrorAxis;
}

export const DEFAULT_SYMMETRY_SETTINGS: SymmetrySettings = {
  mode: 'none',
  axis: 'vertical',
};

/**
 * Compute the set of *tile-index* positions a paint/erase action at (x, y) should also
 * affect, given the current symmetry mode. Always includes the original (x, y) first,
 * followed by mirrored positions in a fixed order (dedup is the caller's job — e.g. by
 * placement order for undo, or via a visited-set to skip repaints of the same tile).
 *
 * Reflection is through world coordinate 0: a vertical mirror maps tile column x -> -1-x
 * (tile 0, spanning world [0,1), maps to tile -1, spanning [-1,0) — symmetric around the
 * X=0 grid line rather than colliding on a shared column 0); horizontal mirror maps the
 * row index y the same way. Use this for tile painting; for continuous world positions
 * (entity placement, including free/fractional placement) use getSymmetricWorldPositions
 * instead — the reflection formula differs because tile indices are discrete cells while
 * world coordinates are the continuous space those cells occupy.
 */
export function getSymmetricPositions(
  x: number,
  y: number,
  settings: SymmetrySettings,
): { x: number; y: number }[] {
  return computeSymmetricPositions(x, y, settings, (v) => -1 - v);
}

/**
 * Same as getSymmetricPositions, but for continuous world coordinates (e.g. an entity's
 * center position) rather than discrete tile indices. Reflection is mirror(p) = -p, which
 * correctly maps a tile-0-centered position (0.5) to the mirrored tile -1's center (-0.5)
 * — consistent with getSymmetricPositions' tile-index reflection of tile 0 -> tile -1.
 */
export function getSymmetricWorldPositions(
  x: number,
  y: number,
  settings: SymmetrySettings,
): { x: number; y: number }[] {
  return computeSymmetricPositions(x, y, settings, (v) => -v);
}

function computeSymmetricPositions(
  x: number,
  y: number,
  settings: SymmetrySettings,
  mirror: (v: number) => number,
): { x: number; y: number }[] {
  if (settings.mode === 'none') {
    return [{ x, y }];
  }

  if (settings.mode === 'mirror') {
    const mirrored = settings.axis === 'vertical'
      ? { x: mirror(x), y }
      : { x, y: mirror(y) };
    if (mirrored.x === x && mirrored.y === y) return [{ x, y }];
    return [{ x, y }, mirrored];
  }

  // fourWay: reflect across both axes, producing up to 4 distinct positions.
  const positions = [
    { x, y },
    { x: mirror(x), y },
    { x, y: mirror(y) },
    { x: mirror(x), y: mirror(y) },
  ];
  const seen = new Set<string>();
  return positions.filter(p => {
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
