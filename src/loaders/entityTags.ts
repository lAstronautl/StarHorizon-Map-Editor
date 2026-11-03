import type { ImportedEntity } from '../import/mapImporter';
import type { IPrototypeRegistry } from './registryTypes';

/** The `Tag` component's tags of an entity: its own, else its prototype's. */
export function getEntityTags(entity: ImportedEntity, registry: IPrototypeRegistry | null): string[] {
  // Check instance components first
  for (const comp of entity.components) {
    const c = comp as Record<string, unknown>;
    if (c.type === 'Tag' && Array.isArray(c.tags)) return c.tags as string[];
  }
  // Fall back to prototype definition
  const resolved = registry?.getEntity(entity.prototype);
  if (resolved) {
    for (const c of resolved.components) {
      if (c.type === 'Tag' && Array.isArray((c as Record<string, unknown>).tags)) {
        return (c as Record<string, unknown>).tags as string[];
      }
    }
  }
  return [];
}

/**
 * True for entities that enclose a room: walls (incl. diagonal), windows and doors. Tiles under
 * them are not "floor" for the magic wand.
 */
export function isRoomBoundary(entity: ImportedEntity, registry: IPrototypeRegistry | null): boolean {
  const tags = getEntityTags(entity, registry);
  if (tags.includes('Wall') || tags.includes('Window')) return true;
  const resolved = registry?.getEntity(entity.prototype);
  return !!resolved?.components.some(c => c.type === 'Door' || c.type === 'Occluder');
}
