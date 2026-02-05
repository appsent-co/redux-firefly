import type { Reducer } from 'redux';
import type { FireflyState } from '../types';

/**
 * Initial state for the Firefly reducer
 */
const initialState: FireflyState = {
  hydrated: false,
};

/**
 * Reducer for tracking Firefly hydration status
 * This is a passive reducer - state is typically set via preloadedState
 * Could be extended in the future to handle additional actions
 *
 * @example
 * const store = configureStore({
 *   reducer: {
 *     ...rootReducer,
 *     _firefly: fireflyReducer  // Required for FireflyGate
 *   },
 *   preloadedState: {
 *     ...hydratedState,
 *     _firefly: { hydrated: true }  // Mark as hydrated
 *   }
 * })
 */
export const fireflyReducer: Reducer<FireflyState> = (
  state = initialState,
  action
) => {
  // This is a passive reducer - state is set via preloadedState
  // Could be extended in future to handle additional actions like:
  // - @@firefly/HYDRATION_STARTED
  // - @@firefly/HYDRATION_COMPLETE
  // - @@firefly/HYDRATION_ERROR
  return state;
};
