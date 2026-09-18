import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../state/editorState';
import { editorReducer } from '../../state/editorReducer';
import { executeAgentTool, getToolDefinitions } from '../agentTools';
import type { AgentToolContext } from '../agentTools';
import type { EditorState } from '../../state/editorState';
import type { IPrototypeRegistry } from '../../loaders/registryTypes';

function makeMockRegistry(): IPrototypeRegistry {
  return {
    getTile: () => null,
    getEntity: (id: string) => {
      const components: { type: string;[key: string]: unknown }[] = [];
      if (id === 'GasVentPump') {
        components.push({ type: 'NodeContainer', nodes: { pipe: { nodeGroupID: 'Pipe', pipeDirection: 'South' } } });
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

/** Real reducer-backed harness, so tool tests exercise the same path the app uses. */
function makeCtx(registry: IPrototypeRegistry | null = null): AgentToolContext {
  let state: EditorState = createInitialState();
  if (registry) state = editorReducer(state, { type: 'SET_REGISTRY', registry });
  return {
    get state() { return state; },
    dispatch: (action) => { state = editorReducer(state, action); },
  } as AgentToolContext;
}

describe('agentTools', () => {
  it('exposes all expected tool definitions', () => {
    const names = getToolDefinitions().map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_map_info', 'place_entity', 'place_entities', 'remove_entities',
      'paint_tiles', 'draw_pipe', 'draw_cable', 'validate_map',
    ]));
  });

  describe('place_entity', () => {
    it('places an entity at the given tile, centered', () => {
      const ctx = makeCtx();
      const result = executeAgentTool('place_entity', { prototype: 'TableSteel', x: 5, y: 5 }, ctx) as { placedUid: number };
      const placed = ctx.state.entities.find(e => e.uid === result.placedUid);
      expect(placed).toBeDefined();
      expect(placed!.prototype).toBe('TableSteel');
      expect(placed!.position).toEqual({ x: 5.5, y: 5.5 });
      expect(placed!.rotation).toBe(0);
    });

    it('applies rotation in degrees as radians', () => {
      const ctx = makeCtx();
      const result = executeAgentTool('place_entity', { prototype: 'AirlockGlass', x: 0, y: 0, rotationDegrees: 90 }, ctx) as { placedUid: number };
      const placed = ctx.state.entities.find(e => e.uid === result.placedUid)!;
      expect(placed.rotation).toBeCloseTo(Math.PI / 2);
    });

    it('is undoable', () => {
      const ctx = makeCtx();
      executeAgentTool('place_entity', { prototype: 'TableSteel', x: 1, y: 1 }, ctx);
      expect(ctx.state.entities.length).toBe(1);
      ctx.dispatch({ type: 'UNDO' });
      expect(ctx.state.entities.length).toBe(0);
    });
  });

  describe('place_entities', () => {
    it('places multiple entities in one command', () => {
      const ctx = makeCtx();
      const result = executeAgentTool('place_entities', {
        entities: [
          { prototype: 'ChairPilotSeat', x: 0, y: 0 },
          { prototype: 'ChairPilotSeat', x: 1, y: 0 },
        ],
      }, ctx) as { placed: { uid: number }[] };
      expect(result.placed).toHaveLength(2);
      expect(ctx.state.entities).toHaveLength(2);
      // Single undo step removes both
      ctx.dispatch({ type: 'UNDO' });
      expect(ctx.state.entities).toHaveLength(0);
    });
  });

  describe('remove_entities', () => {
    it('removes by uid', () => {
      const ctx = makeCtx();
      const { placedUid } = executeAgentTool('place_entity', { prototype: 'TableSteel', x: 0, y: 0 }, ctx) as { placedUid: number };
      const result = executeAgentTool('remove_entities', { uids: [placedUid] }, ctx) as { removedCount: number };
      expect(result.removedCount).toBe(1);
      expect(ctx.state.entities).toHaveLength(0);
    });

    it('removes by prototype within an area', () => {
      const ctx = makeCtx();
      executeAgentTool('place_entity', { prototype: 'TableSteel', x: 0, y: 0 }, ctx);
      executeAgentTool('place_entity', { prototype: 'TableSteel', x: 10, y: 10 }, ctx);
      const result = executeAgentTool('remove_entities', {
        prototype: 'TableSteel', x1: 0, y1: 0, x2: 2, y2: 2,
      }, ctx) as { removedCount: number };
      expect(result.removedCount).toBe(1);
      expect(ctx.state.entities).toHaveLength(1);
      expect(ctx.state.entities[0].position.x).toBeCloseTo(10.5);
    });
  });

  describe('paint_tiles', () => {
    it('fills a rectangle with the given tile', () => {
      const ctx = makeCtx();
      const result = executeAgentTool('paint_tiles', { tileId: 'FloorSteel', x1: 0, y1: 0, x2: 2, y2: 1 }, ctx) as { tilesPainted: number };
      expect(result.tilesPainted).toBe(6); // 3 wide x 2 tall
      const grid = ctx.state.grid;
      for (let y = 0; y <= 1; y++) {
        for (let x = 0; x <= 2; x++) {
          const lx = x - grid.offsetX, ly = y - grid.offsetY;
          expect(grid.cells[ly * grid.width + lx].tileId).toBe('FloorSteel');
        }
      }
    });

    it('is undoable back to the previous tiles', () => {
      const ctx = makeCtx();
      executeAgentTool('paint_tiles', { tileId: 'FloorSteel', x1: 0, y1: 0, x2: 0, y2: 0 }, ctx);
      ctx.dispatch({ type: 'UNDO' });
      const grid = ctx.state.grid;
      const lx = 0 - grid.offsetX, ly = 0 - grid.offsetY;
      expect(grid.cells[ly * grid.width + lx].tileId).toBe('Space');
    });
  });

  describe('draw_pipe', () => {
    it('draws a straight horizontal gas pipe run with supply color', () => {
      const ctx = makeCtx(makeMockRegistry());
      const result = executeAgentTool('draw_pipe', { pipeType: 'supply', x1: 0, y1: 0, x2: 2, y2: 0 }, ctx) as { tilesPlaced: number };
      expect(result.tilesPlaced).toBe(3);
      const pipes = ctx.state.entities.filter(e => e.prototype.startsWith('GasPipe'));
      expect(pipes).toHaveLength(3);
      const mid = pipes.find(p => Math.floor(p.position.x) === 1)!;
      expect(mid.prototype).toBe('GasPipeStraight');
      const colorComp = mid.components.find(c => (c as Record<string, unknown>).type === 'AtmosPipeColor') as Record<string, unknown>;
      expect(colorComp.color).toBe('#0055CCFF');
    });

    it('bends toward a same-color vent (regression for the auto-connect fix)', () => {
      const ctx = makeCtx(makeMockRegistry());
      executeAgentTool('place_entity', { prototype: 'GasVentPump', x: 3, y: 0, rotationDegrees: 270 }, ctx);
      // Give the vent the same color as the pipe we're about to draw (supply blue).
      const vent = ctx.state.entities[0];
      ctx.dispatch({
        type: 'APPLY_COMMAND',
        command: {
          label: 'color vent', tileChanges: [],
          entityChanges: [
            { action: 'remove', entity: vent },
            { action: 'add', entity: { ...vent, components: [...vent.components, { type: 'AtmosPipeColor', color: '#0055CCFF' }] } },
          ],
        },
      });

      executeAgentTool('draw_pipe', { pipeType: 'supply', x1: 0, y1: 0, x2: 2, y2: 0 }, ctx);
      const pipeAt2 = ctx.state.entities.find(e => e.prototype.startsWith('GasPipe') && Math.floor(e.position.x) === 2)!;
      expect(pipeAt2.prototype).toBe('GasPipeStraight');
      expect(pipeAt2.rotation).toBeCloseTo(Math.PI / 2); // horizontal, reaching toward the vent's West-facing port
    });
  });

  describe('draw_cable', () => {
    it('places one cable entity per tile with no fitting', () => {
      const ctx = makeCtx();
      const result = executeAgentTool('draw_cable', { cableType: 'CableHV', x1: 0, y1: 0, x2: 2, y2: 0 }, ctx) as { placedCount: number };
      expect(result.placedCount).toBe(3);
      expect(ctx.state.entities.every(e => e.prototype === 'CableHV')).toBe(true);
    });

    it('does not duplicate cables on tiles that already have one', () => {
      const ctx = makeCtx();
      executeAgentTool('draw_cable', { cableType: 'CableHV', x1: 0, y1: 0, x2: 1, y2: 0 }, ctx);
      const result = executeAgentTool('draw_cable', { cableType: 'CableHV', x1: 0, y1: 0, x2: 2, y2: 0 }, ctx) as { placedCount: number };
      expect(result.placedCount).toBe(1); // only tile x=2 is new
    });
  });

  describe('validate_map', () => {
    it('returns an error object when the registry is not loaded', () => {
      const ctx = makeCtx(null);
      const result = executeAgentTool('validate_map', {}, ctx) as { error?: string };
      expect(result.error).toBeDefined();
    });

    it('runs validation and summarizes issues when the registry is loaded', () => {
      const ctx = makeCtx(makeMockRegistry());
      const result = executeAgentTool('validate_map', {}, ctx) as { totalIssues: number; countsByRule: Record<string, number> };
      expect(typeof result.totalIssues).toBe('number');
      expect(typeof result.countsByRule).toBe('object');
    });
  });

  describe('get_map_info', () => {
    it('lists entities matching a prototype filter', () => {
      const ctx = makeCtx();
      executeAgentTool('place_entity', { prototype: 'TableSteel', x: 0, y: 0 }, ctx);
      executeAgentTool('place_entity', { prototype: 'ChairPilotSeat', x: 1, y: 0 }, ctx);
      const result = executeAgentTool('get_map_info', { prototype: 'TableSteel' }, ctx) as { totalEntitiesMatched: number };
      expect(result.totalEntitiesMatched).toBe(1);
    });
  });

  it('throws for an unknown tool name', () => {
    const ctx = makeCtx();
    expect(() => executeAgentTool('not_a_real_tool', {}, ctx)).toThrow();
  });
});
