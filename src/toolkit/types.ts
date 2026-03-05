import type { Action } from 'redux';
import type { OperationResult } from '../types';

/**
 * Action shape received by commit handlers in createFireflySlice.
 * The middleware dispatches this when a database operation succeeds.
 *
 * @example
 * commit: (state, action: FireflyCommitPayloadAction<{ tempId: string }>) => {
 *   const realId = action.meta.firefly.result.insertId; // typed!
 *   const todo = state.find(t => t.id === action.payload.tempId);
 *   if (todo && realId) { todo.id = realId; }
 * }
 */
export interface FireflyCommitPayloadAction<P = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      result: OperationResult;
    };
  };
}

/**
 * Action shape received by rollback handlers in createFireflySlice.
 * The middleware dispatches this when a database operation fails.
 *
 * @example
 * rollback: (state, action: FireflyRollbackPayloadAction<{ tempId: string }>) => {
 *   return state.filter(t => t.id !== action.payload.tempId);
 * }
 */
export interface FireflyRollbackPayloadAction<P = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      error: Error;
    };
  };
}
