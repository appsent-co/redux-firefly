import type { Dispatch, Middleware, Reducer, StoreEnhancer, StoreEnhancerStoreCreator } from 'redux';
import { combineReducers } from 'redux';
import type {
  ApplyRowsChanges,
  ApplyRowsConfig,
  FireflyConfig,
  HydrationConfig,
  FireflyStore,
  MergedRow,
} from './types';
import { isApplyRowsReducer, isHydratedReducer } from './withHydration';
import { createFireflyMiddleware } from './middleware';
import { hydrateFromDatabase } from './hydration';

const HYDRATE_ACTION = '@@firefly/HYDRATE';
const APPLY_ROWS_ACTION = '@@firefly/APPLY_ROWS';

/**
 * Creates the Firefly middleware, reducer enhancer, and store enhancer.
 *
 * - `middleware` executes the DB effect of any dispatched Firefly action, then
 *   dispatches its commit/rollback action.
 * - `enhanceReducer` discovers each slice's `withHydration` (initial load) and
 *   `applyRows` (live merged-row updates) configs.
 * - `enhanceStore` runs the initial hydration and, when `config.changes` is set
 *   (a FireflyDB `FireflyClient`), subscribes to its change events: each event's
 *   merged rows are applied straight into the matching `applyRows` slices — no
 *   SQL read, no re-hydration.
 *
 * @example
 * const { middleware, enhanceReducer, enhanceStore } = createFirefly({
 *   database: db,
 *   changes: client,
 * });
 *
 * const store = configureStore({
 *   reducer: enhanceReducer({
 *     todos: applyRows(
 *       withHydration(todosSlice.reducer, { query: 'SELECT * FROM todos', ... }),
 *       { table: 'todos', apply: listApply({ ... }) },
 *     ),
 *   }),
 *   enhancers: (getDefaultEnhancers) =>
 *     getDefaultEnhancers().concat(enhanceStore),
 *   middleware: (getDefaultMiddleware) =>
 *     getDefaultMiddleware().concat(middleware),
 * });
 *
 * await store.hydrated;
 */
export function createFirefly(config: FireflyConfig): {
  middleware: Middleware;
  enhanceReducer: <S extends Record<string, any>>(reducerMap: { [K in keyof S]: Reducer<S[K]> }) => Reducer<S>;
  enhanceStore: StoreEnhancer<FireflyStore>;
} {
  const { database, debug } = config;

  // Shared state between enhanceReducer and enhanceStore via closure
  const hydrationConfig: HydrationConfig = {};
  // slice -> row-level apply config (opted in via `applyRows`).
  const applyRowsConfig: Record<string, ApplyRowsConfig> = {};
  // lowercased table -> slice names that apply that table's rows.
  const applyRowsTableIndex = new Map<string, string[]>();

  /**
   * Scans a reducer map for hydration configs attached via `withHydration` and
   * row-level apply configs attached via `applyRows`, combines the reducers, and
   * wraps the result to handle the hydration + apply-rows actions.
   */
  function enhanceReducer<S extends Record<string, any>>(
    reducerMap: { [K in keyof S]: Reducer<S[K]> }
  ): Reducer<S> {
    for (const [sliceName, reducer] of Object.entries(reducerMap)) {
      if (isHydratedReducer(reducer) && reducer._fireflyHydration) {
        hydrationConfig[sliceName] = reducer._fireflyHydration;
      }
      if (isApplyRowsReducer(reducer)) {
        const cfg = reducer._fireflyApplyRows;
        applyRowsConfig[sliceName] = cfg;
        const table = cfg.table.toLowerCase();
        const slices = applyRowsTableIndex.get(table);
        if (slices) slices.push(sliceName);
        else applyRowsTableIndex.set(table, [sliceName]);
      }
    }

    if (debug) {
      console.log(`[Firefly] Hydration configs: ${Object.keys(hydrationConfig).join(', ')}`);
      console.log(`[Firefly] Apply-rows configs: ${Object.keys(applyRowsConfig).join(', ')}`);
    }

    const combinedReducer = combineReducers(reducerMap);

    return ((state: S | undefined, action: any) => {
      // Row-level apply: run the combined reducer first, then replace each
      // targeted slice with cfg.apply(...).
      if (action.type === APPLY_ROWS_ACTION) {
        const next = combinedReducer(state, action) as Record<string, any>;
        const payload = action.payload as Record<string, ApplyRowsChanges>;
        let out: Record<string, any> | null = null;
        for (const sliceName of Object.keys(payload)) {
          const cfg = applyRowsConfig[sliceName];
          if (!cfg) continue;
          const applied = cfg.apply(next[sliceName], payload[sliceName]!);
          if (applied !== next[sliceName]) {
            if (!out) out = { ...next };
            out[sliceName] = applied;
          }
        }
        return (out ?? next) as S;
      }
      if (action.type === HYDRATE_ACTION) {
        // Merge hydrated state into current state
        const newState = combinedReducer(state, action);
        return { ...newState, ...action.payload };
      }
      return combinedReducer(state, action);
    });
  }

  /**
   * Store enhancer that runs hydration after store creation, adds hydration
   * status methods to the store, and wires the FireflyDB change subscription.
   *
   * Typed as a proper StoreEnhancer so it integrates with RTK's configureStore.
   * The internal dispatch uses Dispatch (defaulting to UnknownAction) because
   * Redux's generic action type parameter A can't be satisfied with a concrete
   * internal action — this is a known TypeScript limitation that Redux's own
   * applyMiddleware also works around.
   */
  function enhanceStore<NextExt extends {}, NextStateExt extends {}>(
    createStore: StoreEnhancerStoreCreator<NextExt, NextStateExt>
  ): StoreEnhancerStoreCreator<NextExt & FireflyStore, NextStateExt> {
    return (reducer, preloadedState) => {
      const store = createStore(reducer, preloadedState);

      // Capture dispatch typed for internal framework actions.
      // Inside a generic enhancer, store.dispatch is Dispatch<A> where A is
      // an unconstrained type variable. Redux stores accept UnknownAction at
      // runtime, but TypeScript can't verify this in a generic context.
      const dispatch: Dispatch = store.dispatch;

      let _hydrated = false;
      let _disposed = false;
      const _listeners = new Set<(hydrated: boolean) => void>();

      // Monotonic generation so an older (slower) hydration can't clobber a
      // newer one.
      let _gen = 0;

      const runHydration = async (): Promise<void> => {
        const gen = ++_gen;
        const payload = await hydrateFromDatabase(database, hydrationConfig);
        if (gen !== _gen) return; // superseded by a newer hydration
        // Drop slices that hydrated to `undefined` (query/transform failure):
        // a failed hydration must be a no-op, never wipe a slice's state. The
        // root reducer merges `{ ...state, ...payload }`, so we only include
        // slices that produced a value.
        const next: Record<string, any> = {};
        for (const key of Object.keys(payload)) {
          if (payload[key] !== undefined) next[key] = payload[key];
        }
        if (Object.keys(next).length > 0) {
          dispatch({ type: HYDRATE_ACTION, payload: next });
        }
      };

      /**
       * Bucket merged rows by table -> applyRows slice (upserts vs deletes), and
       * dispatch ONE synchronous `@@firefly/APPLY_ROWS` for the targeted slices.
       * Rows for tables without an applyRows slice are ignored.
       */
      const applyMergedRows = (rows: readonly MergedRow[]): void => {
        if (_disposed) return;
        // sliceName -> { upserts, deletes }
        const bySlice = new Map<string, { upserts: MergedRow[]; deletes: MergedRow[] }>();
        for (const row of rows) {
          const slices = applyRowsTableIndex.get(row.table.toLowerCase());
          if (!slices) continue;
          for (const sliceName of slices) {
            let bucket = bySlice.get(sliceName);
            if (!bucket) {
              bucket = { upserts: [], deletes: [] };
              bySlice.set(sliceName, bucket);
            }
            if (row.deleted) bucket.deletes.push(row);
            else bucket.upserts.push(row);
          }
        }
        if (bySlice.size === 0) return;
        const payload: Record<string, ApplyRowsChanges> = {};
        for (const [sliceName, changes] of bySlice) payload[sliceName] = changes;
        if (debug) console.log(`[Firefly] apply rows: ${[...bySlice.keys()].join(', ')}`);
        dispatch({ type: APPLY_ROWS_ACTION, payload });
      };

      // --- change source: subscribe up front, buffer until hydrated ---------
      // Subscribing BEFORE the initial hydrate (rather than after) closes the
      // window where a change committed during hydration would be missed — rows
      // that arrive early are buffered and applied post-hydrate (idempotent:
      // upserts replace by id, deletes of absent ids are no-ops).
      let _pendingRows: MergedRow[] = [];
      let _unsubscribe: (() => void) | null = null;

      if (config.changes) {
        const sub = config.changes.subscribeToChanges((event) => {
          if (!event.merged?.length) return;
          if (_hydrated) applyMergedRows(event.merged);
          else _pendingRows.push(...event.merged);
        });
        _unsubscribe = () => sub.remove();
      }

      const dispose = (): void => {
        _disposed = true;
        _pendingRows = [];
        if (_unsubscribe) {
          _unsubscribe();
          _unsubscribe = null;
        }
      };

      const fireflyStore = Object.assign(store, {
        isHydrated: () => _hydrated,
        onHydrationChange: (callback: (hydrated: boolean) => void) => {
          _listeners.add(callback);
          return () => { _listeners.delete(callback); };
        },
        hydrated: Promise.resolve<void>(undefined), // replaced below
        refreshAll: runHydration,
        dispose,
      });

      const finishHydration = (): void => {
        _hydrated = true;
        _listeners.forEach((cb) => cb(true));
        _listeners.clear();
        // Apply anything buffered while hydrating.
        const pending = _pendingRows;
        _pendingRows = [];
        if (pending.length > 0) applyMergedRows(pending);
      };

      fireflyStore.hydrated = runHydration()
        .then(finishHydration)
        .catch((error) => {
          console.error('[Firefly] Hydration failed:', error);
          finishHydration(); // mark hydrated so the app can render
        });

      return fireflyStore;
    };
  }

  const middleware = createFireflyMiddleware(config);

  return { middleware, enhanceReducer, enhanceStore };
}
