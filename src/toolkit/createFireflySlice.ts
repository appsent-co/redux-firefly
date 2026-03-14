import { createSlice } from '@reduxjs/toolkit';
import type {
  CreateSliceOptions,
  Draft,
  PayloadAction,
  PrepareAction,
  Slice,
  SliceCaseReducers,
  SliceSelectors,
  ValidateSliceCaseReducers,
} from '@reduxjs/toolkit';
import type {
  FireflyCommitAction,
  FireflyRollbackAction,
  HydrationQuery,
  InferEffectResult,
} from '../types';
import type { DrizzleQuery, DrizzleHydrationQuery } from '../drizzle/types';
import { withHydration } from '../withHydration';

/** Shared fields for all Firefly case reducer definitions. */
interface FireflyCaseReducerDef<State, P, E = any> {
  reducer: (state: Draft<State>, action: PayloadAction<P>) => State | void;
  effect: E | ((payload: P) => E);
  commit?: (state: Draft<State>, action: FireflyCommitAction<P, InferEffectResult<E>>) => State | void;
  rollback?: (state: Draft<State>, action: FireflyRollbackAction<P>) => State | void;
}

/** A Firefly case reducer definition with a prepare callback. */
export interface FireflyCaseReducerWithPrepareDef<State, P, E, Args extends unknown[]> extends FireflyCaseReducerDef<State, P, E> {
  prepare: (...args: Args) => { payload: P };
}

/**
 * Creates a typed Firefly case reducer with colocated effect, commit, and rollback handlers.
 *
 * Call this once per slice state type (curried), then use the returned function
 * to define individual case reducers. TypeScript infers the payload type from
 * the `reducer` (or `prepare`) you provide, and the result type from the
 * effect (DrizzleQuery<R> → R, FireflyEffect → DriverMutationResult).
 *
 * @example
 * const fireflyReducer = createFireflyCaseReducer<Todo[]>();
 *
 * const todosSlice = createFireflySlice({
 *   name: 'todos',
 *   initialState: [] as Todo[],
 *   reducers: (fireflyReducer) => ({
 *     addTodo: fireflyReducer({
 *       reducer: (state, action) => { state.push(action.payload); },
 *       prepare: (text: string) => ({ payload: { id: tempId(), text, completed: false } }),
 *       effect: (payload) => db.insert(todos).values({ text: payload.text }),
 *       commit: (state, action) => { ... },
 *       rollback: (state, action) => { state.pop(); },
 *     }),
 *   }),
 * });
 */
export function createFireflyCaseReducer<State>() {
  // Prepare overload — TypeScript infers P from `prepare`'s return type
  // and E from the effect value (used to derive the commit result type).
  function define<P, const E, Args extends unknown[]>(
    def: FireflyCaseReducerWithPrepareDef<State, P, E, Args>
  ): FireflyCaseReducerWithPrepareDef<State, P, E, Args>;
  // No-prepare overload — a default identity prepare is injected at runtime.
  function define<P, const E>(
    def: FireflyCaseReducerDef<State, P, E> & { prepare?: never }
  ): FireflyCaseReducerWithPrepareDef<State, P, E, []>;
  function define(def: FireflyCaseReducerDef<any, any, any> | FireflyCaseReducerWithPrepareDef<any, any, any, any[]>) {
    if (!('prepare' in def) || !def.prepare) {
      return { ...def, prepare: (payload: any) => ({ payload }) };
    }
    return def;
  }
  return define;
}

/**
 * Checks if a reducer definition has a firefly effect.
 */
function isFireflyReducer(
  def: unknown
): def is FireflyCaseReducerDef<any, any, any> & { prepare: PrepareAction<any> } {
  return (
    typeof def === 'object' &&
    def !== null &&
    'reducer' in def &&
    'effect' in def
  );
}

/**
 * Creates a Redux Toolkit slice with colocated Firefly commit/rollback
 * handlers and optional hydration configuration.
 *
 * Commit/rollback handlers are registered internally via extraReducers
 * and do NOT appear in `slice.actions`. The middleware dispatches them
 * automatically using auto-generated type strings:
 * - Commit: `{sliceName}/{reducerName}/commit`
 * - Rollback: `{sliceName}/{reducerName}/rollback`
 *
 * If `hydration` is provided, the returned `slice.reducer` will have
 * hydration metadata attached (equivalent to wrapping with `withHydration`).
 * Supports both raw SQL queries and drizzle select queries for hydration.
 */

/** The pre-typed helper function provided to the `reducers` callback. */
type FireflyReducerFactory<State> = ReturnType<typeof createFireflyCaseReducer<State>>;

interface CreateFireflySliceOptions<State, CR extends SliceCaseReducers<State>, Name extends string>
  extends Omit<CreateSliceOptions<State, CR, Name>, 'reducers'> {
}

// Overload: Drizzle hydration with typed query inference
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  reducers: (fireflyReducer: FireflyReducerFactory<State>) => CR;
  hydration: DrizzleHydrationQuery<Q, State>;
}): Slice<State, CR, Name, Name, SliceSelectors<State>>;
// Overload: SQL hydration or no hydration
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  reducers: (fireflyReducer: FireflyReducerFactory<State>) => CR;
  hydration?: HydrationQuery;
}): Slice<State, CR, Name, Name, SliceSelectors<State>>;
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  reducers: (fireflyReducer: FireflyReducerFactory<State>) => CR;
  hydration?: HydrationQuery | DrizzleHydrationQuery<any, State>;
}) {
  const { name, reducers: reducersFactory, hydration, extraReducers: userExtraReducers, ...rest } = options;

  const reducers: CR = reducersFactory(createFireflyCaseReducer<State>());

  // Collect commit/rollback handlers with their auto-generated type strings
  const fireflyHandlers: Array<{
    type: string;
    handler: (state: Draft<State>, action: any) => State | void;
  }> = [];

  // Build a clean reducers map for createSlice
  for (const [key, def] of Object.entries(reducers as Record<string, unknown>)) {
    if (isFireflyReducer(def)) {
      const commitType = `${name}/${key}/commit`;
      const rollbackType = `${name}/${key}/rollback`;

      if (def.commit) {
        fireflyHandlers.push({ type: commitType, handler: def.commit });
      }

      if (def.rollback) {
        fireflyHandlers.push({ type: rollbackType, handler: def.rollback });
      }

      // Wrap prepare to construct meta.firefly from the effect property
      const originalPrepare = def.prepare;
      const wrappedPrepare: PrepareAction<any> = (...args: unknown[]) => {
        const prepared = originalPrepare
          ? originalPrepare(...args)
          : { payload: null };

        const payload = prepared.payload;
        const effectValue = typeof def.effect === 'function'
          ? def.effect(payload)
          : def.effect;

        const firefly: Record<string, unknown> = {
          effect: effectValue,
          originalPayload: payload,
        };

        if (def.commit) {
          firefly.commit = { type: commitType };
        }

        if (def.rollback) {
          firefly.rollback = { type: rollbackType };
        }

        let existingMeta = {};
        if ('meta' in prepared && typeof prepared.meta === 'object' && prepared.meta !== null) {
          existingMeta = prepared.meta;
        }

        return {
          ...prepared,
          meta: { ...existingMeta, firefly },
        };
      };

      def.prepare = wrappedPrepare;
    }
  }

  const slice = createSlice({
    ...rest,
    name,
    reducers: reducers as unknown as ValidateSliceCaseReducers<State, CR>,
    extraReducers: (builder) => {
      for (const { type, handler } of fireflyHandlers) {
        builder.addCase(type, handler);
      }

      if (typeof userExtraReducers === 'function') {
        userExtraReducers(builder);
      }
    },
  });

  // Attach hydration metadata to the reducer if provided
  if (hydration) {
    withHydration(slice.reducer, hydration);
  }

  return slice;
}
