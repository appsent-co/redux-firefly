import type { Reducer } from 'redux';
import type { HydrationQuery } from './types';
import type { DrizzleHydrationQuery } from './drizzle/types';

/**
 * Reducer with attached hydration metadata
 */
export type HydratedReducer<S = unknown> = Reducer<S> & {
  _fireflyHydration: HydrationQuery | DrizzleHydrationQuery;
};

/**
 * Attaches hydration configuration to a reducer so it can be
 * auto-discovered by `enhanceReducer` from `createFirefly`.
 *
 * @example
 * export const todosReducer = withHydration(todosSlice.reducer, {
 *   query: 'SELECT * FROM todos',
 *   transform: (rows) => ({
 *     items: rows.map(r => ({
 *       id: r.id,
 *       text: r.text,
 *       completed: Boolean(r.completed)
 *     }))
 *   })
 * });
 */
export function isHydratedReducer(reducer: Reducer): reducer is HydratedReducer {
  return '_fireflyHydration' in reducer;
}

export function withHydration<S>(
  reducer: Reducer<S>,
  config: HydrationQuery | DrizzleHydrationQuery
): HydratedReducer<S> {
  const hydratedReducer = reducer as HydratedReducer<S>;
  hydratedReducer._fireflyHydration = config;
  return hydratedReducer;
}
