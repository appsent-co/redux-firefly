import type { Reducer } from 'redux';
import type { ApplyRowsConfig, HydrationQuery } from './types';
import type { DrizzleHydrationQuery } from './drizzle/types';

/**
 * Reducer with attached hydration metadata
 */
export type HydratedReducer<S = unknown> = Reducer<S> & {
  _fireflyHydration?: HydrationQuery | DrizzleHydrationQuery<any, any>;
  /** Row-level apply config attached via `applyRows`. */
  _fireflyApplyRows?: ApplyRowsConfig<S>;
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

/** True when a reducer carries a row-level apply config (via `applyRows`). */
export function isApplyRowsReducer(
  reducer: Reducer,
): reducer is HydratedReducer & { _fireflyApplyRows: ApplyRowsConfig } {
  return '_fireflyApplyRows' in reducer;
}

export function withHydration<S>(
  reducer: Reducer<S>,
  config: HydrationQuery | DrizzleHydrationQuery<any, any>
): HydratedReducer<S> {
  const hydratedReducer = reducer as HydratedReducer<S>;
  hydratedReducer._fireflyHydration = config;
  return hydratedReducer;
}

/**
 * Attaches a row-level apply config to a reducer so `enhanceReducer` can apply
 * FireflyDB merged rows into the slice **without any SQL read**. The mirror of
 * {@link withHydration}; the two compose (a slice usually has both — hydration
 * for the initial load + applyRows for live row updates).
 *
 * @example
 * export const todosReducer = applyRows(todosSlice.reducer, {
 *   table: 'todos',
 *   apply: listApply<Todo>({
 *     toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
 *     getId: (t) => t.id,
 *     listKey: 'items',
 *   }),
 * });
 */
export function applyRows<S>(
  reducer: Reducer<S>,
  config: ApplyRowsConfig<S>,
): HydratedReducer<S> {
  const hydratedReducer = reducer as HydratedReducer<S>;
  hydratedReducer._fireflyApplyRows = config;
  return hydratedReducer;
}
