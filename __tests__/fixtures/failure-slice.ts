import type { SliceCaseReducers } from '@reduxjs/toolkit';
import { createFireflySlice as createLibrarySlice } from '../../src/toolkit';
import type {
  CreateFireflySliceOptions,
  DrizzleHydrationQuery,
  DrizzleQuery,
  FireflyReducerFactory,
  FireflySlice,
  FireflySliceHydration,
  HydrationQuery,
} from '../../src/toolkit';

/**
 * A thin wrapper around createFireflySlice, as an app writes one: here every
 * firefly reducer may declare `failure` copy, which the wrapper puts on the
 * dispatched action as `meta.failure` for the store's `onError` to read.
 *
 * It is a fixture, not library code: the tests use it to prove that the
 * library's types and conventions survive being wrapped.
 */

export interface FailureCopy {
  titleKey: string;
  messageKey: string;
}

/** What this wrapper's `fireflyReducer` accepts on top of the library's. */
interface WithFailure {
  failure?: FailureCopy;
}

type FailureSliceOptions<State, CR extends SliceCaseReducers<State>, Name extends string> =
  CreateFireflySliceOptions<State, CR, Name, WithFailure>;

function withFailure<State>(fireflyReducer: FireflyReducerFactory<State>): FireflyReducerFactory<State, WithFailure> {
  return (def) => {
    const caseReducer = fireflyReducer(def);
    const { failure } = def;
    if (!failure) return caseReducer;
    return {
      ...caseReducer,
      prepare: (...args) => {
        // The reducer's own `prepare` may have returned a `meta` too: keep it.
        const prepared: ReturnType<typeof caseReducer.prepare> & { meta?: object } =
          caseReducer.prepare(...args);
        return { ...prepared, meta: { ...prepared.meta, failure } };
      },
    };
  };
}

export function createFailureSlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
>(options: FailureSliceOptions<State, CR, Name> & {
  hydration: DrizzleHydrationQuery<Q, State>;
}): FireflySlice<State, CR, Name>;
export function createFailureSlice<State, Name extends string, CR extends SliceCaseReducers<State>>(
  options: FailureSliceOptions<State, CR, Name> & { hydration?: HydrationQuery }
): FireflySlice<State, CR, Name>;
export function createFailureSlice<State, Name extends string, CR extends SliceCaseReducers<State>>(
  options: FailureSliceOptions<State, CR, Name> & { hydration?: FireflySliceHydration<State> }
): FireflySlice<State, CR, Name> {
  const { reducers, ...rest } = options;
  return createLibrarySlice({
    ...rest,
    reducers: (fireflyReducer) => reducers(withFailure(fireflyReducer)),
  });
}

/** The failure copy a failed action carries, if its reducer declared any. */
export function failureCopyOf(action: unknown): FailureCopy | undefined {
  const failure = (action as { meta?: { failure?: Partial<FailureCopy> } } | null)?.meta?.failure;
  return typeof failure?.titleKey === 'string' && typeof failure.messageKey === 'string'
    ? { titleKey: failure.titleKey, messageKey: failure.messageKey }
    : undefined;
}
