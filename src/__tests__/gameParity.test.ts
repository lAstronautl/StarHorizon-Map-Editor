/// <reference types="node" />
/**
 * Game parity: import real game maps, export them again and check the output against the
 * engine's load rules (see test-utils/engineValidator). A deterministic sample runs by
 * default; set SS14_PARITY_FULL=1 to run the entire Resources/Maps corpus.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { importMap } from '../import/mapImporter';
import { exportMap } from '../export/mapExporter';
import { findMapFiles, resolveMapsDir } from '../test-utils/realMaps';
import { validateEngineYaml } from '../test-utils/engineValidator';

const MAPS_DIR = resolveMapsDir();
const FULL = process.env.SS14_PARITY_FULL === '1';

function sampleFiles(): string[] {
  const all = findMapFiles(MAPS_DIR);
  if (FULL) return all;
  const picked = new Set<string>();
  all.forEach((f, i) => { if (i % 12 === 0) picked.add(f); });
  // Always cover grid-category files (shuttles/POIs), they use a different header than maps.
  let grids = 0;
  for (const f of all) {
    if (grids >= 12) break;
    if (readFileSync(f, 'utf-8').slice(0, 300).includes('category: Grid')) { picked.add(f); grids += 2; }
  }
  return [...picked];
}

const files = sampleFiles();
const dir = (f: string) => f.slice(MAPS_DIR.length + 1);

describe.skipIf(files.length === 0)('game parity (import -> export -> engine rules)', () => {
  for (const file of files) {
    it(dir(file), () => {
      const yamlText = readFileSync(file, 'utf-8');
      const original = validateEngineYaml(yamlText);
      // A few hand-edited game maps are not valid YAML (duplicate keys); nothing to compare there.
      if (original.errors.length > 0) return;

      const map = importMap(yamlText);
      const exported = exportMap(map);
      const result = validateEngineYaml(exported, { checkOrdering: true });

      expect(result.errors, 'exported YAML breaks engine load rules').toEqual([]);
      expect(result.entityCount, 'entities lost or duplicated').toBe(original.entityCount);
      expect(result.category).toBe(original.category);
      expect(result.bareTags, 'tagged empty mappings lost their body').toBeLessThanOrEqual(original.bareTags);

      // Tiles survive the trip, including variant/flags/rotation bytes.
      const again = importMap(exported);
      expect(again.gridDataList!.length).toBe(map.gridDataList!.length);
      map.gridDataList!.forEach((g, i) => {
        const r = again.gridDataList![i];
        expect(r.grid.cells.length).toBe(g.grid.cells.length);
        for (let c = 0; c < g.grid.cells.length; c++) {
          const a = g.grid.cells[c], b = r.grid.cells[c];
          if (a.tileId !== b.tileId || (a.variant ?? 0) !== (b.variant ?? 0) ||
              (a.flags ?? 0) !== (b.flags ?? 0) || (a.rotationMirroring ?? 0) !== (b.rotationMirroring ?? 0)) {
            expect.fail(`grid ${g.gridUid} cell ${c}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
          }
        }
      });
    });
  }
});
