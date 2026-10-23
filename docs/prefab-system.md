# Prefab System

## Overview

Prefabs are reusable map regions saved as `.prefab.json` files. They capture tiles, entities (with the contents of their containers), decals, and device links from a selection, and can be stamped onto any map with full SS14 export correctness. To keep a region as a real grid instead of a stamp, see *Selection → grid* in `import-export.md`.

## File Format

A `.prefab.json` file containing a self-contained room/region:

```json
{
  "version": 2,
  "name": "Surgery Room",
  "width": 7,
  "height": 5,
  "tiles": [
    { "dx": 0, "dy": 0, "tileId": "FloorWhite" },
    { "dx": 1, "dy": 0, "tileId": "FloorWhite" }
  ],
  "entities": [
    {
      "dx": 2.5, "dy": 1.5,
      "prototype": "OperatingTable",
      "rotation": 0,
      "components": [{ "type": "Transform" }],
      "srcUid": 412
    },
    {
      "dx": 0, "dy": 0,
      "prototype": "Scalpel",
      "rotation": 0,
      "components": [{ "type": "Transform" }],
      "srcUid": 413,
      "containerIdx": 0
    }
  ],
  "deviceLinks": [
    { "sourceIdx": 0, "targetIdx": 1, "port": "Pressed", "sink": "Toggle" }
  ],
  "decals": [
    { "dx": 1.5, "dy": 2.25, "prototypeId": "DecalCaution", "color": null, "angle": 0, "zIndex": 0, "cleanable": false }
  ]
}
```

Key design points:

- **Sprite state overrides**, `PrefabEntity` includes an optional `spriteStateOverride?: string` field. If present, it is serialized into the `.prefab.json` file and restored on placement, preserving the visual state chosen via the Sprite State Selector.
- **Sparse tiles**, Only non-Space tiles are stored. Space tiles are omitted.
- **Versions**, `version: 2` files store exact offsets: entity and decal `dx`/`dy` are `position - minBound`, so an entity keeps its place inside the tile (a wall light at `x.25` stays there). Files without `version` (saved by older editors) store whole-tile entity offsets; they are centered on the tile when placed, as before. Tile `dx`/`dy` are always whole tiles.
- **Selection mask**, only the selected tiles are captured (an L-shaped selection gives an L-shaped prefab), plus the entities and decals on them.
- **Containers**, entities inside containers (`containerIdx` = index of the container entity) are saved and placed with it. They have no position of their own.
- **Source uids**, `srcUid` is the uid the entity had where it was saved. On placement it lets references between prefab entities (container contents, `DeviceList`, `DeviceLinkSource`, ...) follow them to their new uids.
- **Decals**, Optional `decals` array, omitted entirely from the file when the selection contains none. Older `.prefab.json` files without this field still load fine, they just place no decals.
- **No raw YAML**, `rawYamlLines` is no longer written: the lines carry the source map's uids and positions, so a placed entity is always exported from its components. Older files that still contain it load fine (the field is ignored).
- **Index-based device links**, Links reference entities by array index, not UIDs. New UIDs are assigned when the prefab is stamped.
- **Device link serialization**, Uses `DeviceLinkSource.linkedPorts` (not `DeviceList.devices`) to capture port/sink pairs. Each entry in `linkedPorts` maps a target UID to an array of `[port, sink]` pairs.
- **Entity position on placement**, When stamped, entity world position is `placeX + dx, placeY + dy` (version 2) or `placeX + dx + 0.5, placeY + dy + 0.5` (older files).
- **Parent and references on placement**, `Transform.parent` is set to the grid the prefab is placed on (the one in the file belongs to the map it was saved from). References to other entities are translated to the new uids; references to entities outside the prefab are dropped, since that uid would mean something else in the destination map. Prefabs without `srcUid` lose such references but get their device links rebuilt from `deviceLinks`.

### Validation

`parsePrefabJson()` validates that all 6 required fields (`name`, `width`, `height`, `tiles`, `entities`, `deviceLinks`) are present and correctly typed. `decals` is optional for backward compatibility. Invalid files throw descriptive errors.

## Creating a Prefab

1. Select a region with the Select Tool (S)
2. Right-click → "Save as Prefab..."
3. Enter a name in the prompt dialog
4. File downloads as `name.prefab.json`

The prefab image import (`ImageImportPanel`) builds version 2 prefabs, so a pixel's entity sits on the pixel's own tile.

## Placing a Prefab

1. Open the **Prefabs** tab in the palette panel
2. The panel auto-loads all `.prefab.json` files from `public/prefabs/` on startup
3. Click a prefab entry to enter placement mode
4. Ghost preview follows cursor showing footprint, tiles, and entity positions
5. Click to stamp, creates a single undoable command
6. Stay in placement mode to stamp multiple copies
7. Switch tools or Escape to exit

You can also import individual files via the **+** button, and hit **↻** to refresh after adding new files to the directory.

## Directory Structure

Save prefabs under `public/prefabs/` in the map_creator project. Subdirectories become collapsible folder groups in the panel:

```
public/prefabs/
  medical/
    surgery-room.prefab.json
    chemistry-lab.prefab.json
  engineering/
    smes-room.prefab.json
    atmos-setup.prefab.json
  common-rooms.prefab.json
```

The dev server provides a `/__api/prefabs` endpoint that lists all `.prefab.json` files recursively. The panel fetches this on mount and on refresh.

## Conflict Handling

Stamping overwrites the footprint: tiles are replaced, existing entities in the footprint are removed, then prefab entities are placed with fresh UIDs. Decals are additive (they can stack, like normal decal placement) and are placed with fresh IDs; existing decals in the footprint are left untouched.

## Export Correctness

Placed entities are exported by the component re-serializer in `src/export/mapExporter.ts`, which was checked against every map in the game (see `import-export.md`): parents point at the destination grid, uids don't collide with anything in the map, container contents are listed once, and references are valid.

## Source Files

| File | Purpose |
|------|---------|
| `src/prefab/prefabTypes.ts` | `PrefabData`, `PrefabEntity`, `PrefabDeviceLink` interfaces |
| `src/prefab/prefabSerializer.ts` | Capture editor region → `PrefabData` |
| `src/prefab/prefabPlacer.ts` | Stamp `PrefabData` → `Command` for dispatch |
| `src/prefab/prefabIO.ts` | JSON parse/stringify, browser file download |
| `src/tools/prefabPlaceTool.ts` | Tool for cursor-following ghost preview + click-to-stamp |
| `src/components/PrefabPanel.tsx` | Library panel with file import and directory browsing |
| `src/components/ContextMenu.tsx` | Generic right-click context menu |
