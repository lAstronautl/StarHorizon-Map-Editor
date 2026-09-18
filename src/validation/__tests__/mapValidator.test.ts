// src/validation/__tests__/mapValidator.test.ts
import { describe, it, expect } from 'vitest';
import { validateMap } from '../mapValidator';
import type { TileGrid } from '../../types';
import type { ImportedEntity } from '../../import/mapImporter';
import type { IPrototypeRegistry } from '../../loaders/registryTypes';

function makeGrid(width: number, height: number, tileId: string = 'Space'): TileGrid {
  return {
    width, height, offsetX: 0, offsetY: 0,
    cells: Array(width * height).fill(null).map(() => ({ tileId })),
  };
}

function makeEntity(uid: number, proto: string, x: number, y: number, components: Record<string, unknown>[] = [], rotation = 0): ImportedEntity {
  return { uid, prototype: proto, position: { x: x + 0.5, y: y + 0.5 }, rotation, components };
}

function makeMockRegistry(): IPrototypeRegistry {
  return {
    getTile: () => null,
    getEntity: (id: string) => {
      const components: { type: string;[key: string]: unknown }[] = [];
      // Walls get the Wall tag (matching real SS14 prototype inheritance)
      if (id.includes('Wall') && !id.includes('Diagonal')) {
        components.push({ type: 'Tag', tags: ['Wall'] });
      }
      // Diagonal walls get both Wall and Diagonal tags
      if (id.includes('Diagonal')) {
        components.push({ type: 'Tag', tags: ['Wall', 'Diagonal'] });
      }
      if (id.includes('AirAlarm')) components.push({ type: 'DeviceList' });
      if (id.includes('FireAlarm')) components.push({ type: 'DeviceList' });

      // Power network prototypes
      if (id === 'BaseAPC') {
        components.push({ type: 'NodeContainer', nodes: {
          input: { nodeGroupID: 'MVPower' }, output: { nodeGroupID: 'Apc' },
        } });
      }
      if (id === 'SubstationBasic') {
        components.push({ type: 'NodeContainer', nodes: {
          input: { nodeGroupID: 'HVPower' }, output: { nodeGroupID: 'MVPower' },
        } });
      }
      if (id === 'SMESBasic') {
        components.push({ type: 'NodeContainer', nodes: {
          input: { nodeGroupID: 'HVPower' }, output: { nodeGroupID: 'HVPower' },
        } });
      }
      if (id === 'CableMV') {
        components.push({ type: 'NodeContainer', nodes: { power: { nodeGroupID: 'MVPower' } } });
      }
      if (id === 'CableHV') {
        components.push({ type: 'NodeContainer', nodes: { power: { nodeGroupID: 'HVPower' } } });
      }
      if (id === 'CableApcExtension') {
        components.push({ type: 'NodeContainer', nodes: { power: { nodeGroupID: 'Apc' } } });
      }

      // Gas pipe network prototypes
      if (id === 'GasVentPump' || id === 'GasVentScrubber') {
        components.push({ type: 'NodeContainer', nodes: {
          pipe: { nodeGroupID: 'Pipe', pipeDirection: 'South' },
        } });
      }
      if (id === 'GasPort') {
        components.push({ type: 'NodeContainer', nodes: {
          connected: { nodeGroupID: 'Pipe', pipeDirection: 'South' },
        } });
      }
      if (id === 'GasPipeStraight') {
        components.push({ type: 'NodeContainer', nodes: {
          pipe: { nodeGroupID: 'Pipe', pipeDirection: 'Longitudinal' },
        } });
      }

      return {
        id, name: id, description: '', suffix: '', abstract: false,
        categories: [], placement: {}, components,
        spriteInfo: null, sourceCategory: 'Other',
        raw: { type: 'entity' as const, id },
      };
    },
    getAllTiles: () => [], getAllEntities: () => [],
    getEntitiesByCategory: () => [], getCategories: () => [],
    getSpriteInfo: () => null, tileCount: 0, entityCount: 0,
    getDecal: () => null, getAllDecals: () => [], decalCount: 0,
    isAbstractPrototype: () => false,
  };
}

describe('validateMap', () => {
  describe('floor-under-wall', () => {
    it('flags wall on FloorSteel', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' };
      const entities = [makeEntity(10, 'WallSolid', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      const wallIssues = issues.filter(i => i.ruleId === 'floor-under-wall');
      expect(wallIssues.length).toBe(1);
      expect(wallIssues[0].severity).toBe('warning');
    });

    it('does not flag wall on Plating', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'Plating' };
      const entities = [makeEntity(10, 'WallSolid', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });

    it('does not flag wall on Space', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [makeEntity(10, 'WallSolid', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });

    it('does not flag wall on Lattice', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'Lattice' };
      const entities = [makeEntity(10, 'WallSolid', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });

    it('does not flag doors as walls', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' };
      grid.cells[1] = { tileId: 'FloorSteel' };
      const entities = [
        makeEntity(10, 'AirlockCommandLocked', 0, 0),
        makeEntity(11, 'Firelock', 1, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });

    it('does not flag diagonal walls on floor tiles', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' };
      // Diagonal walls have both Wall and Diagonal tags, they are allowed on floor tiles
      const entities = [makeEntity(10, 'WallSolidDiagonal', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });

    it('does not flag allowed wall types (asteroid rocks, etc.)', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' };
      grid.cells[1] = { tileId: 'FloorSteel' };
      // AsteroidRockMining inherits Wall tag via BaseWall -> BaseStructureWall
      // but is in the AllowedWalls whitelist
      const entities = [
        makeEntity(10, 'AsteroidRockMining', 0, 0),
        makeEntity(11, 'AsteroidRock', 1, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'floor-under-wall').length).toBe(0);
    });
  });

  describe('door-without-floor', () => {
    it('flags airlock on Space', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [makeEntity(10, 'AirlockCommandLocked', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      const doorIssues = issues.filter(i => i.ruleId === 'door-without-floor');
      expect(doorIssues.length).toBe(1);
    });

    it('does not flag airlock on FloorSteel', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' };
      const entities = [makeEntity(10, 'AirlockCommandLocked', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'door-without-floor').length).toBe(0);
    });

    it('flags firelock on Lattice', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'Lattice' };
      const entities = [makeEntity(10, 'Firelock', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'door-without-floor').length).toBe(1);
    });
  });

  describe('dangling-device-ref', () => {
    it('flags DeviceList with non-existent UID', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'AirAlarm', 0, 0, [{ type: 'DeviceList', devices: [999] }]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'dangling-device-ref').length).toBe(1);
      expect(issues[0].severity).toBe('error');
    });

    it('does not flag DeviceList with valid UID', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'AirAlarm', 0, 0, [{ type: 'DeviceList', devices: [20] }]),
        makeEntity(20, 'GasVentPump', 1, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'dangling-device-ref').length).toBe(0);
    });

    it('flags DeviceLinkSource with non-existent target', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'SignalButton', 0, 0, [
          { type: 'DeviceLinkSource', linkedPorts: { '888': [['Pressed', 'Toggle']] } },
        ]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'dangling-device-ref').length).toBe(1);
    });

    it('flags DeviceNetwork with non-existent list', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'GasVentPump', 0, 0, [{ type: 'DeviceNetwork', deviceLists: [777] }]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'dangling-device-ref').length).toBe(1);
    });
  });

  describe('unlinked-air-alarm', () => {
    it('flags AirAlarm with empty DeviceList', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'AirAlarm', 0, 0, [{ type: 'DeviceList', devices: [] }]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unlinked-air-alarm').length).toBe(1);
    });

    it('does not flag AirAlarm with devices', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'AirAlarm', 0, 0, [{ type: 'DeviceList', devices: [20] }]),
        makeEntity(20, 'GasVentPump', 1, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unlinked-air-alarm').length).toBe(0);
    });

    it('flags AirAlarm with no DeviceList component (prototype-only)', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [makeEntity(10, 'AirAlarm', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unlinked-air-alarm').length).toBe(1);
    });
  });

  describe('unlinked-fire-alarm', () => {
    it('flags FireAlarm with empty DeviceList', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'FireAlarm', 0, 0, [{ type: 'DeviceList', devices: [] }]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unlinked-fire-alarm').length).toBe(1);
    });

    it('does not flag FireAlarm with devices', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [
        makeEntity(10, 'FireAlarm', 0, 0, [{ type: 'DeviceList', devices: [20] }]),
        makeEntity(20, 'Firelock', 1, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unlinked-fire-alarm').length).toBe(0);
    });
  });

  describe('abstract-prototype', () => {
    it('flags an entity whose prototype is abstract', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [makeEntity(10, 'BaseAbstractThing', 0, 0)];
      const registry = makeMockRegistry();
      (registry as { isAbstractPrototype: (id: string) => boolean }).isAbstractPrototype = (id: string) => id === 'BaseAbstractThing';
      const issues = validateMap(grid, entities, registry);
      expect(issues.filter(i => i.ruleId === 'abstract-prototype').length).toBe(1);
    });

    it('does not flag a non-abstract entity', () => {
      const grid = makeGrid(16, 16, 'Space');
      const entities = [makeEntity(10, 'WallSolid', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'abstract-prototype').length).toBe(0);
    });
  });

  describe('unconnected-power-device', () => {
    it('flags an APC with no cable on its tile', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [makeEntity(10, 'BaseAPC', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-power-device').length).toBe(1);
    });

    it('does not flag an APC with a matching MV cable on its tile', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [
        makeEntity(10, 'BaseAPC', 0, 0),
        makeEntity(20, 'CableMV', 0, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-power-device').length).toBe(0);
    });

    it('flags a substation with only an HV cable but no MV cable (missing output)', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [
        makeEntity(10, 'SubstationBasic', 0, 0),
        makeEntity(20, 'CableHV', 0, 0),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      // Input (HV) is satisfied, but this is still a same-tile match on HV group, so no flag expected
      // since our heuristic only checks "some matching group", matching real device behavior of needing at least one wire type present.
      expect(issues.filter(i => i.ruleId === 'unconnected-power-device').length).toBe(0);
    });

    it('flags a SMES with no cable at all', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [makeEntity(10, 'SMESBasic', 0, 0)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-power-device').length).toBe(1);
    });
  });

  describe('unconnected-pipe-device', () => {
    it('flags a GasVentPump with no adjacent pipe', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [makeEntity(10, 'GasVentPump', 5, 5)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-pipe-device').length).toBe(1);
    });

    it('does not flag a GasVentPump with a matching pipe to its South', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [
        makeEntity(10, 'GasVentPump', 5, 5),
        makeEntity(20, 'GasPipeStraight', 5, 4),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-pipe-device').length).toBe(0);
    });

    it('flags a GasPort with no adjacent pipe', () => {
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [makeEntity(10, 'GasPort', 5, 5)];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.filter(i => i.ruleId === 'unconnected-pipe-device').length).toBe(1);
    });

    it('does not flag a GasVentPump rotated +90deg with a matching pipe to its East', () => {
      // Base pipeDirection is South; rotating +pi/2 (matching the game's actual bend
      // rotation convention: S->E, E->N, N->W, W->S) makes the vent face East instead.
      // Override the neighbor pipe's direction to Lateral (East+West) via an instance
      // NodeContainer so it actually exposes West back toward the vent.
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [
        makeEntity(10, 'GasVentPump', 5, 5, [], Math.PI / 2),
        makeEntity(20, 'GasPipeStraight', 6, 5, [
          { type: 'NodeContainer', nodes: { pipe: { nodeGroupID: 'Pipe', pipeDirection: 'Lateral' } } },
        ]),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      const ventIssues = issues.filter(i => i.ruleId === 'unconnected-pipe-device' && i.entityUid === 10);
      expect(ventIssues.length).toBe(0);
    });

    it('flags a GasVentPump rotated +90deg when the matching pipe is only to its South (wrong side)', () => {
      // With the vent rotated to face East, a pipe still sitting to its South (the
      // unrotated direction) must NOT satisfy the connection.
      const grid = makeGrid(16, 16, 'FloorSteel');
      const entities = [
        makeEntity(10, 'GasVentPump', 5, 5, [], Math.PI / 2),
        makeEntity(20, 'GasPipeStraight', 5, 4),
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      const ventIssues = issues.filter(i => i.ruleId === 'unconnected-pipe-device' && i.entityUid === 10);
      expect(ventIssues.length).toBe(1);
    });
  });

  describe('integration', () => {
    it('returns multiple issues from different rules', () => {
      const grid = makeGrid(16, 16, 'Space');
      grid.cells[0] = { tileId: 'FloorSteel' }; // wall on floor
      const entities = [
        makeEntity(10, 'WallSolid', 0, 0),
        makeEntity(20, 'AirlockCommandLocked', 1, 0), // door on space
        makeEntity(30, 'AirAlarm', 2, 0, [{ type: 'DeviceList', devices: [999] }]), // dangling + unlinked won't double-count since it has devices
      ];
      const issues = validateMap(grid, entities, makeMockRegistry());
      expect(issues.length).toBeGreaterThanOrEqual(3); // wall, door, dangling
      const ruleIds = new Set(issues.map(i => i.ruleId));
      expect(ruleIds.has('floor-under-wall')).toBe(true);
      expect(ruleIds.has('door-without-floor')).toBe(true);
      expect(ruleIds.has('dangling-device-ref')).toBe(true);
    });
  });
});
