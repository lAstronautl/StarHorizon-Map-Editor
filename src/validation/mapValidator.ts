// src/validation/mapValidator.ts
import type { TileGrid } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import { getCell } from '../state/editorState';
import { t } from '../i18n';

export interface ValidationIssue {
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  x: number;
  y: number;
  entityUid?: number;
}

interface ValidationRule {
  id: string;
  /** Returns the current-locale label; call at use-time, not at module load. */
  getLabel(): string;
  severity: 'error' | 'warning';
  run(grid: TileGrid, entities: ImportedEntity[], registry: IPrototypeRegistry): ValidationIssue[];
}

// ---- Helper functions ----

/** Get the tags from an entity's Tag component (instance or prototype). */
function getEntityTags(entity: ImportedEntity, registry: IPrototypeRegistry): string[] {
  // Check instance components first
  for (const comp of entity.components) {
    const c = comp as Record<string, unknown>;
    if (c.type === 'Tag' && Array.isArray(c.tags)) return c.tags as string[];
  }
  // Fall back to prototype definition
  const resolved = registry.getEntity(entity.prototype);
  if (resolved) {
    for (const c of resolved.components) {
      if (c.type === 'Tag' && Array.isArray((c as Record<string, unknown>).tags)) {
        return (c as Record<string, unknown>).tags as string[];
      }
    }
  }
  return [];
}

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

const CARDINAL_DIRS = ['North', 'South', 'East', 'West'] as const;
type CardinalDir = typeof CARDINAL_DIRS[number];
const OPPOSITE_DIR: Record<CardinalDir, CardinalDir> = {
  North: 'South', South: 'North', East: 'West', West: 'East',
};
const DIR_OFFSET: Record<CardinalDir, [number, number]> = {
  North: [0, 1], South: [0, -1], East: [1, 0], West: [-1, 0],
};

/** Named pipeDirection flag combos used by SS14 pipe prototypes (bend/tee/fourway/straight). */
const PIPE_DIRECTION_FLAGS: Record<string, CardinalDir[]> = {
  North: ['North'], South: ['South'], East: ['East'], West: ['West'],
  Longitudinal: ['North', 'South'],
  Lateral: ['East', 'West'],
  NEBend: ['North', 'East'], NWBend: ['North', 'West'],
  SEBend: ['South', 'East'], SWBend: ['South', 'West'],
  TNorth: ['East', 'West', 'North'], TSouth: ['East', 'West', 'South'],
  TEast: ['North', 'South', 'East'], TWest: ['North', 'South', 'West'],
  Fourway: ['North', 'South', 'East', 'West'],
};

/** Rotate a set of cardinal directions by the entity's rotation (radians, multiple of 90deg). */
function rotateDirs(dirs: CardinalDir[], rotationRad: number): CardinalDir[] {
  const steps = Math.round(rotationRad / (Math.PI / 2)) & 3;
  if (steps === 0) return dirs;
  const order: CardinalDir[] = ['North', 'East', 'South', 'West'];
  return dirs.map(d => order[(order.indexOf(d) + steps) % 4]);
}

/** Resolve a pipe-carrying node's effective cardinal directions, accounting for entity rotation. */
function getPipeNodeDirections(entity: ImportedEntity, node: Record<string, unknown>): CardinalDir[] {
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

/** Power node group IDs (from NodeContainer nodes) an entity exposes, e.g. ["MVPower", "Apc"]. */
function getPowerNodeGroups(entity: ImportedEntity, registry: IPrototypeRegistry): string[] {
  const nodes = getNodeContainerNodes(entity, registry);
  if (!nodes) return [];
  const groups: string[] = [];
  for (const node of Object.values(nodes)) {
    const n = node as Record<string, unknown>;
    if (typeof n.nodeGroupID === 'string' && (n.nodeGroupID === 'HVPower' || n.nodeGroupID === 'MVPower' || n.nodeGroupID === 'Apc')) {
      groups.push(n.nodeGroupID);
    }
  }
  return groups;
}

/** Whether the entity's NodeContainer has at least one PipeNode-family node (Pipe network). */
function getPipeNodes(entity: ImportedEntity, registry: IPrototypeRegistry): Record<string, unknown>[] {
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
 * Wall prototypes that are allowed to have any tile underneath.
 * Matches AllowedWalls in the game's MapWallFloorTests.cs.
 * These inherit the "Wall" tag but are not structural walls.
 */
const ALLOWED_WALLS = new Set([
  'AsteroidRock',
  'AsteroidRockArtifactFragment',
  'AsteroidRockBananium',
  'AsteroidRockBananiumCrab',
  'AsteroidRockBluespace',
  'AsteroidRockCoal',
  'AsteroidRockCoalCrab',
  'AsteroidRockDiamond',
  'AsteroidRockGibtonite',
  'AsteroidRockGold',
  'AsteroidRockGoldCrab',
  'AsteroidRockTin',
  'AsteroidRockTinCrab',
  'AsteroidRockPlasma',
  'AsteroidRockQuartz',
  'AsteroidRockQuartzCrab',
  'AsteroidRockSalt',
  'AsteroidRockSilver',
  'AsteroidRockSilverCrab',
  'AsteroidRockUranium',
  'AsteroidRockUraniumCrab',
  'AsteroidRockMining',
  'WoodenSupportWall',
  'WoodenSupportWallBroken',
  'SolidSecretDoor',
]);

/**
 * Check if an entity is a wall using the Tag system, matching the game's
 * MapWallFloorTests.cs logic: has "Wall" tag, NOT "Diagonal" tag, NOT in AllowedWalls.
 */
function isWallEntity(entity: ImportedEntity, registry: IPrototypeRegistry): boolean {
  if (ALLOWED_WALLS.has(entity.prototype)) return false;
  const tags = getEntityTags(entity, registry);
  return tags.includes('Wall') && !tags.includes('Diagonal');
}

function isDoorEntity(prototype: string): boolean {
  return prototype.includes('Airlock') || prototype.includes('Firelock');
}

const ALLOWED_WALL_TILES = new Set(['Plating', 'Lattice', 'Space']);

// ---- Rules ----

const floorUnderWallRule: ValidationRule = {
  id: 'floor-under-wall',
  getLabel: () => t('mapValidator.rules.floorUnderWall'),
  severity: 'warning',
  run(grid, entities, registry) {
    const issues: ValidationIssue[] = [];
    for (const entity of entities) {
      if (!isWallEntity(entity, registry)) continue;
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      const cell = getCell(grid, x, y);
      if (cell && !ALLOWED_WALL_TILES.has(cell.tileId)) {
        issues.push({
          ruleId: 'floor-under-wall', severity: 'warning',
          message: t('mapValidator.issues.floorUnderWall', { tile: cell.tileId, x, y }),
          x, y, entityUid: entity.uid,
        });
      }
    }
    return issues;
  },
};

const doorWithoutFloorRule: ValidationRule = {
  id: 'door-without-floor',
  getLabel: () => t('mapValidator.rules.doorWithoutFloor'),
  severity: 'warning',
  run(grid, entities) {
    const issues: ValidationIssue[] = [];
    const NO_FLOOR_TILES = new Set(['Space', 'Lattice']);
    for (const entity of entities) {
      if (!isDoorEntity(entity.prototype)) continue;
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      const cell = getCell(grid, x, y);
      if (!cell || NO_FLOOR_TILES.has(cell.tileId)) {
        issues.push({
          ruleId: 'door-without-floor', severity: 'warning',
          message: t('mapValidator.issues.doorWithoutFloor', { prototype: entity.prototype, x, y }),
          x, y, entityUid: entity.uid,
        });
      }
    }
    return issues;
  },
};

const danglingDeviceRefRule: ValidationRule = {
  id: 'dangling-device-ref',
  getLabel: () => t('mapValidator.rules.danglingDeviceRef'),
  severity: 'error',
  run(_grid, entities) {
    const issues: ValidationIssue[] = [];
    const validUids = new Set(entities.map(e => e.uid));

    for (const entity of entities) {
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      for (const comp of entity.components) {
        const c = comp as Record<string, unknown>;

        if (c.type === 'DeviceList' && Array.isArray(c.devices)) {
          for (const uid of c.devices as number[]) {
            if (!validUids.has(uid)) {
              issues.push({
                ruleId: 'dangling-device-ref', severity: 'error',
                message: t('mapValidator.issues.danglingDeviceRefDeviceList', { prototype: entity.prototype, uid: entity.uid, targetUid: uid }),
                x, y, entityUid: entity.uid,
              });
            }
          }
        }

        if (c.type === 'DeviceLinkSource' && c.linkedPorts && typeof c.linkedPorts === 'object') {
          for (const uidStr of Object.keys(c.linkedPorts as Record<string, unknown>)) {
            const uid = parseInt(uidStr, 10);
            if (!isNaN(uid) && !validUids.has(uid)) {
              issues.push({
                ruleId: 'dangling-device-ref', severity: 'error',
                message: t('mapValidator.issues.danglingDeviceRefLinkSource', { prototype: entity.prototype, uid: entity.uid, targetUid: uid }),
                x, y, entityUid: entity.uid,
              });
            }
          }
        }

        if (c.type === 'DeviceNetwork' && Array.isArray(c.deviceLists)) {
          for (const uid of c.deviceLists as number[]) {
            if (!validUids.has(uid)) {
              issues.push({
                ruleId: 'dangling-device-ref', severity: 'error',
                message: t('mapValidator.issues.danglingDeviceRefNetwork', { prototype: entity.prototype, uid: entity.uid, targetUid: uid }),
                x, y, entityUid: entity.uid,
              });
            }
          }
        }
      }
    }
    return issues;
  },
};

function makeAlarmRule(alarmType: 'AirAlarm' | 'FireAlarm'): ValidationRule {
  const id = alarmType === 'AirAlarm' ? 'unlinked-air-alarm' : 'unlinked-fire-alarm';
  return {
    id,
    getLabel: () => t(alarmType === 'AirAlarm' ? 'mapValidator.rules.unlinkedAirAlarms' : 'mapValidator.rules.unlinkedFireAlarms'),
    severity: 'warning',
    run(_grid, entities, registry) {
      const issues: ValidationIssue[] = [];
      for (const entity of entities) {
        if (!entity.prototype.includes(alarmType)) continue;
        const x = Math.floor(entity.position.x);
        const y = Math.floor(entity.position.y);

        // Check instance components
        const instanceDL = entity.components.find(c => (c as Record<string, unknown>).type === 'DeviceList') as Record<string, unknown> | undefined;
        if (instanceDL) {
          const devices = instanceDL.devices;
          if (!Array.isArray(devices) || devices.length === 0) {
            issues.push({
              ruleId: id, severity: 'warning',
              message: t('mapValidator.issues.noLinkedDevices', { prototype: entity.prototype, x, y }),
              x, y, entityUid: entity.uid,
            });
          }
          continue; // has instance component, checked
        }

        // No instance component, check prototype
        const resolved = registry.getEntity(entity.prototype);
        const hasProtoDL = resolved?.components.some(c => c.type === 'DeviceList') ?? false;
        if (hasProtoDL) {
          // Prototype has DeviceList but instance doesn't, means no devices linked
          issues.push({
            ruleId: id, severity: 'warning',
            message: t('mapValidator.issues.noLinkedDevices', { prototype: entity.prototype, x, y }),
            x, y, entityUid: entity.uid,
          });
        }
      }
      return issues;
    },
  };
}

const unconnectedPowerDeviceRule: ValidationRule = {
  id: 'unconnected-power-device',
  getLabel: () => t('mapValidator.rules.unconnectedPowerDevice'),
  severity: 'warning',
  run(_grid, entities, registry) {
    const issues: ValidationIssue[] = [];

    // Index cable node groups present at each tile.
    const cableGroupsByTile = new Map<string, Set<string>>();
    for (const entity of entities) {
      const groups = getPowerNodeGroups(entity, registry);
      if (groups.length === 0) continue;
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      const key = `${x},${y}`;
      if (!cableGroupsByTile.has(key)) cableGroupsByTile.set(key, new Set());
      const set = cableGroupsByTile.get(key)!;
      for (const g of groups) set.add(g);
    }

    for (const entity of entities) {
      const groups = getPowerNodeGroups(entity, registry);
      if (groups.length === 0) continue;
      // Only flag devices that consume power (APC/Substation/SMES), not the cables themselves.
      const isDevice = entity.prototype.includes('APC') || entity.prototype.includes('Substation') || entity.prototype.includes('SMES');
      if (!isDevice) continue;

      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      const tileGroups = cableGroupsByTile.get(`${x},${y}`) ?? new Set<string>();
      // A device is connected if a cable on the same tile shares one of its node groups
      // (other than its own device node, which doesn't count as a cable).
      const hasMatchingCable = groups.some(g => tileGroups.has(g)) &&
        entities.some(other => other !== entity &&
          Math.floor(other.position.x) === x && Math.floor(other.position.y) === y &&
          (other.prototype.includes('Cable')) &&
          getPowerNodeGroups(other, registry).some(g => groups.includes(g)));

      if (!hasMatchingCable) {
        issues.push({
          ruleId: 'unconnected-power-device', severity: 'warning',
          message: t('mapValidator.issues.unconnectedPowerDevice', { prototype: entity.prototype, x, y }),
          x, y, entityUid: entity.uid,
        });
      }
    }
    return issues;
  },
};

const unconnectedPipeDeviceRule: ValidationRule = {
  id: 'unconnected-pipe-device',
  getLabel: () => t('mapValidator.rules.unconnectedPipeDevice'),
  severity: 'warning',
  run(_grid, entities, registry) {
    const issues: ValidationIssue[] = [];

    // Index pipe nodes present at each tile (by tile key), keeping the owning entity for direction checks.
    const pipeEntitiesByTile = new Map<string, ImportedEntity[]>();
    for (const entity of entities) {
      if (getPipeNodes(entity, registry).length === 0) continue;
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      const key = `${x},${y}`;
      if (!pipeEntitiesByTile.has(key)) pipeEntitiesByTile.set(key, []);
      pipeEntitiesByTile.get(key)!.push(entity);
    }

    for (const entity of entities) {
      const pipeNodes = getPipeNodes(entity, registry);
      if (pipeNodes.length === 0) continue;

      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);

      // Effective outward directions across all of this entity's pipe nodes.
      const myDirs = new Set<CardinalDir>();
      for (const node of pipeNodes) for (const d of getPipeNodeDirections(entity, node)) myDirs.add(d);

      let connected = myDirs.size === 0; // nothing to check against, don't false-positive
      for (const dir of myDirs) {
        const [dx, dy] = DIR_OFFSET[dir];
        const neighborKey = `${x + dx},${y + dy}`;
        const neighbors = pipeEntitiesByTile.get(neighborKey) ?? [];
        const opposite = OPPOSITE_DIR[dir];
        for (const neighbor of neighbors) {
          const neighborNodes = getPipeNodes(neighbor, registry);
          const neighborDirs = new Set<CardinalDir>();
          for (const node of neighborNodes) for (const d of getPipeNodeDirections(neighbor, node)) neighborDirs.add(d);
          if (neighborDirs.has(opposite)) { connected = true; break; }
        }
        if (connected) break;
      }

      if (!connected) {
        issues.push({
          ruleId: 'unconnected-pipe-device', severity: 'warning',
          message: t('mapValidator.issues.unconnectedPipeDevice', { prototype: entity.prototype, x, y }),
          x, y, entityUid: entity.uid,
        });
      }
    }
    return issues;
  },
};

const abstractPrototypeRule: ValidationRule = {
  id: 'abstract-prototype',
  getLabel: () => t('mapValidator.rules.abstractPrototype'),
  severity: 'warning',
  run(_grid, entities, registry) {
    const issues: ValidationIssue[] = [];
    for (const entity of entities) {
      if (!registry.isAbstractPrototype(entity.prototype)) continue;
      const x = Math.floor(entity.position.x);
      const y = Math.floor(entity.position.y);
      issues.push({
        ruleId: 'abstract-prototype', severity: 'warning',
        message: t('mapValidator.issues.abstractPrototype', { prototype: entity.prototype, x, y }),
        x, y, entityUid: entity.uid,
      });
    }
    return issues;
  },
};

// ---- Public API ----

const RULES: ValidationRule[] = [
  floorUnderWallRule,
  doorWithoutFloorRule,
  danglingDeviceRefRule,
  makeAlarmRule('AirAlarm'),
  makeAlarmRule('FireAlarm'),
  abstractPrototypeRule,
  unconnectedPowerDeviceRule,
  unconnectedPipeDeviceRule,
];

export function validateMap(
  grid: TileGrid,
  entities: ImportedEntity[],
  registry: IPrototypeRegistry,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of RULES) {
    issues.push(...rule.run(grid, entities, registry));
  }
  return issues;
}

/** Get rule metadata for UI grouping. */
export function getValidationRules(): { id: string; label: string; severity: 'error' | 'warning' }[] {
  return RULES.map(r => ({ id: r.id, label: r.getLabel(), severity: r.severity }));
}
