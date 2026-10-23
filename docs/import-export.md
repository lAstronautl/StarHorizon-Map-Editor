# Import / Export Pipeline

The import/export pipeline handles loading and saving SS14 map files (`.yml`). It is designed for lossless roundtripping, importing a map and immediately exporting it should produce an equivalent file.

## SS14 Map Format

The editor supports format 6 and format 7 maps.

### Format 6

```yaml
meta:
  format: 6
  postmapinit: false

tilemap:
  0: Space
  1: FloorSteel

entities:
- proto: ""           # Structural entities (map + grid)
  entities:
  - uid: 0            # Map entity
    components: [MetaData, Transform, Map, Broadphase, OccluderTree]
  - uid: 1            # Grid entity
    components: [MetaData, Transform, MapGrid]
- proto: APCBasic     # Placed entities grouped by prototype
  entities:
  - uid: 100
    components: [Transform, Battery, ...]
```

### Format 7 (additional top-level keys)

```yaml
meta:
  format: 7
  category: Map
  engineVersion: 272.0.0
  forkId: ""
  forkVersion: ""
  time: 02/27/2026 23:57:02
  entityCount: 3112

maps:
- 1
grids:
- 2
orphans: []
nullspace: []

tilemap:
  0: Space
  ...

entities:
  ...
```

Format 7 adds `maps`, `grids`, `orphans`, `nullspace` top-level sections and additional meta fields (`category`, `engineVersion`, `forkId`, `forkVersion`, `time`, `entityCount`). `postmapinit` exists only in format 6 and older; the format 7 loader ignores it, so it is not written.

The engine reads all four lists with `Get<SequenceDataNode>`, so an empty list must be written `[]`, never a bare `maps:` (that is a null node and the load throws).

### File categories

`meta.category` tells the loader what the file contains, and the lists have to agree with it (the exporter derives the lists from the entities it writes, then picks the category the engine would infer):

| Category | `maps` | `grids` | `orphans` | Made by |
|----------|--------|---------|-----------|---------|
| `Map` | the map entity | every grid | `[]` | `savemap`, **Export .yml** |
| `Grid` | `[]` | the one grid | the same grid | `savegrid`, shuttles, **Export Grid** |

An orphan is an entity saved with `parent: invalid`: in a grid file that is the grid itself, which has no map to hang off.

### Tile Chunks

Tiles are stored in 16x16 chunks within the grid entity's `MapGrid` component. Each chunk is keyed by chunk coordinate (e.g., `"-1,0"`). Tile data is base64-encoded:

| Format | Bytes/Tile | Layout |
|--------|-----------|--------|
| 6 | 6 | int32 LE typeId + uint8 flags + uint8 variant |
| 7 | 7 | int32 LE typeId + uint8 flags + uint8 variant + uint8 rotationMirroring |
| Legacy | 4 | uint32 LE typeId only |

The `rotationMirroring` byte (format 7) encodes tile rotation: 0-3 = cardinal directions, 4-7 = mirrored variants.

Total: 256 tiles x bytes/tile per chunk.

## Architecture

```
Import                              Export
------                              ------
YAML string                         ImportedMap
    |                                   |
    v                                   v
yaml.load() with SS14_SCHEMA        Build tilemap (scan unique tiles)
    |                                   |
    v                                   v
Parse meta (all fields)             Encode chunks (format-aware encoding)
    |                                   |
    v                                   v
Parse tilemap                       Emit meta + top-level keys (format 7)
    |                                   |
    v                                   v
Find MapGrid, decode chunks         Emit structural entities (preserved)
(preserve flags/variant/rotation)       |
    |                                   v
    v                               Group entities by prototype
Parse entity groups                     |
(preserve all components verbatim)      v
    |                               YAML string
    v
ImportedMap
```

## Key Types

```typescript
interface MapMeta {
  format: number;
  postmapinit: boolean;
  category?: string;        // "Map" | "Grid" etc
  engineVersion?: string;   // e.g., "272.0.0"
  forkId?: string;
  forkVersion?: string;
  time?: string;
  entityCount?: number;
}

interface ImportedMap {
  meta: MapMeta;
  tilemap: Record<number, string>;
  grid: { width, height, offsetX, offsetY, cells: TileCell[] };
  entities: ImportedEntity[];
  gridUid: number;
  mapUid: number;
  maps?: number[];           // Format 7+ top-level maps array
  grids?: number[];          // Format 7+ top-level grids array
  structuralEntityData?: Record<number, Record<string, unknown>[]>;
}

interface TileCell {
  tileId: string;
  flags?: number;            // Preserved from import
  variant?: number;          // Preserved from import
  rotationMirroring?: number; // Format 7+ only
}

interface ImportedEntity {
  uid: number;
  prototype: string;
  position: { x: number; y: number };
  rotation: number;
  components: Record<string, unknown>[];  // preserved verbatim
}
```

## Component Preservation

The pipeline preserves all entity component data verbatim. Components the editor doesn't understand (custom machine configs, access lists, etc.) are stored as raw parsed objects during import and written back unchanged during export. Only the Transform component's `pos` and `rot` fields are parsed for position/rotation.

### Structural Entity Preservation

Structural entities (map entity, grid entity) have their components preserved in `structuralEntityData`. On export, these are written back verbatim (with the MapGrid chunks rebuilt from the grid). This ensures components like `GridTree`, `Broadphase`, `OccluderTree`, and custom MetaData names survive roundtrip.

### SS14 YAML Tags

SS14 uses custom YAML tags (`!type:SoundPathSpecifier`, `!type:Color`, etc.). These are handled by `SS14_SCHEMA` in `src/import/ss14Schema.ts`:
- **Import**: Tags are parsed and wrapped with `_ss14Tag` metadata
- **Export**: `stripInternalTags()` unwraps the metadata before emitting

## Multi-Grid Import/Export

### Import

The importer returns `gridDataList: GridData[]`, one entry per grid entity found in the map file. Each `GridData` contains:

- Its own `grid` (TileGrid), `entities`, `containedEntities`
- Its own `chunkKeyOrder` and `structuralComponents` for roundtrip fidelity
- A `gridUid` matching the grid entity's UID

Entity parenting is resolved by the Transform `parent` field, each entity is assigned to the grid whose UID matches its parent.

### Export

The exporter builds chunks independently per grid via `buildGridChunksMap()`. Each grid's tiles are encoded into its own set of 16x16 chunks under the corresponding grid entity's `MapGrid` component. Structural entity data is written back per grid from preserved `structuralComponents`.

### Roundtrip Fidelity

Roundtrip tests verify byte-exact fidelity for multi-grid maps including Bagel, Box, Cork, Oasis, and Fland. Edit isolation tests verify that editing one grid (adding/removing tiles or entities) does not corrupt other grids' data.

## Matching what the game writes

The exporter follows `EntitySerializer` so a saved file loads without being fixed by hand:

- **Header**: `meta` is `format, category, engineVersion, forkId, forkVersion, time, entityCount`, then `maps, grids, orphans, nullspace, tilemap, entities`, and the document ends with `...`. New maps get `engineVersion` of this fork's engine (`ENGINE_VERSION` in `src/export/gridStructure.ts`).
- **Order**: the `proto: ""` group (map and grids) first by uid, then prototype groups sorted like `StringComparer.InvariantCulture`, entities by ascending uid inside a group, tilemap by engine tile id (`Space` first). Existing uids are never renumbered.
- **Tiles**: `variant`, `flags` and `rotationMirroring` of imported tiles are kept. Tools replace a cell with a fresh `{ tileId }` when they repaint it, so a stale variant never lands on another tile type.
- **Grids**: every grid of the editor is written, each with its own `chunks`. A grid that has no tiles is left out (the game deletes empty grids, `game.delete_empty_grids`), as is everything on it, because an empty `chunks:` does not load.
- **Added grids** get a full grid entity: `MetaData` (only if renamed), `Transform` (parent = the map), `MapGrid`, `Broadphase`, `Physics` (`Dynamic`), `Fixtures`, `OccluderTree`, `Shuttle`, `GridPathfinding`, `Gravity`, `SpreaderGrid` (see `defaultGridComponents`). A grid cut from a selection copies these from its source grid instead.
- **No map in the file** (a grid file that gained a second grid, or a blank map): a map entity is generated (`defaultMapComponents`) and the grids are re-parented to it.
- **Uids**: `1` is the map and `2` the first grid of a new map. Entities and grids share one counter, and loading a file starts the counter above every uid in it (including the map and grid entities, which are not in any entity list).
- **Entities written from components** (edited, placed or pasted ones) are reattached to their grid if their `Transform.parent` is missing or points at an entity that is not in the file; ones the file declared as orphans/nullspace keep having no parent.
- **Values**: the component re-serializer handles multi-line and `\r` strings, trailing newlines (`|+`), keys that need quoting, `null`, and empty tagged mappings (`!type:ContainerSlot {}`); containers made in the editor are `!type:Container` with `showEnts`/`occludes`.
- Export never modifies the editor state.

Importing then exporting every map in `Resources/Maps` (506 files) produces YAML that passes the engine's load rules, with the same entities and tiles; with all raw lines dropped (worst case: every entity edited) it differs from the game's own output in only a few lines per map (the order of integer keys inside dictionaries).

## Grid files

**File → Export Grid** (and the save button on a grid tab) writes one grid as `category: Grid`, like a shuttle file:

- the grid is the only orphan (`parent: invalid`), its position and rotation are kept, the map entity and the map components of a grid that is also a map are dropped;
- only the entities on that grid (and what is in their containers) are written, with their uids;
- references that point out of the file (docked partners, `Joint`, device links to other grids, container contents left behind) are removed with `remapEntityRefs`, using the list of entity-reference fields generated from the game's C# components (`npm run` does not need it; regenerate with `node scripts/extract-entity-ref-fields.mjs <game repo>` when components change);
- the tilemap lists only the tiles used, and decals come from the editor's decal state.

A grid with no tiles can't be saved.

### Selection → grid

Right click on a selection (Select tool):

- **Save as Grid (.yml)** cuts the selected tiles, the entities standing on them (with container contents) and the decals under them into a stand-alone grid file; the map is untouched.
- **Move to new Grid** does the same into a new grid tab and removes the selection from the source grid (undo it in two steps: the new grid, then the removal).

The cut-out keeps tile variants and entity uids, sits where the selection was (the source grid's position and rotation plus the selection corner), and copies the source grid's components except those describing the source station (`BecomesStation`, `GridAtmosphere`, `DecalGrid`, ...). Unlike **Save as Prefab**, the selection mask is used tile by tile and the result is a real grid, not a stamp.

## DecalGrid Export

Decals are stored in the grid entity's `DecalGrid` component. When decals on a grid have been modified (added, removed, moved, or properties changed), the exporter re-serializes the `DecalGrid` component from the editor's decal data. Unmodified grids preserve the original raw YAML for byte-exact roundtrip fidelity.

## Files

| File | Purpose |
|------|---------|
| `src/import/mapImporter.ts` | YAML → ImportedMap |
| `src/import/ss14Schema.ts` | Custom js-yaml schema for `!type:` tags |
| `src/import/chunkDecoder.ts` | Base64 chunk decode/encode utilities |
| `src/export/mapExporter.ts` | ImportedMap → YAML (map files) |
| `src/export/gridStructure.ts` | Map/grid entity components, float32 formatting, uid helpers |
| `src/export/gridExporter.ts` | One grid → `category: Grid` file |
| `src/export/stateToMap.ts` | Editor state → `ImportedMap` |
| `src/grid/extractGrid.ts` | Selection → `GridData` |
| `src/grid/entityRefs.ts` | Remap/drop entity references in components |
| `src/grid/entityRefFields.generated.ts` | Which component fields hold entity uids (generated) |

## Testing

- **Unit tests**, Chunk decoding/encoding roundtrip
- **Importer tests**, 10 tests covering meta, tilemap, grid, entities, positions, rotations, component preservation
- **Exporter tests**, 6 tests covering YAML generation, tilemap, grid tiles, entity preservation
- **Roundtrip tests**, 13 tests verifying import → export → reimport produces identical data, including double roundtrip stability
- **Real map roundtrip**, 8 tests loading Reach.yml (3,112 entities) and verifying lossless roundtrip
- **Game parity** (`src/__tests__/gameParity.test.ts`, `reserializeFidelity.test.ts`, `export/__tests__/gridExporter.test.ts`): import → export every map of the game, then check the result with `test-utils/engineValidator.ts`, which encodes the engine's load rules (lists are sequences, category matches content, uids unique, parents exist, chunk sizes and tile ids valid, order canonical). A sample runs by default; `SS14_PARITY_FULL=1 npm test` runs all 506 maps.
- The tests find the maps in `SS14_MAPS_DIR`, else in a sibling `StarHorizon/Resources/Maps` (`test-utils/realMaps.ts`).
