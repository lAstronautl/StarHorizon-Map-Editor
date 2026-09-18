import { describe, it, expect } from 'vitest';
import { PipeDrawTool } from '../pipeDrawTool';
import type { ToolContext } from '../toolTypes';
import { createInitialState } from '../../state/editorState';
import type { ImportedEntity } from '../../import/mapImporter';
import type { IPrototypeRegistry } from '../../loaders/registryTypes';

/** Minimal registry with just enough prototype data for GasVentPump's NodeContainer. */
function makeMockRegistry(): IPrototypeRegistry {
  return {
    getTile: () => null,
    getEntity: (id: string) => {
      const components: { type: string;[key: string]: unknown }[] = [];
      if (id === 'GasVentPump' || id === 'GasVentScrubber') {
        components.push({ type: 'NodeContainer', nodes: {
          pipe: { nodeGroupID: 'Pipe', pipeDirection: 'South' },
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

function makeToolContext(entities: ImportedEntity[] = [], registry: IPrototypeRegistry | null = null): { ctx: ToolContext; dispatched: any[] } {
  const dispatched: any[] = [];
  const state = {
    ...createInitialState(),
    entities: [...entities],
    nextEntityId: entities.length > 0 ? Math.max(...entities.map(e => e.uid)) + 1 : 1,
    registry,
  };
  const ctx: ToolContext = {
    state,
    dispatch: (action: any) => {
      dispatched.push(action);
      if (action.type === 'APPLY_COMMAND') {
        for (const ec of action.command.entityChanges) {
          if (ec.action === 'add') {
            state.entities.push(ec.entity);
            if (ec.entity.uid >= state.nextEntityId) state.nextEntityId = ec.entity.uid + 1;
          }
          if (ec.action === 'remove') {
            const idx = state.entities.findIndex(e => e.uid === ec.entity.uid);
            if (idx >= 0) state.entities.splice(idx, 1);
          }
        }
      }
    },
    camera: { tileScreenSize: 32 } as any,
    canvasW: 800,
    canvasH: 600,
    paletteItem: null,
    shiftHeld: false,
    ctrlHeld: false,
  };
  return { ctx, dispatched };
}

describe('PipeDrawTool', () => {
  it('draws auto-fitted pipes along drag path', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    // Draw a vertical line: (5,3), (5,4), (5,5)
    tool.onMouseDown(ctx, 5, 3, 0);
    tool.onMouseMove(ctx, 5, 4);
    tool.onMouseMove(ctx, 5, 5);
    tool.onMouseUp(ctx);

    expect(dispatched).toHaveLength(1);
    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');
    expect(adds).toHaveLength(3);

    // Middle pipe should be straight
    const midPipe = adds.find((ec: any) => ec.entity.position.y === 4.5);
    expect(midPipe.entity.prototype).toBe('GasPipeStraight');
    expect(midPipe.entity.rotation).toBe(0); // vertical
  });

  it('creates bends at corners', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    // Draw L-shape: (5,5), (5,6), (6,6)
    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseMove(ctx, 5, 6);
    tool.onMouseMove(ctx, 6, 6);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // Corner at (5,6) should be a bend
    const corner = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 6,
    );
    expect(corner).toBeDefined();
    expect(corner.entity.prototype).toBe('GasPipeBend');
  });

  it('adds AtmosPipeColor for supply pipes', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const entity = dispatched[0].command.entityChanges[0].entity;
    const colorComp = entity.components.find((c: any) => c.type === 'AtmosPipeColor');
    expect(colorComp).toBeDefined();
    expect(colorComp.color).toBe('#0055CCFF');
  });

  it('uses a custom hex color instead of the supply default when set', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    tool.customColor = '#00FF00FF';
    const { ctx, dispatched } = makeToolContext();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const entity = dispatched[0].command.entityChanges[0].entity;
    const colorComp = entity.components.find((c: any) => c.type === 'AtmosPipeColor');
    expect(colorComp.color).toBe('#00FF00FF');
  });

  it('does not fit a custom-colored pipe together with an existing supply-colored pipe', () => {
    // Existing supply-blue pipe at (5,4)
    const existing: ImportedEntity[] = [
      {
        uid: 100, prototype: 'GasPipeStraight',
        position: { x: 5.5, y: 4.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
      },
    ];

    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    tool.customColor = '#00FF00FF';
    const { ctx, dispatched } = makeToolContext(existing);

    // Draw a custom-colored pipe at (5,5), directly south of the existing supply pipe
    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const removes = cmd.entityChanges.filter((ec: any) => ec.action === 'remove');
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // The existing supply pipe must be left untouched (not refit as if connected)
    expect(removes.some((ec: any) => ec.entity.uid === 100)).toBe(false);

    // The new custom-colored pipe should be a standalone straight segment (no neighbor),
    // not a pipe that thinks it's connected to the supply-blue one above it.
    const newPipe = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 5,
    );
    expect(newPipe).toBeDefined();
    expect(newPipe.entity.prototype).toBe('GasPipeStraight');
    const colorComp = newPipe.entity.components.find((c: any) => c.type === 'AtmosPipeColor');
    expect(colorComp.color).toBe('#00FF00FF');
  });

  it('disposal pipes have no color component', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'disposal';
    const { ctx, dispatched } = makeToolContext();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const entity = dispatched[0].command.entityChanges[0].entity;
    expect(entity.prototype).toBe('DisposalPipe');
    // Disposal pipes have Transform but no AtmosPipeColor
    expect(entity.components.some((c: Record<string, unknown>) => c.type === 'Transform')).toBe(true);
    expect(entity.components.some((c: Record<string, unknown>) => c.type === 'AtmosPipeColor')).toBe(false);
  });

  it('pipe entities include a Transform component', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const entity = dispatched[0].command.entityChanges[0].entity;
    const transform = entity.components.find((c: Record<string, unknown>) => c.type === 'Transform');
    expect(transform).toBeDefined();
    expect(transform.type).toBe('Transform');
    expect(transform.pos).toBe('5.5,5.5');
  });

  it('interpolates gaps when mouse skips tiles', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    // Simulate fast mouse: jump from (5,3) directly to (5,7), skipping (5,4), (5,5), (5,6)
    tool.onMouseDown(ctx, 5, 3, 0);
    tool.onMouseMove(ctx, 5, 7);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // Should have 5 tiles: 5,3 through 5,7 (interpolated)
    expect(adds).toHaveLength(5);
    const ys = adds.map((ec: any) => Math.floor(ec.entity.position.y)).sort((a: number, b: number) => a - b);
    expect(ys).toEqual([3, 4, 5, 6, 7]);
  });

  it('interpolates diagonal gaps', () => {
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext();

    // Jump diagonally from (3,3) to (6,6)
    tool.onMouseDown(ctx, 3, 3, 0);
    tool.onMouseMove(ctx, 6, 6);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // Should have filled in intermediate tiles (at least start and end + intermediates)
    expect(adds.length).toBeGreaterThanOrEqual(4);

    // All tiles should be connected, no gaps > 1 tile (including diagonal)
    const positions = adds.map((ec: any) => ({
      x: Math.floor(ec.entity.position.x),
      y: Math.floor(ec.entity.position.y),
    }));
    const posSet = new Set(positions.map((p: any) => `${p.x},${p.y}`));

    // Verify connectivity: every tile should have at least one 8-connected neighbor
    for (let i = 1; i < positions.length; i++) {
      const p = positions[i];
      let hasNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (posSet.has(`${p.x + dx},${p.y + dy}`)) { hasNeighbor = true; break; }
        }
        if (hasNeighbor) break;
      }
      expect(hasNeighbor).toBe(true);
    }
  });

  it('allows a Secondary layer pipe to occupy the same tile as an existing Primary pipe', () => {
    const existing: ImportedEntity[] = [
      {
        uid: 100, prototype: 'GasPipeStraight',
        position: { x: 5.5, y: 5.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
      },
    ];

    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    tool.pipeLayer = 'Secondary';
    const { ctx, dispatched } = makeToolContext(existing);

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const removes = cmd.entityChanges.filter((ec: any) => ec.action === 'remove');
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // The existing Primary pipe must be left untouched
    expect(removes.some((ec: any) => ec.entity.uid === 100)).toBe(false);

    // A new Secondary-layer pipe should be added at the same tile
    const newPipe = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 5,
    );
    expect(newPipe).toBeDefined();
    expect(newPipe.entity.prototype).toBe('GasPipeStraightAlt1');
    const layerComp = newPipe.entity.components.find((c: any) => c.type === 'AtmosPipeLayers');
    expect(layerComp).toBeDefined();
    expect(layerComp.pipeLayer).toBe('Secondary');

    // Existing Primary pipe should still be present in state, untouched
    expect(ctx.state.entities.some((e: ImportedEntity) => e.uid === 100)).toBe(true);
  });

  it('erasing one layer does not remove pipes on another layer at the same tile', () => {
    const existing: ImportedEntity[] = [
      {
        uid: 100, prototype: 'GasPipeStraight',
        position: { x: 5.5, y: 5.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
      },
      {
        uid: 101, prototype: 'GasPipeStraightAlt1',
        position: { x: 5.5, y: 5.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }, { type: 'AtmosPipeLayers', pipeLayer: 'Secondary' }],
      },
    ];

    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    tool.pipeLayer = 'Secondary';
    const { ctx, dispatched } = makeToolContext(existing);

    // Right-click erase at (5,5) should only remove the Secondary-layer pipe
    tool.onMouseDown(ctx, 5, 5, 2);

    expect(dispatched).toHaveLength(1);
    const cmd = dispatched[0].command;
    const removes = cmd.entityChanges.filter((ec: any) => ec.action === 'remove');
    expect(removes.map((ec: any) => ec.entity.uid)).toEqual([101]);
    expect(ctx.state.entities.some((e: ImportedEntity) => e.uid === 100)).toBe(true);
  });

  it('refits existing neighbors when extending a pipe', () => {
    // Existing vertical pipe at (5,4) and (5,5)
    const existing: ImportedEntity[] = [
      {
        uid: 100, prototype: 'GasPipeStraight',
        position: { x: 5.5, y: 4.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
      },
      {
        uid: 101, prototype: 'GasPipeStraight',
        position: { x: 5.5, y: 5.5 }, rotation: 0,
        components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
      },
    ];

    const tool = new PipeDrawTool();
    tool.pipeType = 'supply';
    const { ctx, dispatched } = makeToolContext(existing);

    // Draw east from (5,5) to (6,5)
    tool.onMouseDown(ctx, 6, 5, 0);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const removes = cmd.entityChanges.filter((ec: any) => ec.action === 'remove');
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');

    // Should remove the old straight at (5,5) and add refitted version
    expect(removes.some((ec: any) => ec.entity.uid === 101)).toBe(true);

    // Should have new entity at (6,5)
    expect(adds.some((ec: any) => Math.floor(ec.entity.position.x) === 6)).toBe(true);

    // The refitted (5,5) should be a bend (has S from 5,4 and E from 6,5)
    const refitted55 = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 5,
    );
    expect(refitted55).toBeDefined();
    expect(refitted55.entity.prototype).toBe('GasPipeBend');
  });

  it('bends a drawn pipe toward a same-color vent whose port faces it', () => {
    // GasVentPump at rotation 3pi/2 (270 deg) has its port facing West, per RobustToolbox's
    // Direction rotation convention (South=0 -> East -> North -> West as rotation increases).
    // Placed at (6,5), its port opens toward (5,5) — where the new pipe is drawn.
    const vent: ImportedEntity = {
      uid: 200, prototype: 'GasVentPump',
      position: { x: 6.5, y: 5.5 }, rotation: (3 * Math.PI) / 2,
      components: [{ type: 'AtmosPipeColor', color: '#0055CCFF' }],
    };
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply'; // supply default color is #0055CCFF, matching the vent
    const { ctx, dispatched } = makeToolContext([vent], makeMockRegistry());

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');
    const pipe = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 5,
    );
    expect(pipe).toBeDefined();
    expect(pipe.entity.prototype).toBe('GasPipeStraight');
    expect(pipe.entity.rotation).toBeCloseTo(Math.PI / 2); // horizontal, facing the vent's West port
  });

  it('does not bend toward a vent of a different color', () => {
    const vent: ImportedEntity = {
      uid: 200, prototype: 'GasVentPump',
      position: { x: 6.5, y: 5.5 }, rotation: (3 * Math.PI) / 2,
      components: [{ type: 'AtmosPipeColor', color: '#FF0000FF' }], // different color
    };
    const tool = new PipeDrawTool();
    tool.pipeType = 'supply'; // #0055CCFF, does not match the vent
    const { ctx, dispatched } = makeToolContext([vent], makeMockRegistry());

    tool.onMouseDown(ctx, 5, 5, 0);
    tool.onMouseUp(ctx);

    const cmd = dispatched[0].command;
    const adds = cmd.entityChanges.filter((ec: any) => ec.action === 'add');
    const pipe = adds.find((ec: any) =>
      Math.floor(ec.entity.position.x) === 5 && Math.floor(ec.entity.position.y) === 5,
    );
    expect(pipe).toBeDefined();
    // No matching-color neighbor at all, so it falls back to the single-tile default (vertical).
    expect(pipe.entity.rotation).toBe(0);
  });
});
