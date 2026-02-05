import type { SQLiteDatabase } from 'expo-sqlite';
import type { HydrationConfig } from './types';

/**
 * Hydrates Redux state from SQLite database
 * @param db - SQLite database instance
 * @param config - Hydration configuration mapping slice names to queries
 * @returns Promise resolving to initial state object
 *
 * @example
 * const preloadedState = await hydrateFromDatabase(db, {
 *   todos: {
 *     query: 'SELECT * FROM todos',
 *     transform: (rows) => ({
 *       items: rows.map(r => ({
 *         id: r.id,
 *         text: r.text,
 *         completed: Boolean(r.completed)
 *       }))
 *     })
 *   },
 *   user: {
 *     query: 'SELECT * FROM users WHERE id = ?',
 *     params: [currentUserId],
 *     transform: (rows) => rows[0] || null
 *   }
 * })
 *
 * const store = configureStore({
 *   reducer: rootReducer,
 *   preloadedState: {
 *     ...preloadedState,
 *     _firefly: { hydrated: true }  // Mark as hydrated for FireflyGate
 *   }
 * })
 */
export async function hydrateFromDatabase(
  db: SQLiteDatabase,
  config: HydrationConfig
): Promise<Record<string, any>> {
  const state: Record<string, any> = {};

  for (const [sliceName, queryConfig] of Object.entries(config)) {
    try {
      const { query, params = [], transform } = queryConfig;

      // Execute the query
      const rows = await db.getAllAsync(query, params);

      // Apply transform if provided, otherwise use raw rows
      state[sliceName] = transform ? transform(rows) : rows;
    } catch (error) {
      console.error(`[Firefly] Failed to hydrate slice "${sliceName}":`, error);

      // Continue with other slices even if one fails
      // Set undefined to indicate hydration failure for this slice
      state[sliceName] = undefined;
    }
  }

  return state;
}
