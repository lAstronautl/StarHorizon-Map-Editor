// src/algorithms/pipeDirections.ts
/**
 * Shared helpers for reading a pipe-carrying entity's effective cardinal
 * directions from its NodeContainer/PipeNode data, accounting for prototype
 * inheritance and entity rotation. Used by both the map validator and the
 * pipe-drawing tool's auto-fit, so they agree on what "connected" means.
 */
import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from '../loaders/registryTypes';

export const CARDINAL_DIRS = ['North', 'South', 'East', 'West'] as const;
export type CardinalDir = typeof CARDINAL_DIRS[number];

export const OPPOSITE_DIR: Record<CardinalDir, CardinalDir> = {
  North: 'South', South: 'North', East: 'West', West: 'East',
};

export const DIR_OFFSET: Record<CardinalDir, [number, number]> = {
  North: [0, 1], South: [0, -1], East: [1, 0], West: [-1, 0],
};

/** Named pipeDirection flag combos used by SS14 pipe prototypes (bend/tee/fourway/straight). */
export const PIPE_DIRECTION_FLAGS: Record<string, CardinalDir[]> = {
  North: ['North'], South: ['South'], East: ['East'], West: ['West'],
  Longitudinal: ['North', 'South'],
  Lateral: ['East', 'West'],
  NEBend: ['North', 'East'], NWBend: ['North', 'West'],
  SEBend: ['South', 'East'], SWBend: ['South', 'West'],
  TNorth: ['East', 'West', 'North'], TSouth: ['East', 'West', 'South'],
  TEast: ['North', 'South', 'East'], TWest: ['North', 'South', 'West'],
  Fourway: ['North', 'South', 'East', 'West'],
};

/** Get the merged component list for an entity: instance components override/extend prototype defaults. */
function getEffectiveComponents(entity: ImportedEntity, registry: IPrototypeRegistry): Record<string, unknown>[] {
  const byType = new Map<string, Record<string, unknown>>();
  const resolved = registry.getEntity(entity.prototype);
  if (resolved) {
    for (const c of resolved.components) byType.set((c as Record<string, unknown>).type as string, c as Record<string, unknown>);
  }
  for (const comp of entity.components) {
    const c = comp as Record<string, unknown>;
    byType.set(c.type as string, c);
  }
  return Array.from(byType.values());
}

/** Get the `nodes` map from an entity's NodeContainer component (instance falls back to prototype). */
function getNodeContainerNodes(entity: ImportedEntity, registry: IPrototypeRegistry): Record<string, unknown> | null {
  const components = getEffectiveComponents(entity, registry);
  const nc = components.find(c => c.type === 'NodeContainer');
  if (!nc || typeof nc.nodes !== 'object' || nc.nodes === null) return null;
  return nc.nodes as Record<string, unknown>;
}

/** All PipeNode-family nodes (nodeGroupID === 'Pipe') on an entity's NodeContainer. */
export function getPipeNodes(entity: ImportedEntity, registry: IPrototypeRegistry): Record<string, unknown>[] {
  const nodes = getNodeContainerNodes(entity, registry);
  if (!nodes) return [];
  const result: Record<string, unknown>[] = [];
  for (const node of Object.values(nodes)) {
    const n = node as Record<string, unknown>;
    if (n.nodeGroupID === 'Pipe') result.push(n);
  }
  return result;
}

/**
 * Rotate a set of cardinal directions by the entity's rotation (radians, multiple of 90deg).
 *
 * Must match the game's actual pipe rotation convention (RobustToolbox's Direction enum:
 * South=0, East=+90deg, North=180deg, West=270deg) applied via PipeDirectionHelpers
 * .RotatePipeDirection — the cycle South->East->North->West->South, NOT North->East->South->West.
 */
export function rotateDirs(dirs: CardinalDir[], rotationRad: number): CardinalDir[] {
  const steps = Math.round(rotationRad / (Math.PI / 2)) & 3;
  if (steps === 0) return dirs;
  const order: CardinalDir[] = ['South', 'East', 'North', 'West'];
  return dirs.map(d => order[(order.indexOf(d) + steps) % 4]);
}

/** Resolve a pipe-carrying node's effective cardinal directions, accounting for entity rotation. */
export function getPipeNodeDirections(entity: ImportedEntity, node: Record<string, unknown>): CardinalDir[] {
  const raw = node.pipeDirection;
  if (typeof raw !== 'string') return [];
  const parts = raw.split(/[,|]/).map(s => s.trim());
  const dirs = new Set<CardinalDir>();
  for (const part of parts) {
    const flags = PIPE_DIRECTION_FLAGS[part];
    if (flags) for (const f of flags) dirs.add(f);
    else if ((CARDINAL_DIRS as readonly string[]).includes(part)) dirs.add(part as CardinalDir);
  }
  return rotateDirs(Array.from(dirs), entity.rotation ?? 0);
}

/** Union of an entity's effective pipe-node directions across all of its PipeNode-family nodes. */
export function getEntityPipeDirections(entity: ImportedEntity, registry: IPrototypeRegistry): Set<CardinalDir> {
  const dirs = new Set<CardinalDir>();
  for (const node of getPipeNodes(entity, registry)) {
    for (const d of getPipeNodeDirections(entity, node)) dirs.add(d);
  }
  return dirs;
}
