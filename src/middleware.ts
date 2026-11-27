import type { Middleware } from 'redux';
import type { FireflyConfig } from './types';
import { isFireflyAction } from './types';
import { executeOperation, isEmptyEffect } from './executor';
import { createSerializer } from './serializer';
import { claimPendingWrite } from './settlement';
import type { WriteOutcome } from './settlement';

/**
 * Creates the effect-executing middleware: any dispatched Firefly action's DB
 * effect runs against the database, then its commit/rollback action is
 * dispatched. An action whose effect has nothing to run still reaches the
 * reducers, and that is all: no DB work, no commit, no rollback, no `onError`.
 * Use via `createReduxFirefly`.
 */
export function createFireflyMiddleware(config: FireflyConfig): Middleware<{}, any, any> {
  const { database, onError, debug } = config;
  const executeOptions = { transactionalSingleStatements: config.transactionalSingleStatements };

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

    // An empty write is not queued either: it must not wait behind, or hold
    // up, the writes that do have work.
    if (isEmptyEffect(firefly.effect)) {
      if (debug) {
        console.log('[Firefly] Empty effect, nothing to run:', action.type);
      }
      return result;
    }

    if (debug) {
      console.log('[Firefly] Processing action:', action.type);
      console.log('[Firefly] Effect:', firefly.effect);
    }

    const settle = claimPendingWrite(firefly);
    let settled = false;
    const settleOnce = (outcome: WriteOutcome) => {
      if (settled || !settle) return;
      settled = true;
      settle(outcome);
    };

    const run = () =>
      executeOperation(database, firefly.effect, executeOptions)
        .then((opResult) => {
          if (opResult.success) {
            if (debug) {
              console.log('[Firefly] Operation succeeded:', opResult);
            }

            const results = opResult.rows ?? opResult.results;

            if (firefly.commit) {
              const commitAction = {
                type: firefly.commit.type,
                payload: firefly.originalPayload,
                meta: { firefly: { result: results } },
              };

              if (debug) {
                console.log('[Firefly] Dispatching commit:', commitAction.type);
              }

              store.dispatch(commitAction);
            }

            settleOnce({ committed: true, results });
          } else {
            const error = opResult.error ?? new Error('[Firefly] Operation failed');

            if (debug) {
              console.error('[Firefly] Operation failed:', error);
            }

            if (firefly.rollback) {
              const rollbackAction = {
                type: firefly.rollback.type,
                payload: firefly.originalPayload,
                meta: { firefly: { error } },
              };

              if (debug) {
                console.log('[Firefly] Dispatching rollback:', rollbackAction.type);
              }

              store.dispatch(rollbackAction);
            }

            if (onError && opResult.error) {
              onError(opResult.error, action);
            }

            settleOnce({ committed: false, error });
          }
        })
        .catch((thrown: unknown) => {
          // A rollback always carries an Error, whatever was thrown.
          const error = thrown instanceof Error ? thrown : new Error(String(thrown));

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

          settleOnce({ committed: false, error });
        });

    // `run` never rejects (it catches internally); the serializer keeps the
    // chain alive regardless.
    void serializer.run(run);

    return result;
  };
}
