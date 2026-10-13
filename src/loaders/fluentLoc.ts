import type { ResourceProvider } from './resourceProvider';

/** A single parsed Fluent message: its top-level value plus any `.attribute` lines
 *  (SS14 uses `.desc`/`.suffix` attributes on entity name messages). */
export interface FluentMessage {
  value: string | null;
  attributes: Record<string, string>;
}

/**
 * Parses the subset of Fluent (.ftl) syntax SS14 content actually uses: flat
 * `key = value` messages optionally followed by indented `.attribute = value` lines.
 * Comments (`#`) and blank lines are skipped. Multiline values, and Fluent
 * functions/selectors ({ $var }, { CAPITALIZE($var) }, etc.) are not resolved — such
 * messages simply keep their raw text, which is harmless here since entity/tile display
 * names never rely on those features in practice. Plain message/attribute references
 * ({ ent-Foo }, { ent-Foo.desc }) ARE resolved, separately, by resolveMessageReferences —
 * SS14 content uses these constantly so a child entity's name/desc can point back at its
 * parent's (e.g. `ent-BusScheduleRoute1 = { ent-BusSchedule }`).
 */
export function parseFtl(content: string): Map<string, FluentMessage> {
  const result = new Map<string, FluentMessage>();
  const lines = content.split(/\r\n|\r|\n/);
  let current: FluentMessage | null = null;

  for (const rawLine of lines) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue;

    const attrMatch = rawLine.match(/^\s+\.([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (attrMatch && current) {
      current.attributes[attrMatch[1]] = attrMatch[2].trim();
      continue;
    }

    const messageMatch = rawLine.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (messageMatch) {
      current = { value: messageMatch[2].trim() || null, attributes: {} };
      result.set(messageMatch[1], current);
      continue;
    }

    // Unrecognized line (e.g. a multiline continuation) — not part of what we parse.
    current = null;
  }

  return result;
}

/** Merges multiple parsed .ftl files into one flat key -> message index. Later files
 *  override earlier ones on key collision, matching how locale bundles normally merge.
 *  Simple message/attribute references inside values are resolved afterward (see
 *  resolveMessageReferences) — they routinely span files (a child entity's message can
 *  reference a parent defined in a different .ftl), so resolution only makes sense once
 *  every file has been merged into one index. */
export function buildLocIndex(files: { path: string; content: string }[]): Map<string, FluentMessage> {
  const index = new Map<string, FluentMessage>();
  for (const file of files) {
    const parsed = parseFtl(file.content);
    for (const [key, message] of parsed) {
      index.set(key, message);
    }
  }
  resolveMessageReferences(index);
  return index;
}

const REFERENCE_RE = /^\{\s*([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?\s*\}$/;

/**
 * Resolves plain whole-value message/attribute references — `{ ent-Foo }` (the target
 * message's own .value) and `{ ent-Foo.attr }` (one of its attributes) — in place, across
 * every message's .value and .attributes. Only a reference that is the ENTIRE field value
 * is resolved (matching how SS14 content actually uses this: a child copying its parent's
 * whole name/desc/suffix verbatim), not references embedded inside a longer string — those
 * would need general Fluent interpolation, which entity/tile names don't otherwise need.
 * Cyclic or dangling references are left as their raw `{ ... }` text rather than throwing,
 * since a malformed/unusual .ftl shouldn't take down the whole registry.
 */
export function resolveMessageReferences(index: Map<string, FluentMessage>): void {
  function resolve(raw: string, visiting: Set<string>): string {
    const match = raw.match(REFERENCE_RE);
    if (!match) return raw;
    const [, targetKey, targetAttr] = match;
    const visitKey = `${targetKey}.${targetAttr ?? ''}`;
    if (visiting.has(visitKey)) return raw; // cycle guard
    const target = index.get(targetKey);
    if (!target) return raw;

    const nextVisiting = new Set(visiting).add(visitKey);
    if (targetAttr) {
      const attrValue = target.attributes[targetAttr];
      return attrValue !== undefined ? resolve(attrValue, nextVisiting) : raw;
    }
    return target.value !== null ? resolve(target.value, nextVisiting) : raw;
  }

  for (const message of index.values()) {
    if (message.value !== null) {
      message.value = resolve(message.value, new Set());
    }
    for (const attrName of Object.keys(message.attributes)) {
      message.attributes[attrName] = resolve(message.attributes[attrName], new Set());
    }
  }
}

/**
 * Discovers and loads every ru-RU Fluent file from the resource provider's fork,
 * merging them into a single loc index. Missing/unreadable files are skipped rather
 * than failing the whole load — a fork without Russian localization simply yields an
 * empty index, and callers fall back to literal YAML names.
 */
export async function discoverLocale(provider: ResourceProvider): Promise<Map<string, FluentMessage>> {
  let files: string[] = [];
  try {
    files = await provider.listFiles('Locale/ru-RU', '.ftl');
  } catch {
    return new Map();
  }
  if (files.length === 0) return new Map();

  const loaded: { path: string; content: string }[] = [];
  const BATCH_SIZE = 20;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (path) => {
        try {
          const content = await provider.readText(path);
          return { path, content };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) loaded.push(r);
    }
  }

  return buildLocIndex(loaded);
}
