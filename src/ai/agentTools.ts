// src/ai/agentTools.ts
/**
 * Tools the AI agent can call to manipulate the map. Each tool builds a
 * `Command` and dispatches `APPLY_COMMAND`, the same path every manual editor
 * tool uses — so undo/redo, dirty-tracking, etc. all work for free.
 */
import type { EditorState } from '../state/editorState';
import type { EditorAction } from '../state/actions';
import type { ImportedEntity } from '../import/mapImporter';
import type { TileChange, EntityChange, PipeType } from '../types';
import { PIPE_COLORS } from '../types';
import { getCell } from '../state/editorState';
import { buildTransformComponent } from '../tools/entityHelpers';
import { computePipeChanges, type PipeFamily, type PipeLayer } from '../algorithms/pipeFittings';
import { getEntityPipeDirections } from '../algorithms/pipeDirections';
import { validateMap } from '../validation/mapValidator';
import type { ToolDefinition } from './aiTypes';

export interface AgentToolContext {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
}

type ToolExecutor = (ctx: AgentToolContext, input: Record<string, unknown>) => unknown;

interface AgentTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string') throw new Error(`Missing/invalid string parameter "${key}"`);
  return v;
}
function num(input: Record<string, unknown>, key: string): number {
  const v = input[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Missing/invalid number parameter "${key}"`);
  return v;
}
function optNum(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' ? v : undefined;
}

// ---- place_entity / remove_entities ----

const placeEntity: AgentTool = {
  definition: {
    name: 'place_entity',
    description: 'Place a single entity by its SS14 prototype ID at a world tile position. Position is the tile\'s (x,y) integer coordinate; the entity is centered on that tile.',
    parameters: {
      type: 'object',
      properties: {
        prototype: { type: 'string', description: 'Entity prototype ID, e.g. "AirlockGlass", "GasVentPump", "TableSteel".' },
        x: { type: 'number', description: 'Tile X coordinate (integer).' },
        y: { type: 'number', description: 'Tile Y coordinate (integer).' },
        rotationDegrees: { type: 'number', description: 'Rotation in degrees, multiple of 90 (0, 90, 180, 270). Default 0.' },
      },
      required: ['prototype', 'x', 'y'],
    },
  },
  execute(ctx, input) {
    const prototype = str(input, 'prototype');
    const x = Math.floor(num(input, 'x'));
    const y = Math.floor(num(input, 'y'));
    const rotation = (optNum(input, 'rotationDegrees', 0) * Math.PI) / 180;
    const pos = { x: x + 0.5, y: y + 0.5 };
    const uid = ctx.state.nextEntityId;
    const entity: ImportedEntity = {
      uid,
      prototype,
      position: pos,
      rotation,
      components: buildTransformComponent(pos, rotation, ctx.state.gridUid),
    };
    ctx.dispatch({
      type: 'APPLY_COMMAND',
      command: { label: `AI: place ${prototype}`, tileChanges: [], entityChanges: [{ action: 'add', entity }] },
    });
    return { placedUid: uid, prototype, x, y };
  },
};

const placeEntities: AgentTool = {
  definition: {
    name: 'place_entities',
    description: 'Place multiple entities in a single undo step. Prefer this over calling place_entity repeatedly when building out several entities at once (e.g. a row of chairs, a set of walls).',
    parameters: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              prototype: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              rotationDegrees: { type: 'number' },
            },
            required: ['prototype', 'x', 'y'],
          },
        },
      },
      required: ['entities'],
    } as unknown as ToolDefinition['parameters'],
  },
  execute(ctx, input) {
    const list = input.entities;
    if (!Array.isArray(list)) throw new Error('"entities" must be an array');
    let nextUid = ctx.state.nextEntityId;
    const entityChanges: EntityChange[] = [];
    const placed: { uid: number; prototype: string; x: number; y: number }[] = [];
    for (const raw of list) {
      const item = raw as Record<string, unknown>;
      const prototype = str(item, 'prototype');
      const x = Math.floor(num(item, 'x'));
      const y = Math.floor(num(item, 'y'));
      const rotation = (optNum(item, 'rotationDegrees', 0) * Math.PI) / 180;
      const pos = { x: x + 0.5, y: y + 0.5 };
      const uid = nextUid++;
      entityChanges.push({
        action: 'add',
        entity: { uid, prototype, position: pos, rotation, components: buildTransformComponent(pos, rotation, ctx.state.gridUid) },
      });
      placed.push({ uid, prototype, x, y });
    }
    if (entityChanges.length > 0) {
      ctx.dispatch({ type: 'APPLY_COMMAND', command: { label: `AI: place ${entityChanges.length} entities`, tileChanges: [], entityChanges } });
    }
    return { placed };
  },
};

const removeEntities: AgentTool = {
  definition: {
    name: 'remove_entities',
    description: 'Remove entities by UID, or all entities matching a prototype ID within an optional rectangular area.',
    parameters: {
      type: 'object',
      properties: {
        uids: { type: 'array', items: { type: 'number' }, description: 'Specific entity UIDs to remove.' },
        prototype: { type: 'string', description: 'If set, remove entities with this prototype ID instead of by UID.' },
        x1: { type: 'number', description: 'Area filter: min X (inclusive), used with prototype.' },
        y1: { type: 'number', description: 'Area filter: min Y (inclusive), used with prototype.' },
        x2: { type: 'number', description: 'Area filter: max X (inclusive), used with prototype.' },
        y2: { type: 'number', description: 'Area filter: max Y (inclusive), used with prototype.' },
      },
    },
  },
  execute(ctx, input) {
    const uids = Array.isArray(input.uids) ? (input.uids as unknown[]).filter((v): v is number => typeof v === 'number') : [];
    const prototype = optStr(input, 'prototype');
    const hasArea = ['x1', 'y1', 'x2', 'y2'].every(k => typeof input[k] === 'number');
    const uidSet = new Set(uids);

    const toRemove = ctx.state.entities.filter(e => {
      if (uidSet.has(e.uid)) return true;
      if (prototype && e.prototype === prototype) {
        if (!hasArea) return true;
        const x1 = num(input, 'x1'), y1 = num(input, 'y1'), x2 = num(input, 'x2'), y2 = num(input, 'y2');
        const ex = Math.floor(e.position.x), ey = Math.floor(e.position.y);
        return ex >= Math.min(x1, x2) && ex <= Math.max(x1, x2) && ey >= Math.min(y1, y2) && ey <= Math.max(y1, y2);
      }
      return false;
    });

    if (toRemove.length === 0) return { removedCount: 0 };
    ctx.dispatch({
      type: 'APPLY_COMMAND',
      command: {
        label: `AI: remove ${toRemove.length} entities`,
        tileChanges: [],
        entityChanges: toRemove.map(entity => ({ action: 'remove', entity })),
      },
    });
    return { removedCount: toRemove.length, removedUids: toRemove.map(e => e.uid) };
  },
};

// ---- paint_tiles ----

const paintTiles: AgentTool = {
  definition: {
    name: 'paint_tiles',
    description: 'Fill a rectangular area of the floor grid with a single tile prototype ID (e.g. "FloorSteel", "Plating", "Lattice", "Space").',
    parameters: {
      type: 'object',
      properties: {
        tileId: { type: 'string', description: 'Tile prototype ID.' },
        x1: { type: 'number', description: 'Min X (inclusive).' },
        y1: { type: 'number', description: 'Min Y (inclusive).' },
        x2: { type: 'number', description: 'Max X (inclusive).' },
        y2: { type: 'number', description: 'Max Y (inclusive).' },
      },
      required: ['tileId', 'x1', 'y1', 'x2', 'y2'],
    },
  },
  execute(ctx, input) {
    const tileId = str(input, 'tileId');
    const x1 = Math.floor(num(input, 'x1'));
    const y1 = Math.floor(num(input, 'y1'));
    const x2 = Math.floor(num(input, 'x2'));
    const y2 = Math.floor(num(input, 'y2'));
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

    const grid = ctx.state.grids[ctx.state.activeGridIndex].grid;
    const tileChanges: TileChange[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const before = getCell(grid, x, y) ?? { tileId: 'Space' };
        tileChanges.push({ x, y, before, after: { tileId } });
      }
    }
    ctx.dispatch({
      type: 'APPLY_COMMAND',
      command: { label: `AI: paint ${tileId}`, tileChanges, entityChanges: [] },
    });
    return { tilesPainted: tileChanges.length };
  },
};

// ---- draw_pipe / draw_cable ----

const PIPE_PROTOTYPES_BY_FAMILY: Record<PipeFamily, Set<string>> = {
  gas: new Set([
    'GasPipeStraight', 'GasPipeBend', 'GasPipeTJunction', 'GasPipeFourway', 'GasPipeHalf',
    'GasPipeStraightAlt1', 'GasPipeBendAlt1', 'GasPipeTJunctionAlt1', 'GasPipeFourwayAlt1',
    'GasPipeStraightAlt2', 'GasPipeBendAlt2', 'GasPipeTJunctionAlt2', 'GasPipeFourwayAlt2',
  ]),
  disposal: new Set(['DisposalPipe', 'DisposalBend', 'DisposalJunction', 'DisposalYJunction', 'DisposalJunctionFlipped', 'DisposalTrunk']),
};

function entityPipeLayer(e: ImportedEntity): PipeLayer {
  for (const c of e.components) {
    const comp = c as Record<string, unknown>;
    if (comp.type === 'AtmosPipeLayers' && typeof comp.pipeLayer === 'string') {
      return comp.pipeLayer === 'Secondary' || comp.pipeLayer === 'Tertiary' ? comp.pipeLayer : 'Primary';
    }
  }
  if (e.prototype.endsWith('Alt1')) return 'Secondary';
  if (e.prototype.endsWith('Alt2')) return 'Tertiary';
  return 'Primary';
}

function entityPipeColor(e: ImportedEntity): string | null {
  for (const c of e.components) {
    const comp = c as Record<string, unknown>;
    if (comp.type === 'AtmosPipeColor' && typeof comp.color === 'string') return comp.color;
  }
  return null;
}

const drawPipe: AgentTool = {
  definition: {
    name: 'draw_pipe',
    description: 'Draw a run of gas or disposal pipe along a straight line or an L-shaped path between two points, auto-fitting straight/bend/junction pieces the same way the manual pipe tool does. For gas pipes, matching color+layer pipes and adjacent devices (vents, scrubbers, ports) of the same color/layer are treated as connected neighbors.',
    parameters: {
      type: 'object',
      properties: {
        pipeType: { type: 'string', enum: ['supply', 'return', 'disposal'], description: 'supply/return use the standard gas pipe colors; disposal is the waste pipe network.' },
        x1: { type: 'number' }, y1: { type: 'number' },
        x2: { type: 'number' }, y2: { type: 'number' },
        pipeLayer: { type: 'string', enum: ['Primary', 'Secondary', 'Tertiary'], description: 'Gas pipes only. Default Primary.' },
        customColorHex: { type: 'string', description: 'Optional custom hex color (e.g. "#00FF00FF") overriding the supply/return default. Gas pipes only.' },
      },
      required: ['pipeType', 'x1', 'y1', 'x2', 'y2'],
    },
  },
  execute(ctx, input) {
    const pipeType = str(input, 'pipeType') as PipeType;
    const x1 = Math.floor(num(input, 'x1')), y1 = Math.floor(num(input, 'y1'));
    const x2 = Math.floor(num(input, 'x2')), y2 = Math.floor(num(input, 'y2'));
    const layer = (optStr(input, 'pipeLayer') as PipeLayer | undefined) ?? 'Primary';
    const customColor = optStr(input, 'customColorHex');
    const family: PipeFamily = pipeType === 'disposal' ? 'disposal' : 'gas';
    const color = pipeType === 'disposal' ? undefined : (customColor ?? PIPE_COLORS[pipeType as 'supply' | 'return']);

    // Build an L-shaped (or straight) tile path from (x1,y1) to (x2,y2): horizontal then vertical.
    const newTiles: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    const add = (x: number, y: number) => { const k = `${x},${y}`; if (!seen.has(k)) { seen.add(k); newTiles.push({ x, y }); } };
    const stepX = x1 === x2 ? 0 : (x2 > x1 ? 1 : -1);
    for (let x = x1; x !== x2 + stepX; x += stepX || 1) { add(x, y1); if (stepX === 0) break; }
    const stepY = y1 === y2 ? 0 : (y2 > y1 ? 1 : -1);
    for (let y = y1; y !== y2 + stepY; y += stepY || 1) { add(x2, y); if (stepY === 0) break; }

    const protos = PIPE_PROTOTYPES_BY_FAMILY[family];
    const existingPipes = ctx.state.entities.filter(e => {
      if (!protos.has(e.prototype)) return false;
      if (family === 'disposal') return true;
      if (entityPipeLayer(e) !== layer) return false;
      return entityPipeColor(e) === (color ?? null);
    });

    const devicePorts = new Map<string, Set<'N' | 'S' | 'E' | 'W'>>();
    if (family === 'gas' && ctx.state.registry) {
      for (const e of ctx.state.entities) {
        if (protos.has(e.prototype)) continue;
        if (entityPipeLayer(e) !== layer) continue;
        if (entityPipeColor(e) !== (color ?? null)) continue;
        const dirs = getEntityPipeDirections(e, ctx.state.registry);
        if (dirs.size === 0) continue;
        const key = `${Math.floor(e.position.x)},${Math.floor(e.position.y)}`;
        const mapped = new Set<'N' | 'S' | 'E' | 'W'>();
        for (const d of dirs) mapped.add(d[0] as 'N' | 'S' | 'E' | 'W');
        devicePorts.set(key, mapped);
      }
    }

    const { removedUids, fittedPipes } = computePipeChanges(
      newTiles,
      existingPipes.map(e => ({ uid: e.uid, x: Math.floor(e.position.x), y: Math.floor(e.position.y) })),
      family, color, layer, devicePorts,
    );

    const entityChanges: EntityChange[] = [];
    for (const uid of removedUids) {
      const entity = ctx.state.entities.find(e => e.uid === uid);
      if (entity) entityChanges.push({ action: 'remove', entity });
    }
    let nextUid = ctx.state.nextEntityId;
    for (const pipe of fittedPipes) {
      const pos = { x: pipe.x + 0.5, y: pipe.y + 0.5 };
      const components = buildTransformComponent(pos, pipe.rotation, ctx.state.gridUid);
      if (pipe.color) components.push({ type: 'AtmosPipeColor', color: pipe.color });
      if (pipe.pipeLayer) components.push({ type: 'AtmosPipeLayers', pipeLayer: pipe.pipeLayer });
      entityChanges.push({ action: 'add', entity: { uid: nextUid++, prototype: pipe.prototype, position: pos, rotation: pipe.rotation, components } });
    }
    if (entityChanges.length > 0) {
      ctx.dispatch({ type: 'APPLY_COMMAND', command: { label: `AI: draw ${pipeType} pipe`, tileChanges: [], entityChanges } });
    }
    return { tilesPlaced: newTiles.length, entitiesChanged: entityChanges.length };
  },
};

const drawCable: AgentTool = {
  definition: {
    name: 'draw_cable',
    description: 'Lay a straight or L-shaped run of power cable (one entity per tile; the game auto-connects adjacent cables of the same type, no fitting needed).',
    parameters: {
      type: 'object',
      properties: {
        cableType: { type: 'string', enum: ['CableHV', 'CableMV', 'CableApcExtension'] },
        x1: { type: 'number' }, y1: { type: 'number' },
        x2: { type: 'number' }, y2: { type: 'number' },
      },
      required: ['cableType', 'x1', 'y1', 'x2', 'y2'],
    },
  },
  execute(ctx, input) {
    const cableType = str(input, 'cableType');
    const x1 = Math.floor(num(input, 'x1')), y1 = Math.floor(num(input, 'y1'));
    const x2 = Math.floor(num(input, 'x2')), y2 = Math.floor(num(input, 'y2'));

    const newTiles: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    const add = (x: number, y: number) => { const k = `${x},${y}`; if (!seen.has(k)) { seen.add(k); newTiles.push({ x, y }); } };
    const stepX = x1 === x2 ? 0 : (x2 > x1 ? 1 : -1);
    for (let x = x1; x !== x2 + stepX; x += stepX || 1) { add(x, y1); if (stepX === 0) break; }
    const stepY = y1 === y2 ? 0 : (y2 > y1 ? 1 : -1);
    for (let y = y1; y !== y2 + stepY; y += stepY || 1) { add(x2, y); if (stepY === 0) break; }

    const existingPositions = new Set<string>();
    for (const e of ctx.state.entities) {
      if (e.prototype === cableType) existingPositions.add(`${Math.floor(e.position.x)},${Math.floor(e.position.y)}`);
    }
    const toPlace = newTiles.filter(t => !existingPositions.has(`${t.x},${t.y}`));
    if (toPlace.length === 0) return { placedCount: 0 };

    let nextUid = ctx.state.nextEntityId;
    const entityChanges: EntityChange[] = toPlace.map(t => {
      const pos = { x: t.x + 0.5, y: t.y + 0.5 };
      return { action: 'add', entity: { uid: nextUid++, prototype: cableType, position: pos, rotation: 0, components: buildTransformComponent(pos, 0, ctx.state.gridUid) } };
    });
    ctx.dispatch({ type: 'APPLY_COMMAND', command: { label: `AI: draw ${cableType}`, tileChanges: [], entityChanges } });
    return { placedCount: toPlace.length };
  },
};

// ---- validate_map ----

const validateMapTool: AgentTool = {
  definition: {
    name: 'validate_map',
    description: 'Run the map validator and return a summary of issues found (unconnected pipes/devices, floors under walls, abstract prototypes, etc). Use this to check your own work after making changes, or when the user asks to check the map.',
    parameters: { type: 'object', properties: {} },
  },
  execute(ctx) {
    if (!ctx.state.registry) return { error: 'Prototype registry not loaded yet.' };
    const activeGrid = ctx.state.grids[ctx.state.activeGridIndex];
    const issues = validateMap(activeGrid.grid, activeGrid.entities, ctx.state.registry);
    const byRule = new Map<string, number>();
    for (const issue of issues) byRule.set(issue.ruleId, (byRule.get(issue.ruleId) ?? 0) + 1);
    return {
      totalIssues: issues.length,
      countsByRule: Object.fromEntries(byRule),
      // Cap the detailed list so a huge map doesn't blow up the model's context.
      issues: issues.slice(0, 50).map(i => ({ rule: i.ruleId, severity: i.severity, message: i.message, x: i.x, y: i.y, entityUid: i.entityUid })),
      truncated: issues.length > 50,
    };
  },
};

// ---- get_map_info ----

const getMapInfo: AgentTool = {
  definition: {
    name: 'get_map_info',
    description: 'Get a summary of the current map: grid bounds, entity count, and a sample/list of entities (optionally filtered by prototype or area). Use this to understand what\'s already on the map before placing more things.',
    parameters: {
      type: 'object',
      properties: {
        prototype: { type: 'string', description: 'Only list entities with this prototype ID.' },
        x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
        limit: { type: 'number', description: 'Max entities to list in detail. Default 100.' },
      },
    },
  },
  execute(ctx, input) {
    const activeGrid = ctx.state.grids[ctx.state.activeGridIndex];
    const grid = activeGrid.grid;
    const prototype = optStr(input, 'prototype');
    const hasArea = ['x1', 'y1', 'x2', 'y2'].every(k => typeof input[k] === 'number');
    const limit = optNum(input, 'limit', 100);

    let entities = activeGrid.entities;
    if (prototype) entities = entities.filter(e => e.prototype === prototype);
    if (hasArea) {
      const x1 = num(input, 'x1'), y1 = num(input, 'y1'), x2 = num(input, 'x2'), y2 = num(input, 'y2');
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      entities = entities.filter(e => {
        const ex = Math.floor(e.position.x), ey = Math.floor(e.position.y);
        return ex >= minX && ex <= maxX && ey >= minY && ey <= maxY;
      });
    }

    return {
      gridBounds: { offsetX: grid.offsetX, offsetY: grid.offsetY, width: grid.width, height: grid.height },
      totalEntitiesMatched: entities.length,
      entities: entities.slice(0, limit).map(e => ({
        uid: e.uid, prototype: e.prototype,
        x: Math.floor(e.position.x), y: Math.floor(e.position.y),
        rotationDegrees: Math.round((e.rotation * 180) / Math.PI),
      })),
      truncated: entities.length > limit,
    };
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  getMapInfo, placeEntity, placeEntities, removeEntities, paintTiles, drawPipe, drawCable, validateMapTool,
];

export function getToolDefinitions(): ToolDefinition[] {
  return AGENT_TOOLS.map(t => t.definition);
}

export function executeAgentTool(name: string, input: Record<string, unknown>, ctx: AgentToolContext): unknown {
  const tool = AGENT_TOOLS.find(t => t.definition.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}"`);
  return tool.execute(ctx, input);
}
