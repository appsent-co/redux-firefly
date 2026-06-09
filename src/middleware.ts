import type { Middleware } from 'redux';
import type { FireflyConfig } from './types';
import { isFireflyAction } from './types';
import { executeOperation } from './executor';
import { createSerializer } from './serializer';

/**
 * Creates the effect-executing middleware: any dispatched Firefly action's DB
 * effect runs against the database, then its commit/rollback action is
 * dispatched. Use via `createFirefly`.
 */
export function createFireflyMiddleware(config: FireflyConfig): Middleware<{}, any, any> {
  const { database, onError, debug } = config;

  // With serializeEffects on (the default, required for single-connection
  // drivers that reject nested BEGIN), effects are chained so only one runs at
  // a time. With it off (pooled drivers), the serializer runs work immediately.
  const serializer = createSerializer(config.serializeEffects ?? true);

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

    // `run` never rejects (it catches internally); the serializer keeps the
    // chain alive regardless.
    void serializer.run(run);

    return result;
  };
}
