/** A sparse tile entry, only non-Space tiles are stored. */
export interface PrefabTile {
  dx: number;
  dy: number;
  tileId: string;
}

/** An entity stored relative to the prefab's top-left corner. */
export interface PrefabEntity {
  dx: number;
  dy: number;
  prototype: string;
  rotation: number;
  components: Record<string, unknown>[];
  /** Verbatim YAML lines for byte-exact export roundtrip. */
  rawYamlLines?: string[];
  /** Editor-only RSI state override for visual rendering. */
  spriteStateOverride?: string;
  /** Uid this entity had where the prefab was saved; lets references between prefab entities be remapped. */
  srcUid?: number;
  /** Index (in `entities`) of the container this entity sits in. Such entities have no position of their own. */
  containerIdx?: number;
}

/** A device link between two entities, referenced by index in the entities array. */
export interface PrefabDeviceLink {
  sourceIdx: number;
  targetIdx: number;
  port: string;
  sink: string;
}

/** A decal stored relative to the prefab's top-left corner. */
export interface PrefabDecal {
  dx: number;
  dy: number;
  prototypeId: string;
  color: string | null;
  angle: number;
  zIndex: number;
  cleanable: boolean;
}

/** The complete prefab file format (serialized as `.prefab.json`). */
export interface PrefabData {
  /**
   * 2 = entity offsets (`dx`/`dy`) are exact distances from the prefab corner, so an entity keeps
   * its position inside the tile. Absent (older files) = offsets are whole tiles; entities are
   * centered on the tile when placed.
   */
  version?: number;
  name: string;
  width: number;
  height: number;
  tiles: PrefabTile[];
  entities: PrefabEntity[];
  deviceLinks: PrefabDeviceLink[];
  /** Optional for backward compatibility with prefabs saved before decal support. */
  decals?: PrefabDecal[];
}
