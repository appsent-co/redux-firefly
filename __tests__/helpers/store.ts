import { configureStore } from '@reduxjs/toolkit';
import type { Middleware, Reducer, UnknownAction } from '@reduxjs/toolkit';
import { createReduxFirefly } from '../../src';
import type { FireflyAction, FireflyConfig, FireflyMeta, FireflyStore } from '../../src';

/**
 * Lets everything already scheduled run: all pending promise callbacks, then
 * one macrotask. Enough for a write over the fakes to reach its commit or
 * rollback — and to prove that a write which should be waiting did not move.
 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface TestStoreOptions<S extends Record<string, any>> {
  database: FireflyConfig['database'];
  /** Slice reducers, as passed to `enhanceReducer`. Default: one inert slice. */
  reducers?: { [K in keyof S]: Reducer<S[K]> };
  /** Extra `FireflyConfig` (`transactionalSingleStatements`, `serializeEffects`, ...). */
  config?: Partial<Omit<FireflyConfig, 'database' | 'onError'>>;
}

/**
 * A real store over `createReduxFirefly`, recording what a test needs to see:
 * every action that was dispatched (the write itself, then its commit or
 * rollback) and every `onError` call.
 */
export async function createTestStore<S extends Record<string, any> = Record<string, any>>(
  options: TestStoreOptions<S>
) {
  const onError = jest.fn<void, [Error, FireflyAction]>();
  const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
    ...options.config,
    database: options.database,
    onError,
  });

  const actions: UnknownAction[] = [];
  const recorder: Middleware = () => (next) => (action) => {
    actions.push(action as UnknownAction);
    return next(action);
  };

  const reducers = options.reducers ?? ({ idle: (state: null = null) => state } as any);

  const store = configureStore({
    reducer: enhanceReducer<S>(reducers),
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }).concat(recorder, middleware),
    enhancers: (getDefault) => getDefault().concat(enhanceStore),
  });
  await (store as unknown as FireflyStore).hydrated;

  return {
    store,
    /** Every action dispatched so far, in order. */
    actions,
    /** The types of `actions`. */
    types: () => actions.map((action) => action.type),
    onError,
    /** The first dispatched action of that type; throws when there is none. */
    find<A = any>(type: string): A {
      const action = actions.find((candidate) => candidate.type === type);
      if (!action) {
        throw new Error(`no "${type}" action was dispatched (saw: ${actions.map((a) => a.type).join(', ')})`);
      }
      return action as A;
    },
  };
}

/**
 * A hand-built Firefly action, as a plain-redux user writes one: its commit is
 * `<type>/commit` and its rollback `<type>/rollback`.
 */
export function fireflyAction<P>(
  type: string,
  payload: P,
  effect: FireflyMeta['effect'],
  meta: Record<string, unknown> = {}
) {
  return {
    type,
    payload,
    meta: {
      ...meta,
      firefly: {
        effect,
        commit: { type: `${type}/commit` },
        rollback: { type: `${type}/rollback` },
        originalPayload: payload,
      },
    },
  };
}
