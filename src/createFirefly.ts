import type { Dispatch, Middleware, Reducer, StoreEnhancer, StoreEnhancerStoreCreator } from 'redux';
import { combineReducers } from 'redux';
import type { FireflyConfig, HydrationConfig, FireflyStore } from './types';
import { isHydratedReducer } from './withHydration';
import { createFireflyMiddleware } from './middleware';
import { hydrateFromDatabase } from './hydration';

const HYDRATE_ACTION = '@@firefly/HYDRATE';

/**
 * Creates the Firefly middleware, reducer enhancer, and store enhancer.
 *
 * @example
 * const { middleware, enhanceReducer, enhanceStore } = createFirefly({
 *   database: db,
 * });
 *
 * const store = configureStore({
 *   reducer: enhanceReducer({
 *     todos: withHydration(todosSlice.reducer, {
 *       query: 'SELECT * FROM todos',
 *       transform: (rows) => ({ items: rows.map(...) })
 *     }),
 *     user: userReducer,
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
  enhanceStore: StoreEnhancer;
} {
  const { database, debug } = config;

  // Shared state between enhanceReducer and enhanceStore via closure
  let hydrationConfig: HydrationConfig = {};

  /**
   * Scans a reducer map for hydration configs attached via `withHydration`,
   * combines the reducers, and wraps the result to handle the hydration action.
   */
  function enhanceReducer<S extends Record<string, any>>(
    reducerMap: { [K in keyof S]: Reducer<S[K]> }
  ): Reducer<S> {
    // Extract hydration configs from reducers
    for (const [sliceName, reducer] of Object.entries(reducerMap)) {
      if (isHydratedReducer(reducer)) {
        hydrationConfig[sliceName] = reducer._fireflyHydration;
      }
    }

    if (debug) {
      const slices = Object.keys(hydrationConfig);
      console.log(`[Firefly] Found hydration configs for: ${slices.join(', ')}`);
    }

    const combinedReducer = combineReducers(reducerMap);

    // Wrap to handle the hydration action
    return ((state: S | undefined, action: any) => {
      if (action.type === HYDRATE_ACTION) {
        // Merge hydrated state into current state
        const newState = combinedReducer(state, action);
        return { ...newState, ...action.payload };
      }
      return combinedReducer(state, action);
    });
  }

  /**
   * Store enhancer that runs hydration after store creation and
   * adds hydration status methods to the store.
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
      const _listeners = new Set<(hydrated: boolean) => void>();

      const fireflyStore = Object.assign(store, {
        isHydrated: () => _hydrated,
        onHydrationChange: (callback: (hydrated: boolean) => void) => {
          _listeners.add(callback);
          return () => { _listeners.delete(callback); };
        },
        hydrated: Promise.resolve<void>(undefined), // replaced below
      });

      fireflyStore.hydrated = hydrateFromDatabase(database, hydrationConfig)
        .then((hydratedState) => {
          if (debug) {
            console.log('[Firefly] Hydration complete:', Object.keys(hydratedState));
          }

          dispatch({ type: HYDRATE_ACTION, payload: hydratedState });

          _hydrated = true;
          _listeners.forEach((cb) => cb(true));
          _listeners.clear();
        })
        .catch((error) => {
          console.error('[Firefly] Hydration failed:', error);

          _hydrated = true; // Mark as hydrated even on error so app can render
          _listeners.forEach((cb) => cb(true));
          _listeners.clear();
        });

      return fireflyStore;
    };
  }

  const middleware = createFireflyMiddleware(config);

  return { middleware, enhanceReducer, enhanceStore };
}
