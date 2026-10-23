import { describe, it, expect } from 'vitest';
import { remapEntityRefs } from '../entityRefs';
import { ENTITY_REF_FIELDS } from '../entityRefFields.generated';

const to = (m: Record<number, number>) => (uid: number) => m[uid];

describe('remapEntityRefs', () => {
  it('translates list, dictionary-key and single references', () => {
    const out = remapEntityRefs([
      { type: 'DeviceList', devices: [1, 2, 3] },
      { type: 'DeviceLinkSource', linkedPorts: { 1: [['A', 'B']], 5: [['C', 'D']] } },
      { type: 'Docking', dockedWith: 2, dockJointId: 'j' },
    ], to({ 1: 101, 2: 102 }));
    expect(out[0]).toEqual({ type: 'DeviceList', devices: [101, 102] });
    expect(out[1]).toEqual({ type: 'DeviceLinkSource', linkedPorts: { 101: [['A', 'B']] } });
    expect(out[2]).toEqual({ type: 'Docking', dockedWith: 102, dockJointId: 'j' });
  });

  it('drops references whose target is not part of the move', () => {
    const [docking] = remapEntityRefs([{ type: 'Docking', dockedWith: 9 }], to({}));
    expect(docking).toEqual({ type: 'Docking' });
  });

  it('keeps `invalid` markers and non-reference data', () => {
    const [list] = remapEntityRefs([{ type: 'DeviceList', devices: [1, 'invalid'], note: 'x' }], to({ 1: 7 }));
    expect(list).toEqual({ type: 'DeviceList', devices: [7, 'invalid'], note: 'x' });
  });

  it('remaps container contents and slots', () => {
    const [cc] = remapEntityRefs([{
      type: 'ContainerContainer',
      containers: {
        entity_storage: { _ss14Tag: '!type:Container', showEnts: false, occludes: true, ents: [4, 5] },
        item: { _ss14Tag: '!type:ContainerSlot', ent: 6 },
        gone: { _ss14Tag: '!type:ContainerSlot', ent: 8 },
      },
    }], to({ 4: 40, 6: 60 }));
    const c = (cc as { containers: Record<string, Record<string, unknown>> }).containers;
    expect(c.entity_storage).toMatchObject({ _ss14Tag: '!type:Container', ents: [40] });
    expect(c.item.ent).toBe(60);
    expect('ent' in c.gone).toBe(false);
  });

  it('leaves components it knows nothing about, and Transform, untouched', () => {
    const input = [{ type: 'Transform', parent: 3 }, { type: 'Whatever', target: 3 }];
    const out = remapEntityRefs(input, to({}));
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(input[1]);
  });

  it('has the reference fields of the components that matter on a map', () => {
    expect(ENTITY_REF_FIELDS.DeviceList.devices).toBe('list');
    expect(ENTITY_REF_FIELDS.DeviceLinkSource.linkedPorts).toBe('dictKey');
    expect(ENTITY_REF_FIELDS.Docking.dockedWith).toBe('uid');
  });
});
