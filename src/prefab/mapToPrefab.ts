import { importMap } from '../import/mapImporter';
import { serializePrefab } from './prefabSerializer';
import type { PrefabData } from './prefabTypes';

/**
 * Convert a whole SS14 map YAML file into a PrefabData, so a full station/shuttle
 * export can be dropped into the Prefabs panel and stamped elsewhere, without
 * needing a dedicated .prefab.json export step first. Uses the primary grid only;
 * multi-grid maps only convert their main grid (map.grid/map.entities alias).
 */
export function mapToPrefab(yamlContent: string, name: string): PrefabData {
  const map = importMap(yamlContent);
  const { grid } = map;
  const minX = grid.offsetX;
  const minY = grid.offsetY;
  const maxX = grid.offsetX + grid.width - 1;
  const maxY = grid.offsetY + grid.height - 1;

  return serializePrefab({
    name,
    minX, minY, maxX, maxY,
    grid,
    entities: map.entities,
    entityRawComponents: map.entityRawComponents ?? {},
    decals: map.gridDataList?.find(g => g.gridUid === map.gridUid)?.decals.decals,
  });
}
