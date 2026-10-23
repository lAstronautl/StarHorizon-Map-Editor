import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { findMapFiles, resolveMapsDir } from '../test-utils/realMaps';
import { validateEngineYaml } from '../test-utils/engineValidator';
import { importMap } from '../import/mapImporter';
import { exportMap } from '../export/mapExporter';
it('hist', () => {
  const hist: Record<string, number> = {}; let n = 0;
  const files = findMapFiles(resolveMapsDir()).filter((_, i) => i % 6 === 0);
  for (const f of files) {
    const t = readFileSync(f, 'utf-8');
    if (validateEngineYaml(t).errors.length) continue;
    n++;
    let ex: string; try { ex = exportMap(importMap(t)); } catch (e) { hist['THROW ' + (e as Error).message.slice(0, 60)] = (hist['THROW ' + (e as Error).message.slice(0, 60)] ?? 0) + 1; continue; }
    const r = validateEngineYaml(ex);
    const o = validateEngineYaml(t);
    if (r.entityCount !== o.entityCount) hist['entityCount differs'] = (hist['entityCount differs'] ?? 0) + 1;
    if (r.bareTags > o.bareTags) hist['bareTags up'] = (hist['bareTags up'] ?? 0) + 1;
    for (const e of new Set(r.errors.map(e => e.replace(/\d+/g, 'N').slice(0, 100)))) hist[e] = (hist[e] ?? 0) + 1;
  }
  writeFileSync('/tmp/claude-0/-home-user/433e9114-6cad-5458-9d42-176e33144860/scratchpad/hist.txt', `maps ${n}\n` + JSON.stringify(hist, null, 1));
}, 600000);
