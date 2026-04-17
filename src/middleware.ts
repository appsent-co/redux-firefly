import type { Middleware } from 'redux';
import type { FireflyConfig } from './types';
import { isFireflyAction } from './types';
import { executeOperation } from './executor';

/**
 * Creates the Firefly middleware for Redux
 * @param config - Middleware configuration
 * @returns Redux middleware
 *
 * @example
 * const fireflyMiddleware = createFireflyMiddleware({
 *   database: db,
 *   onError: (error, action) => console.error('Firefly error:', error),
 *   debug: true
 * })
 *
 * const store = configureStore({
 *   reducer: rootReducer,
 *   middleware: (getDefaultMiddleware) =>
 *     getDefaultMiddleware().concat(fireflyMiddleware)
 * })
 */
export function createFireflyMiddleware(config: FireflyConfig): Middleware<{}, any, any> {
  const { database, onError, debug, serializeEffects = true } = config;

  // Single-connection drivers (expo-sqlite, better-sqlite3) reject a second
  // `BEGIN` while one is already open. Pooled drivers can opt out.
  let queue: Promise<unknown> = Promise.resolve();

  return (store) => (next) => (action) => {
    // Pass action through to reducer first (for optimistic updates)
    const result = next(action);

    // Check if action has firefly metadata
    if (!isFireflyAction(action)) {
      return result;
    }

    const { firefly } = action.meta;

    if (debug) {
      console.log('[Firefly] Processing action:', action.type);
      console.log('[Firefly] Effect:', firefly.effect);
    }

    const run = () =>
      executeOperation(database, firefly.effect)
        .then((opResult) => {
          if (opResult.success) {
            if (debug) {
              console.log('[Firefly] Operation succeeded:', opResult);
            }

            if (firefly.commit) {
              const commitAction = {
                type: firefly.commit.type,
                payload: firefly.originalPayload,
                meta: { firefly: { result: opResult.rows ?? opResult.results } },
              };

              if (debug) {
                console.log('[Firefly] Dispatching commit:', commitAction.type);
              }

              store.dispatch(commitAction);
            }
          } else {
            if (debug) {
              console.error('[Firefly] Operation failed:', opResult.error);
            }

            if (firefly.rollback) {
              const rollbackAction = {
                type: firefly.rollback.type,
                payload: firefly.originalPayload,
                meta: { firefly: { error: opResult.error } },
              };

              if (debug) {
                console.log('[Firefly] Dispatching rollback:', rollbackAction.type);
              }

              store.dispatch(rollbackAction);
            }

            if (onError && opResult.error) {
              onError(opResult.error, action);
            }
          }
        })
        .catch((error: Error) => {
          if (debug) {
            console.error('[Firefly] Unexpected error:', error);
          }

          if (firefly.rollback) {
            const rollbackAction = {
              type: firefly.rollback.type,
              payload: firefly.originalPayload,
              meta: { firefly: { error } },
            };

            store.dispatch(rollbackAction);
          }

          if (onError) {
            onError(error, action);
          }
        });

    if (serializeEffects) {
      // Same handler for fulfilled and rejected so one throwing effect
      // can't poison the queue for subsequent dispatches.
      queue = queue.then(run, run);
    } else {
      run();
    }

    return result;
  };
}
