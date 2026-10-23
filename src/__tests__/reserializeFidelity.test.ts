/// <reference types="node" />
/**
 * Edited entities lose their raw YAML lines and go through the component re-serializer.
 * Simulate that for every entity of real game maps (drop all raw lines), then re-import and
 * require identical component data. Sample by default, SS14_PARITY_FULL=1 for the whole corpus.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { importMap, type ImportedEntity } from '../import/mapImporter';
import { exportMap } from '../export/mapExporter';
import { findMapFiles, resolveMapsDir } from '../test-utils/realMaps';
import { validateEngineYaml } from '../test-utils/engineValidator';

const MAPS_DIR = resolveMapsDir();
const FULL = process.env.SS14_PARITY_FULL === '1';
const all = findMapFiles(MAPS_DIR);
const files = FULL ? all : all.filter((_, i) => i % 10 === 3);

function collect(m: ReturnType<typeof importMap>): Map<number, ImportedEntity> {
  const out = new Map<number, ImportedEntity>();
  for (const gd of m.gridDataList ?? []) {
    for (const e of gd.entities) out.set(e.uid, e);
    for (const kids of Object.values(gd.containedEntities)) for (const e of kids) out.set(e.uid, e);
  }
  return out;
}

/** JSON with sorted keys: the order of keys inside a component is irrelevant to the engine. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val);
}

describe.skipIf(files.length === 0)('re-serializer fidelity on real maps', () => {
  for (const file of files) {
    it(file.slice(MAPS_DIR.length + 1), () => {
      const text = readFileSync(file, 'utf-8');
      if (validateEngineYaml(text).errors.length > 0) return;
      const map = importMap(text);
      const before = collect(map);

      map.entityRawComponents = {};
      const exported = exportMap(map);
      const after = collect(importMap(exported));

      expect(after.size).toBe(before.size);
      const bad: string[] = [];
      for (const [uid, e] of before) {
        const a = after.get(uid);
        if (!a) { bad.push(`uid ${uid} (${e.prototype}) missing`); continue; }
        const x = canon(e.components), y = canon(a.components);
        if (x !== y && bad.length < 5) {
          let i = 0; while (i < x.length && x[i] === y[i]) i++;
          bad.push(`uid ${uid} ${e.prototype}: ...${x.slice(Math.max(0, i - 60), i + 80)}\n   vs ...${y.slice(Math.max(0, i - 60), i + 80)}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
