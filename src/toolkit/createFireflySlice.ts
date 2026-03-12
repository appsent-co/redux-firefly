import { createSlice } from '@reduxjs/toolkit';
import type {
  CreateSliceOptions,
  Draft,
  PayloadAction,
  PrepareAction,
  SliceCaseReducers,
  ValidateSliceCaseReducers,
} from '@reduxjs/toolkit';
import type { FireflyEffect, FireflyCommitAction, FireflyRollbackAction, HydrationQuery } from '../types';
import { withHydration } from '../withHydration';

/** Shared fields for all Firefly case reducer definitions. */
interface FireflyCaseReducerDef<State, P> {
  reducer: (state: Draft<State>, action: PayloadAction<P>) => State | void;
  effect: FireflyEffect | FireflyEffect[] | ((payload: P) => FireflyEffect | FireflyEffect[]);
  commit?: (state: Draft<State>, action: FireflyCommitAction<P>) => State | void;
  rollback?: (state: Draft<State>, action: FireflyRollbackAction<P>) => State | void;
}

/** A Firefly case reducer definition with a prepare callback. */
export interface FireflyCaseReducerWithPrepareDef<State, P, Args extends unknown[]> extends FireflyCaseReducerDef<State, P> {
  prepare: (...args: Args) => { payload: P };
}

/**
 * Creates a typed Firefly case reducer with colocated effect, commit, and rollback handlers.
 *
 * Call this once per slice state type (curried), then use the returned function
 * to define individual case reducers. TypeScript infers the payload type from
 * the `reducer` (or `prepare`) you provide.
 *
 * @example
 * // At the top of your slice file, bind the state type once:
 * const fireflyReducer = createFireflyCaseReducer<Todo[]>();
 *
 * // Then use it in createFireflySlice (or createSlice) reducers:
 * const todosSlice = createFireflySlice({
 *   name: 'todos',
 *   initialState: [] as Todo[],
 *   reducers: {
 *     addTodo: fireflyReducer({
 *       reducer: (state, action) => { state.push(action.payload); },
 *       prepare: (text: string) => ({ payload: { id: tempId(), text, completed: false } }),
 *       effect: (payload) => ({ type: 'INSERT', table: 'todos', values: payload }),
 *       commit: (state, action) => { ... },
 *       rollback: (state, action) => { state.pop(); },
 *     }),
 *   },
 * });
 */
export function createFireflyCaseReducer<State>() {
  // Prepare overload first — TypeScript infers P from `prepare`'s return type,
  // then contextually types `reducer`, `effect`, `commit`, and `rollback`.
  function define<P, Args extends unknown[]>(
    def: FireflyCaseReducerWithPrepareDef<State, P, Args>
  ): FireflyCaseReducerWithPrepareDef<State, P, Args>;
  // No-prepare overload — `{ prepare?: never }` ensures objects with a `prepare`
  // field are never matched here, forcing them through the overload above.
  // A default identity prepare is injected at runtime for RTK compatibility.
  function define<P>(
    def: FireflyCaseReducerDef<State, P> & { prepare?: never }
  ): FireflyCaseReducerWithPrepareDef<State, P, []>;
  function define(def: FireflyCaseReducerDef<any, any> | FireflyCaseReducerWithPrepareDef<any, any, any[]>) {
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
): def is FireflyCaseReducerDef<any, any> & { prepare: PrepareAction<any> } {
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
 *
 * @example
 * const todosSlice = createFireflySlice({
 *   name: 'todos',
 *   initialState: [] as Todo[],
 *   hydration: {
 *     query: 'SELECT * FROM todos',
 *     transform: (rows) => rows.map(r => ({ ... })),
 *   },
 *   reducers: {
 *     addTodo: {
 *       reducer: (state, action) => { state.push(action.payload); },
 *       prepare: (text: string) => ({
 *         payload: { id: tempId(), text, completed: false },
 *       }),
 *       effect: (payload) => ({ type: 'INSERT', table: 'todos', values: { text: payload.text } }),
 *       commit: (state, action) => { ... },   // action.payload = original payload
 *       rollback: (state, action) => { ... }, // action.payload = original payload
 *     },
 *   },
 * });
 */

/** The pre-typed helper function provided to the `reducers` callback. */
type FireflyReducerFactory<State> = ReturnType<typeof createFireflyCaseReducer<State>>;

interface CreateFireflySliceOptions<State, CR extends SliceCaseReducers<State>, Name extends string>
  extends Omit<CreateSliceOptions<State, CR, Name>, 'reducers'> {
  hydration?: HydrationQuery;
}

export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  reducers: (fireflyReducer: FireflyReducerFactory<State>) => CR;
}) {
  const { name, reducers: reducersFactory, hydration, extraReducers: userExtraReducers, ...rest } = options;

  const reducers: CR = reducersFactory(createFireflyCaseReducer<State>());

  // Collect commit/rollback handlers with their auto-generated type strings
  const fireflyHandlers: Array<{
    type: string;
    handler: (state: Draft<State>, action: any) => State | void;
  }> = [];

  // Build a clean reducers map for createSlice
  for (const [key, def] of Object.entries(reducers)) {
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
