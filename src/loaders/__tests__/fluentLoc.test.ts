import { describe, it, expect, vi } from 'vitest';
import { parseFtl, buildLocIndex, discoverLocale, resolveMessageReferences } from '../fluentLoc';
import type { FluentMessage } from '../fluentLoc';
import type { ResourceProvider } from '../resourceProvider';

describe('parseFtl', () => {
  it('parses a flat key = value message', () => {
    const result = parseFtl('tiles-steel-floor = Стальной пол');
    expect(result.get('tiles-steel-floor')).toEqual({ value: 'Стальной пол', attributes: {} });
  });

  it('parses a message with .desc and .suffix attributes', () => {
    const ftl = [
      'ent-VendingMachine = торговый автомат',
      '    .desc = Просто добавь капитализма!',
      '    .suffix = Vending',
    ].join('\n');
    const result = parseFtl(ftl);
    expect(result.get('ent-VendingMachine')).toEqual({
      value: 'торговый автомат',
      attributes: { desc: 'Просто добавь капитализма!', suffix: 'Vending' },
    });
  });

  it('ignores comments and blank lines', () => {
    const ftl = [
      '# This is a comment',
      '',
      'ent-Foo = Фу',
      '',
      '# another comment',
      'ent-Bar = Бар',
    ].join('\n');
    const result = parseFtl(ftl);
    expect(result.size).toBe(2);
    expect(result.get('ent-Foo')?.value).toBe('Фу');
    expect(result.get('ent-Bar')?.value).toBe('Бар');
  });

  it('parses multiple independent messages in one file', () => {
    const ftl = [
      'ent-FloorWaterEntity = вода',
      '    .desc = Настоящий утолитель жажды.',
      'ent-VendingMachine = торговый автомат',
      '    .desc = Просто добавь капитализма!',
    ].join('\n');
    const result = parseFtl(ftl);
    expect(result.size).toBe(2);
    expect(result.get('ent-FloorWaterEntity')).toEqual({
      value: 'вода',
      attributes: { desc: 'Настоящий утолитель жажды.' },
    });
    expect(result.get('ent-VendingMachine')?.value).toBe('торговый автомат');
  });

  it('handles CRLF line endings', () => {
    const result = parseFtl('ent-Foo = Фу\r\n    .desc = Описание\r\n');
    expect(result.get('ent-Foo')).toEqual({ value: 'Фу', attributes: { desc: 'Описание' } });
  });
});

describe('resolveMessageReferences', () => {
  it('resolves a whole-value reference to the target message\'s own value', () => {
    const index = new Map<string, FluentMessage>([
      ['ent-BusSchedule', { value: 'расписание автобуса', attributes: { suffix: 'Авто' } }],
      ['ent-BusScheduleRoute1', { value: '{ ent-BusSchedule }', attributes: { suffix: 'Маршрут 1' } }],
    ]);
    resolveMessageReferences(index);
    expect(index.get('ent-BusScheduleRoute1')?.value).toBe('расписание автобуса');
    expect(index.get('ent-BusScheduleRoute1')?.attributes.suffix).toBe('Маршрут 1'); // untouched, not a reference
  });

  it('resolves a whole-value reference to a specific attribute (ent-Foo.desc)', () => {
    const index = new Map<string, FluentMessage>([
      ['ent-BusSchedule', { value: 'расписание автобуса', attributes: { desc: 'Не пропустите!' } }],
      ['ent-BusScheduleRoute1', { value: '{ ent-BusSchedule }', attributes: { desc: '{ ent-BusSchedule.desc }' } }],
    ]);
    resolveMessageReferences(index);
    expect(index.get('ent-BusScheduleRoute1')?.attributes.desc).toBe('Не пропустите!');
  });

  it('reproduces the real bus_schedule.ftl case end to end via buildLocIndex', () => {
    const ftl = [
      'ent-BusSchedule = расписание автобуса',
      '    .desc = Не пропустите!',
      '    .suffix = Авто',
      'ent-BusScheduleRoute1 = { ent-BusSchedule }',
      '    .suffix = Маршрут 1, Точки появления',
      '    .desc = { ent-BusSchedule.desc }',
    ].join('\n');
    const index = buildLocIndex([{ path: 'bus_schedule.ftl', content: ftl }]);
    const route1 = index.get('ent-BusScheduleRoute1')!;
    expect(route1.value).toBe('расписание автобуса');
    expect(route1.attributes.desc).toBe('Не пропустите!');
    expect(route1.attributes.suffix).toBe('Маршрут 1, Точки появления');
  });

  it('leaves a dangling reference (target not found) as raw text instead of throwing', () => {
    const index = new Map<string, FluentMessage>([
      ['ent-Orphan', { value: '{ ent-DoesNotExist }', attributes: {} }],
    ]);
    resolveMessageReferences(index);
    expect(index.get('ent-Orphan')?.value).toBe('{ ent-DoesNotExist }');
  });

  it('leaves a cyclic reference as raw text instead of infinite-looping', () => {
    const index = new Map<string, FluentMessage>([
      ['ent-A', { value: '{ ent-B }', attributes: {} }],
      ['ent-B', { value: '{ ent-A }', attributes: {} }],
    ]);
    resolveMessageReferences(index);
    // Whichever one it lands on, it must terminate with the raw reference text, not throw/hang.
    expect(index.get('ent-A')?.value).toMatch(/^\{ ent-[AB] \}$/);
  });

  it('does not touch a value that merely contains a reference alongside other text', () => {
    const index = new Map<string, FluentMessage>([
      ['ent-Base', { value: 'база', attributes: {} }],
      ['ent-Combined', { value: 'префикс { ent-Base } суффикс', attributes: {} }],
    ]);
    resolveMessageReferences(index);
    expect(index.get('ent-Combined')?.value).toBe('префикс { ent-Base } суффикс');
  });
});

describe('buildLocIndex', () => {
  it('merges keys from multiple files', () => {
    const index = buildLocIndex([
      { path: 'a.ftl', content: 'ent-Foo = Фу' },
      { path: 'b.ftl', content: 'ent-Bar = Бар' },
    ]);
    expect(index.size).toBe(2);
    expect(index.get('ent-Foo')?.value).toBe('Фу');
    expect(index.get('ent-Bar')?.value).toBe('Бар');
  });

  it('lets a later file override an earlier one on key collision', () => {
    const index = buildLocIndex([
      { path: 'a.ftl', content: 'ent-Foo = Старое' },
      { path: 'b.ftl', content: 'ent-Foo = Новое' },
    ]);
    expect(index.get('ent-Foo')?.value).toBe('Новое');
  });
});

function makeProvider(files: Record<string, string>): ResourceProvider {
  return {
    async listFiles() { return Object.keys(files); },
    async readText(path: string) {
      if (!(path in files)) throw new Error('not found');
      return files[path];
    },
    getImageUrl: () => '',
    forkName: 'test',
    isLocal: false,
    dispose() {},
  };
}

describe('discoverLocale', () => {
  it('loads and merges all discovered .ftl files', async () => {
    const provider = makeProvider({
      '/Locale/ru-RU/tiles/tiles.ftl': 'tiles-steel-floor = Стальной пол',
      '/Locale/ru-RU/prototypes/entities/vending.ftl': 'ent-VendingMachine = торговый автомат\n    .desc = Просто добавь капитализма!',
    });
    const index = await discoverLocale(provider);
    expect(index.get('tiles-steel-floor')?.value).toBe('Стальной пол');
    expect(index.get('ent-VendingMachine')?.value).toBe('торговый автомат');
  });

  it('returns an empty index when the provider has no locale files', async () => {
    const provider = makeProvider({});
    const index = await discoverLocale(provider);
    expect(index.size).toBe(0);
  });

  it('returns an empty index when listFiles throws (no Locale directory at all)', async () => {
    const provider: ResourceProvider = {
      async listFiles() { throw new Error('no such directory'); },
      async readText() { throw new Error('unused'); },
      getImageUrl: () => '',
      forkName: 'test',
      isLocal: false,
      dispose() {},
    };
    const index = await discoverLocale(provider);
    expect(index.size).toBe(0);
  });

  it('skips individual files that fail to read without failing the whole load', async () => {
    const provider: ResourceProvider = {
      async listFiles() { return ['/Locale/ru-RU/a.ftl', '/Locale/ru-RU/b.ftl']; },
      async readText(path: string) {
        if (path.endsWith('a.ftl')) throw new Error('broken file');
        return 'ent-Bar = Бар';
      },
      getImageUrl: () => '',
      forkName: 'test',
      isLocal: false,
      dispose() {},
    };
    const index = await discoverLocale(provider);
    expect(index.size).toBe(1);
    expect(index.get('ent-Bar')?.value).toBe('Бар');
  });
});
