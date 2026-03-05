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
export function createFireflyMiddleware(config: FireflyConfig): Middleware {
  const { database, onError, debug } = config;

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

    // Execute database operation asynchronously
    executeOperation(database, firefly.effect)
      .then((opResult) => {
        if (opResult.success) {
          if (debug) {
            console.log('[Firefly] Operation succeeded:', opResult);
          }

          // Dispatch commit action if provided
          if (firefly.commit) {
            const commitAction = {
              ...firefly.commit,
              meta: { firefly: { result: opResult } },
            };

            if (debug) {
              console.log('[Firefly] Dispatching commit:', commitAction.type);
            }

            store.dispatch(commitAction);
          }
        } else {
          // Operation failed
          if (debug) {
            console.error('[Firefly] Operation failed:', opResult.error);
          }

          // Dispatch rollback action if provided
          if (firefly.rollback) {
            const rollbackAction = {
              ...firefly.rollback,
              meta: { firefly: { error: opResult.error } },
            };

            if (debug) {
              console.log('[Firefly] Dispatching rollback:', rollbackAction.type);
            }

            store.dispatch(rollbackAction);
          }

          // Call error handler if provided
          if (onError && opResult.error) {
            onError(opResult.error, action);
          }
        }
      })
      .catch((error: Error) => {
        // Unexpected error during operation execution
        if (debug) {
          console.error('[Firefly] Unexpected error:', error);
        }

        // Dispatch rollback on unexpected errors
        if (firefly.rollback) {
          const rollbackAction = {
            ...firefly.rollback,
            meta: { firefly: { error } },
          };

          store.dispatch(rollbackAction);
        }

        // Call error handler
        if (onError) {
          onError(error, action);
        }
      });

    return result;
  };
}
