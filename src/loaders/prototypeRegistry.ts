import type { ResolvedTile, ResolvedEntity, DecalPrototypeInfo, SpriteInfo, IPrototypeRegistry } from './registryTypes';

export class PrototypeRegistry implements IPrototypeRegistry {
  private tiles: Map<string, ResolvedTile>;
  private entities: Map<string, ResolvedEntity>;
  private decals: Map<string, DecalPrototypeInfo>;
  private categoryIndex: Map<string, ResolvedEntity[]>;
  private abstractIds: Set<string>;

  constructor(
    tiles: Map<string, ResolvedTile>,
    entities: Map<string, ResolvedEntity>,
    decals: Map<string, DecalPrototypeInfo> = new Map(),
    abstractIds: Set<string> = new Set(),
  ) {
    this.tiles = tiles;
    this.entities = entities;
    this.decals = decals;
    this.abstractIds = abstractIds;
    this.categoryIndex = new Map();
    for (const entity of entities.values()) {
      const cat = entity.sourceCategory;
      if (!this.categoryIndex.has(cat)) this.categoryIndex.set(cat, []);
      this.categoryIndex.get(cat)!.push(entity);
    }
  }

  getTile(id: string): ResolvedTile | null { return this.tiles.get(id) ?? null; }
  getEntity(id: string): ResolvedEntity | null { return this.entities.get(id) ?? null; }
  getDecal(id: string): DecalPrototypeInfo | null { return this.decals.get(id) ?? null; }
  getAllDecals(): DecalPrototypeInfo[] { return Array.from(this.decals.values()); }
  getAllTiles(): ResolvedTile[] { return Array.from(this.tiles.values()); }
  getAllEntities(): ResolvedEntity[] { return Array.from(this.entities.values()); }
  getEntitiesByCategory(category: string): ResolvedEntity[] { return this.categoryIndex.get(category) ?? []; }
  getCategories(): string[] { return Array.from(this.categoryIndex.keys()).sort(); }
  getSpriteInfo(entityId: string): SpriteInfo | null { return this.entities.get(entityId)?.spriteInfo ?? null; }
  isAbstractPrototype(id: string): boolean { return this.abstractIds.has(id); }
  get tileCount(): number { return this.tiles.size; }
  get entityCount(): number { return this.entities.size; }
  get decalCount(): number { return this.decals.size; }
}
