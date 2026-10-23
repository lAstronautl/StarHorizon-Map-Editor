import { describe, it, expect } from 'vitest';
import { exportMap } from '../mapExporter';
import { importMap, type ImportedMap } from '../../import/mapImporter';
import { validateEngineYaml } from '../../test-utils/engineValidator';

/** Round-trip one entity's components through the component re-serializer (no raw lines). */
function roundtrip(components: Record<string, unknown>[]): Record<string, unknown>[] {
  const map: ImportedMap = {
    meta: { format: 7 },
    tilemap: { 0: 'Space', 1: 'FloorSteel' },
    grid: { width: 16, height: 16, offsetX: 0, offsetY: 0, cells: Array(256).fill(null).map((_, i) => ({ tileId: i === 0 ? 'FloorSteel' : 'Space' })) },
    entities: [{ uid: 100, prototype: 'Thing', position: { x: 0.5, y: 0.5 }, rotation: 0, components: [{ type: 'Transform', pos: '0.5,0.5', parent: 2 }, ...components] }],
    gridUid: 2,
    mapUid: 1,
  };
  const exported = exportMap(map);
  expect(validateEngineYaml(exported).errors).toEqual([]);
  const entity = importMap(exported).entities.find(e => e.uid === 100)!;
  return entity.components.filter(c => c.type !== 'Transform') as Record<string, unknown>[];
}

describe('component value emitter', () => {
  it('keeps the body of an empty tagged mapping (stash: !type:ContainerSlot {})', () => {
    const c = { type: 'ContainerContainer', containers: { stash: { _ss14Tag: '!type:ContainerSlot' } } };
    expect(roundtrip([c])).toEqual([c]);
  });

  it('keeps the tag of a polymorphic sequence item', () => {
    const c = { type: 'Thing', effects: [{ _ss14Tag: '!type:DoStuff', amount: 3 }, { _ss14Tag: '!type:Other' }] };
    expect(roundtrip([c])).toEqual([c]);
  });

  it('writes multi-line strings that are the first key of a sequence item', () => {
    const c = { type: 'GroupExamine', group: [{ entries: [{ message: 'line one\n- [bold]line two[/bold].', priority: 0 }] }] };
    expect(roundtrip([c])).toEqual([c]);
  });

  it('preserves every trailing newline of a block string', () => {
    for (const content of ['a\nb', 'a\nb\n', 'a\nb\n\n\n\n', '\n  indented first\n\nlast']) {
      const c = { type: 'Paper', content };
      expect(roundtrip([c])).toEqual([c]);
    }
  });

  it('preserves carriage returns and quotes keys that contain ": "', () => {
    const c = { type: 'NetworkConfigurator', devices: { 'UID: 31739': 801 }, content: 'a\r\nb\r\n' };
    expect(roundtrip([c])).toEqual([c]);
  });

  it('writes null items and values explicitly', () => {
    const c = { type: 'Appearance', icon: ['icon_magnifier', null], other: null };
    expect(roundtrip([c])).toEqual([c]);
  });
});
