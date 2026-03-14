import type { FireflyDriver } from './driver';
import type { HydrationConfig } from './types';
import type { DrizzleDatabaseLike } from './drizzle/types';
import { isDrizzleHydrationQuery } from './drizzle/detect';

/**
 * Hydrates Redux state from database.
 * Supports both raw SQL queries (via FireflyDriver) and drizzle queries
 * (self-contained, just awaited directly).
 */
export async function hydrateFromDatabase(
  db: FireflyDriver | DrizzleDatabaseLike,
  config: HydrationConfig
): Promise<Record<string, any>> {
  const entries = Object.entries(config);

  const results = await Promise.all(
    entries.map(async ([sliceName, queryConfig]) => {
      try {
        if (isDrizzleHydrationQuery(queryConfig)) {
          // Drizzle hydration: query is self-contained, just await it
          const rows = await queryConfig.query;
          return [sliceName, queryConfig.transform ? queryConfig.transform(rows) : rows] as const;
        }

        // Plain SQL hydration
        const { query, params = [], transform } = queryConfig;
        const rows = await (db as FireflyDriver).getAllAsync(query, params);
        return [sliceName, transform ? transform(rows) : rows] as const;
      } catch (error) {
        console.error(`[Firefly] Failed to hydrate slice "${sliceName}":`, error);
        return [sliceName, undefined] as const;
      }
    })
  );

  return Object.fromEntries(results);
}
