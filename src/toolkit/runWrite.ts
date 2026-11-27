import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { isFireflyAction } from '../types';
import { isEmptyEffect } from '../executor';
import { cancelPendingWrite, registerPendingWrite } from '../settlement';
import type { WriteOutcome } from '../settlement';
import type { CommitMatcher, RollbackMatcher } from './createFireflySlice';

export type { WriteOutcome } from '../settlement';

/** A firefly action creator — what `createFireflySlice` puts on `slice.actions`. */
export type WriteCreator<Args extends unknown[], P, R> = ((...args: Args) => { type: string; payload: P }) & {
  commit: CommitMatcher<P, R>;
  rollback: RollbackMatcher<P>;
};

/**
 * Thunk that dispatches a firefly write and resolves once its database effect
 * has committed or rolled back (after the commit/rollback action has been
 * dispatched to reducers and listeners).
 *
 * An empty write runs nothing and dispatches neither commit nor rollback: it
 * resolves immediately as committed with `{}` as results.
 *
 * @example
 * const outcome = await dispatch(runWrite(addTodo, 'Buy milk'));
 * if (!outcome.committed) return handleFailure(outcome.error);
 * console.log(outcome.results);
 */
export function runWrite<Args extends unknown[], P, R>(
  creator: WriteCreator<Args, P, R>,
  ...args: Args
): (dispatch: Dispatch<UnknownAction>) => Promise<WriteOutcome<R>> {
  return (dispatch) => {
    const action = creator(...args);
    if (!isFireflyAction(action) || isEmptyEffect(action.meta.firefly.effect)) {
      dispatch(action as unknown as UnknownAction);
      return Promise.resolve({ committed: true, results: {} as R });
    }

    const key = action.meta.firefly;
    return new Promise<WriteOutcome<R>>((resolve) => {
      registerPendingWrite(key, (outcome) => resolve(outcome as WriteOutcome<R>));
      try {
        dispatch(action as unknown as UnknownAction);
      } catch (error) {
        cancelPendingWrite(key);
        throw error;
      }

      // createFireflyMiddleware claims `key` synchronously during dispatch.
      if (cancelPendingWrite(key)) {
        throw new Error(
          `[Firefly] runWrite(${action.type}): the firefly middleware did not handle this action. ` +
            'Make sure createReduxFirefly().middleware is registered on the store.'
        );
      }
    });
  };
}
