import { discoverPrototypes } from './prototypeDiscovery';
import { resolveTiles, resolveEntitiesWithAbstractIds, resolveDecals } from './prototypeResolver';
import { PrototypeRegistry } from './prototypeRegistry';
import type { ResourceProvider } from './resourceProvider';
import { HttpResourceProvider } from './resourceProvider';
import { discoverLocale } from './fluentLoc';
import type { FluentMessage } from './fluentLoc';

/**
 * Initialize the prototype registry by discovering and parsing all game prototypes.
 * Call once on app startup.
 *
 * Accepts either a ResourceProvider instance or a base URL string (backward compat).
 */
export async function initRegistry(
  providerOrBaseUrl: ResourceProvider | string = '',
  onProgress?: (message: string) => void,
): Promise<PrototypeRegistry> {
  const provider: ResourceProvider = typeof providerOrBaseUrl === 'string'
    ? new HttpResourceProvider(providerOrBaseUrl)
    : providerOrBaseUrl;

  onProgress?.('Discovering prototypes...');
  const [{ tiles: rawTiles, entities: rawEntities, decals: rawDecals }, locIndex] = await Promise.all([
    discoverPrototypes(
      provider,
      (loaded, total) => onProgress?.(`Loading prototypes: ${loaded}/${total} files`),
    ),
    loadLocaleSafely(provider, onProgress),
  ]);

  onProgress?.(`Resolving ${rawTiles.length} tiles, ${rawEntities.length} entities, ${rawDecals.length} decals...`);
  const tiles = resolveTiles(rawTiles, locIndex);
  const { entities, abstractIds } = resolveEntitiesWithAbstractIds(rawEntities, locIndex);
  const decals = resolveDecals(rawDecals);

  onProgress?.(`Registry ready: ${tiles.size} tiles, ${entities.size} entities, ${decals.size} decals`);
  return new PrototypeRegistry(tiles, entities, decals, abstractIds);
}

/** Loads the ru-RU Fluent localization index, tolerating a fork that has none at all —
 *  `discoverLocale` already swallows its own listing/read errors, but this wraps it in a
 *  belt-and-suspenders try/catch too, since a missing translation layer must never block
 *  registry initialization (entities/tiles simply keep their literal YAML names). */
async function loadLocaleSafely(
  provider: ResourceProvider,
  onProgress?: (message: string) => void,
): Promise<Map<string, FluentMessage>> {
  onProgress?.('Loading localization...');
  try {
    return await discoverLocale(provider);
  } catch {
    return new Map();
  }
}
