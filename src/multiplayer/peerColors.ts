/**
 * Fixed palette of contrast-friendly colors assigned deterministically by peerIndex.
 * A given peer keeps the same color for its cursor, selection ghosts, and paint
 * previews for the whole session, so other players can tell at a glance whose
 * edits they're looking at.
 */
const PEER_COLOR_PALETTE = [
  '#ff5555', // red
  '#55aaff', // blue
  '#55ff88', // green
  '#ffaa33', // orange
  '#cc66ff', // purple
  '#ffee55', // yellow
  '#ff77cc', // pink
  '#33dddd', // cyan
] as const;

/** Deterministic color for a given peer index, cycling through the palette. */
export function getPeerColor(peerIndex: number): string {
  return PEER_COLOR_PALETTE[peerIndex % PEER_COLOR_PALETTE.length];
}
