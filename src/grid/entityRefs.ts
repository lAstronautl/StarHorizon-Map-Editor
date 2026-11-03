/**
 * Rewrite or drop the entity references inside component data.
 *
 * Entities refer to each other by uid (containers, device links, docking...). When entities move
 * to a different map, grid or prefab those uids stop meaning the same thing, so a reference must
 * either be translated to the entity's new uid or, if its target isn't coming along, removed:
 * a stale uid would silently point at whatever unrelated entity owns that number in the new file.
 *
 * Which fields hold uids comes from the game's components (see entityRefFields.generated.ts).
 * `Transform.parent` is left to the caller, which knows what the new parent is.
 */
import { ENTITY_REF_FIELDS, type EntityRefKind } from './entityRefFields.generated';

type Component = Record<string, unknown>;

/** Maps an old uid to its new one, or to `undefined` when the entity is not part of the move. */
export type UidResolver = (uid: number) => number | undefined;

const isUid = (v: unknown): v is number => typeof v === 'number';

function mapRefList(list: unknown[], resolve: UidResolver): unknown[] {
  const out: unknown[] = [];
  for (const item of list) {
    if (!isUid(item)) { out.push(item); continue; } // `invalid`/null markers are not references
    const mapped = resolve(item);
    if (mapped !== undefined) out.push(mapped);
  }
  return out;
}

function mapField(value: unknown, kind: EntityRefKind, resolve: UidResolver): { value: unknown; drop?: boolean } {
  switch (kind) {
    case 'uid': {
      if (!isUid(value)) return { value };
      const mapped = resolve(value);
      return mapped === undefined ? { value, drop: true } : { value: mapped };
    }
    case 'list':
      return { value: Array.isArray(value) ? mapRefList(value, resolve) : value };
    case 'dictKey':
    case 'dictValue': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { value };
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === '_ss14Tag') { out[k] = v; continue; }
        if (kind === 'dictKey') {
          const uid = Number(k);
          if (!Number.isInteger(uid) || String(uid) !== k) { out[k] = v; continue; }
          const mapped = resolve(uid);
          if (mapped !== undefined) out[String(mapped)] = v;
        } else if (isUid(v)) {
          const mapped = resolve(v);
          if (mapped !== undefined) out[k] = mapped;
        } else {
          out[k] = v;
        }
      }
      return { value: out };
    }
  }
}

/** `ContainerContainer`: `containers.<id>.ents` (a list) and, for slots, `containers.<id>.ent`. */
function remapContainers(comp: Component, resolve: UidResolver): Component {
  const containers = comp.containers;
  if (!containers || typeof containers !== 'object') return comp;
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(containers as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || id === '_ss14Tag') { out[id] = raw; continue; }
    const container = { ...(raw as Record<string, unknown>) };
    if (Array.isArray(container.ents)) container.ents = mapRefList(container.ents, resolve);
    if (isUid(container.ent)) {
      const mapped = resolve(container.ent);
      if (mapped === undefined) delete container.ent; else container.ent = mapped;
    }
    out[id] = container;
  }
  return { ...comp, containers: out };
}

/** Components with their entity references translated by `resolve`; unaffected components are returned as is. */
export function remapEntityRefs(components: Component[], resolve: UidResolver): Component[] {
  return components.map(comp => {
    const type = comp.type;
    if (typeof type !== 'string') return comp;
    if (type === 'ContainerContainer') return remapContainers(comp, resolve);
    const fields = ENTITY_REF_FIELDS[type];
    if (!fields) return comp;

    let result: Component | null = null;
    for (const [field, kind] of Object.entries(fields)) {
      if (!(field in comp)) continue;
      const mapped = mapField(comp[field], kind, resolve);
      result ??= { ...comp };
      if (mapped.drop) delete result[field]; else result[field] = mapped.value;
    }
    return result ?? comp;
  });
}
