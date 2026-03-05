import type { Reducer, Store, StoreEnhancerStoreCreator } from 'redux';
import { combineReducers } from 'redux';
import type { FireflyConfig, HydrationConfig, FireflyStore } from './types';
import type { HydratedReducer } from './withHydration';
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
export function createFirefly(config: FireflyConfig) {
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
      const hydratedReducer = reducer as HydratedReducer;
      if (hydratedReducer._fireflyHydration) {
        hydrationConfig[sliceName] = hydratedReducer._fireflyHydration;
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
    }) as Reducer<S>;
  }

  /**
   * Store enhancer that runs hydration after store creation and
   * adds hydration status methods to the store.
   */
  function enhanceStore(createStore: StoreEnhancerStoreCreator) {
    return (reducer: Reducer, preloadedState?: any): Store & FireflyStore => {
      const store = createStore(reducer, preloadedState);

      let _hydrated = false;
      const _listeners = new Set<(hydrated: boolean) => void>();

      const fireflyStore: Store & FireflyStore = Object.assign(store, {
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

          store.dispatch({ type: HYDRATE_ACTION, payload: hydratedState });

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
