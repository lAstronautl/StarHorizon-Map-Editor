import { describe, it, expect, vi } from 'vitest';
import { parseFtl, buildLocIndex, discoverLocale } from '../fluentLoc';
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
