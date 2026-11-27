import { createSlice } from '@reduxjs/toolkit';
import type {
  Action,
  ActionReducerMapBuilder,
  CaseReducerActions,
  CreateSliceOptions,
  Dispatch,
  Draft,
  ListenerEffectAPI,
  PayloadAction,
  Slice,
  SliceCaseReducers,
  TypedStartListening,
  UnknownAction,
  UnsubscribeListener,
  ValidateSliceCaseReducers,
} from '@reduxjs/toolkit';
import type {
  ApplyRowsConfig,
  FireflyCommitAction,
  FireflyCommitted,
  FireflyRollbackAction,
  FireflyRolledBack,
  HydrationQuery,
  InferEffectResult,
} from '../types';
import type { DrizzleQuery, DrizzleHydrationQuery } from '../drizzle/types';
import { applyRows as attachApplyRows, withHydration } from '../withHydration';
import { isEmptyEffect } from '../executor';

/**
 * What a firefly reducer's own `commit` handler receives: the dispatched commit
 * action, plus its unpacked `results` (= `action.meta.firefly.result`). So both
 * `(state, { payload, results })` and `(state, action) => action.meta.firefly.result`
 * read the same thing.
 */
export type FireflyCommitHandlerAction<P = any, R = any> = FireflyCommitAction<P, R> & FireflyCommitted<P, R>;

/**
 * What a firefly reducer's own `rollback` handler receives: the dispatched
 * rollback action, plus its unpacked `error` (always an `Error`).
 */
export type FireflyRollbackHandlerAction<P = any> = FireflyRollbackAction<P> & FireflyRolledBack<P>;

/**
 * Matches and unpacks the commit of one firefly reducer. Found on its action
 * creator: `slice.actions.addTodo.commit`.
 */
export interface CommitMatcher<P = any, R = any> {
  /** The commit's action type: `<slice>/<reducer>/commit`. */
  type: string;
  /**
   * Whether `action` is this reducer's commit. The `& UnknownAction` is what
   * lets Redux Toolkit take `match` wherever it takes a matcher
   * (`startListening({ matcher })`, `isAnyOf`): it asks for a guard on an
   * `UnknownAction`, which an interface alone is not.
   */
  match: (action: unknown) => action is FireflyCommitAction<P, R> & UnknownAction;
  /** The payload the write was dispatched with, and the effect's results. */
  unpack: (action: Action) => FireflyCommitted<P, R>;
}

/**
 * Matches and unpacks the rollback of one firefly reducer. Found on its action
 * creator: `slice.actions.addTodo.rollback`.
 */
export interface RollbackMatcher<P = any> {
  /** The rollback's action type: `<slice>/<reducer>/rollback`. */
  type: string;
  /** Whether `action` is this reducer's rollback. See {@link CommitMatcher} for the `& UnknownAction`. */
  match: (action: unknown) => action is FireflyRollbackAction<P> & UnknownAction;
  /** The payload the write was dispatched with, and the error that failed it (always an `Error`). */
  unpack: (action: Action) => FireflyRolledBack<P>;
}

/**
 * The arguments of the action creator of a firefly reducer that has no
 * `prepare`: the payload itself, optional when the payload may be `undefined`.
 */
export type FireflyIdentityPrepareArgs<P> = undefined extends P ? [payload?: P] : [payload: P];

/**
 * A firefly reducer as you write it, inside `fireflyReducer({ ... })`.
 *
 * `P` is the payload (inferred from `prepare`, or from the `reducer`'s
 * annotated action when there is no `prepare`), `E` the effect, `Args` the
 * action creator's arguments.
 *
 * Write `effect` above `commit`. TypeScript types a definition's callbacks top
 * to bottom, and the commit's `results` come from the effect: a `commit` above
 * an `effect` function gets `any` results.
 */
export interface FireflyCaseReducerDef<State, P, E = any, Args extends unknown[] = any[]> {
  /**
   * Builds the payload from the action creator's arguments. Any `meta` it
   * returns is kept on the dispatched action, next to `meta.firefly`. Omit it
   * to dispatch the payload as is.
   */
  prepare?: (...args: Args) => { payload: P };
  /** Optimistic update. Omit it for a commit-only write: state changes only once the write lands. */
  reducer?: (state: Draft<State>, action: PayloadAction<P>) => State | void;
  /**
   * What to write: a drizzle query or SQL effect, an array of them, or a
   * record of named slots — as a value or as a function of the payload. An
   * empty effect (`undefined`, `null`, `[]`, `{}`, a record with nothing to
   * run) writes nothing and dispatches neither commit nor rollback.
   */
  effect: E | ((payload: P) => E);
  /** Runs once the write has landed. `results` are the effect's (by name for a record effect). */
  commit?: (state: Draft<State>, action: FireflyCommitHandlerAction<P, InferEffectResult<E>>) => State | void;
  /** Runs when the write failed. The database is unchanged. */
  rollback?: (state: Draft<State>, action: FireflyRollbackHandlerAction<P>) => State | void;
}

/** A firefly reducer definition with a `prepare` callback. */
export interface FireflyCaseReducerWithPrepareDef<State, P, E, Args extends unknown[]>
  extends FireflyCaseReducerDef<State, P, E, Args> {
  prepare: (...args: Args) => { payload: P };
}

/** Type-level only: marks what `fireflyReducer(...)` returned, with its payload and effect types. */
declare const FIREFLY: unique symbol;

/**
 * What `fireflyReducer({ ... })` returns: the definition with `reducer` and
 * `prepare` filled in, so that it is a prepared case reducer for Redux Toolkit.
 *
 * A wrapper may rebuild one (`{ ...caseReducer, prepare }`) before returning it
 * from `reducers`; the payload and effect types travel with it.
 */
export interface FireflyCaseReducer<State, P, E, Args extends unknown[] = any[]>
  extends FireflyCaseReducerDef<State, P, E, Args> {
  prepare: (...args: Args) => { payload: P };
  reducer: (state: Draft<State>, action: PayloadAction<P>) => State | void;
  /** Type-level only; there is no such property at runtime. */
  readonly [FIREFLY]: { payload: P; effect: E };
}

/**
 * `Args` as inferred from the definition only. Without it, a definition with
 * no `prepare` would take its `Args` from where the result goes — the slice's
 * `reducers` map, which makes them `any[]` — instead of from the default.
 */
type Fixed<Args extends unknown[]> = [Args][Args extends any ? 0 : never];

/** A SQL effect as `const` inference reads one written inline: readonly, its params a tuple. */
type SqlEffectLiteral = { readonly sql: string; readonly params?: readonly unknown[] };

type CheckedStatement = DrizzleQuery | SqlEffectLiteral;

/** What a record slot may hold. See `FireflyEffectSlot`. */
type CheckedSlot = CheckedStatement | readonly CheckedStatement[] | null | undefined | false | 0 | 0n | '';

/**
 * Compile-time only. What the `effect` of a record with a bad slot is checked
 * against, so that the error names the slot: `FireflyInvalidEffectSlot<"deleted">`.
 * A slot holds a statement, a list of statements, or a falsy value (skipped) —
 * not a Promise, a query builder that was not called, or a list with a skipped
 * entry — and cannot be named `sql`.
 */
export interface FireflyInvalidEffectSlot<Name> {
  readonly 'this slot of the record effect is not a statement, a list of statements or a falsy value (a slot cannot be named "sql" either)': Name;
}

/**
 * Compile-time only. What an `effect` that is a Promise is checked against, so
 * that the error names the mistake: `effect` returns the query itself, it does
 * not await or run it.
 */
export interface FireflyEffectIsAPromise {
  readonly 'effect must return the query itself, not a Promise: do not await or run it': never;
}

/** The names of the properties of a record effect that are no slot. */
type InvalidSlotNames<E> = {
  [K in keyof E]-?: K extends 'sql' ? K : E[K] extends CheckedSlot ? never : K;
}[keyof E];

/** What is wrong with an effect, or `never`. The single and array forms are left as 1.x typed them. */
type EffectProblem<E> =
  E extends null | undefined | DrizzleQuery | SqlEffectLiteral | readonly unknown[] ? never :
  E extends PromiseLike<unknown> ? FireflyEffectIsAPromise :
  E extends object ? ([InvalidSlotNames<E>] extends [never] ? never : FireflyInvalidEffectSlot<InvalidSlotNames<E>>) :
  never;

/**
 * Rejects, at compile time, an effect that would lose its result types without
 * a word, or fail when it runs: a record with a slot that is not a statement,
 * a list of statements or a skipped slot, and an effect that is a Promise.
 *
 * It adds nothing to a valid definition, and nothing while `E` is not known
 * yet (TypeScript is still inferring it).
 */
export type FireflyEffectCheck<E> =
  unknown extends E ? unknown :
  [EffectProblem<E>] extends [never] ? unknown :
  { effect: EffectProblem<E> };

/**
 * The `fireflyReducer` helper handed to the `reducers` callback.
 *
 * `Extra` is for wrappers of `createFireflySlice`: the fields their own
 * `fireflyReducer` accepts on top of the library's
 * (`FireflyReducerFactory<State, { failure?: FailureCopy }>`).
 */
export interface FireflyReducerFactory<State, Extra = unknown> {
  <P, const E, Args extends unknown[] = FireflyIdentityPrepareArgs<P>>(
    def: FireflyCaseReducerDef<State, P, E, Args> & Extra & FireflyEffectCheck<E>
  ): FireflyCaseReducer<State, P, E, Fixed<Args>>;
}

type FireflyMatchers<Definition> =
  Definition extends { readonly [FIREFLY]: { payload: infer P; effect: infer E } }
    ? { commit: CommitMatcher<P, InferEffectResult<E>>; rollback: RollbackMatcher<P> }
    : unknown;

/**
 * A firefly slice's action creators: Redux Toolkit's, where each firefly
 * reducer's creator also carries its `commit` and `rollback` matchers.
 */
export type FireflyActions<CR extends SliceCaseReducers<any>, Name extends string = string> = {
  [K in keyof CR]: CaseReducerActions<CR, Name>[K] & FireflyMatchers<CR[K]>;
};

/** What `createFireflySlice` returns: a Redux Toolkit slice whose actions are {@link FireflyActions}. */
export type FireflySlice<State, CR extends SliceCaseReducers<State>, Name extends string = string> =
  Omit<Slice<State, CR, Name>, 'actions'> & { actions: FireflyActions<CR, Name> };

/**
 * A slice's hydration, of either kind: a SQL query, or drizzle select
 * query(ies). It is what a wrapper of `createFireflySlice` forwards — the type
 * of `hydration` in the wrapper's implementation signature, behind overloads
 * that type the `transform`.
 *
 * The drizzle `transform` takes `unknown` rows here, on purpose: a `transform`
 * annotated with a row type only fits the overload that checks that type
 * against the query.
 */
export type FireflySliceHydration<State> =
  | HydrationQuery
  | {
      query: DrizzleQuery | readonly DrizzleQuery[];
      transform?: (rows: unknown) => State;
    };

/**
 * The options of `createFireflySlice`, without `hydration` (each overload
 * types it). `Extra` is passed on to {@link FireflyReducerFactory}.
 */
export interface CreateFireflySliceOptions<
  State,
  CR extends SliceCaseReducers<State>,
  Name extends string = string,
  Extra = unknown,
> extends Omit<CreateSliceOptions<State, CR, Name>, 'reducers'> {
  /** The slice's reducers. Wrap the writes in `fireflyReducer`; plain case reducers can sit next to them. */
  reducers: (fireflyReducer: FireflyReducerFactory<State, Extra>) => CR;
  /** Binds the slice to a table, so merged rows are applied without a SQL read. */
  applyRows?: ApplyRowsConfig<State>;
}

/** Stands in for the `reducer` of a commit-only write. */
const noopReducer = () => {};

const identityPrepare = (payload: unknown) => ({ payload });

/**
 * Creates the `fireflyReducer` helper for a slice state type: it types a
 * firefly reducer's colocated `effect`, `commit` and `rollback`, and fills in
 * the `reducer` (a no-op) and the `prepare` (identity) it leaves out.
 *
 * `createFireflySlice` hands one to its `reducers` callback.
 *
 * @example
 * const fireflyReducer = createFireflyCaseReducer<Todo[]>();
 *
 * const addTodo = fireflyReducer({
 *   prepare: (text: string) => ({ payload: { id: tempId(), text, completed: false } }),
 *   reducer: (state, action) => { state.push(action.payload); },
 *   effect: (payload) => db.insert(todos).values({ text: payload.text }).returning(),
 *   commit: (state, { payload, results }) => { ... },
 *   rollback: (state, { payload }) => { ... },
 * });
 */
export function createFireflyCaseReducer<State>(): FireflyReducerFactory<State> {
  const define = (def: FireflyCaseReducerDef<any, any, any, any[]>) => ({
    ...def,
    reducer: def.reducer ?? noopReducer,
    prepare: def.prepare ?? identityPrepare,
  });
  return define as FireflyReducerFactory<State>;
}

/**
 * Checks if a reducer definition is a firefly reducer: it has an `effect`.
 */
function isFireflyReducer(def: unknown): def is FireflyCaseReducerDef<any, any, any, any[]> {
  return typeof def === 'object' && def !== null && 'effect' in def;
}

function hasType(action: unknown, type: string): boolean {
  return typeof action === 'object' && action !== null && (action as { type?: unknown }).type === type;
}

function commitMatcher<P, R>(type: string): CommitMatcher<P, R> {
  return {
    type,
    match: (action): action is FireflyCommitAction<P, R> & UnknownAction => hasType(action, type),
    unpack: (action) => {
      const { payload, meta } = action as Partial<FireflyCommitAction<P, R>>;
      return { payload: payload as P, results: meta?.firefly?.result as R };
    },
  };
}

function rollbackMatcher<P>(type: string): RollbackMatcher<P> {
  return {
    type,
    match: (action): action is FireflyRollbackAction<P> & UnknownAction => hasType(action, type),
    unpack: (action) => {
      const { payload, meta } = action as { payload?: P; meta?: { firefly?: { error?: unknown } } };
      const error = meta?.firefly?.error;
      return { payload: payload as P, error: error instanceof Error ? error : new Error(String(error)) };
    },
  };
}

/**
 * Creates a Redux Toolkit slice whose writes carry their database effect, with
 * colocated commit/rollback handlers and optional hydration.
 *
 * Every firefly reducer's action creator carries two matchers,
 * `slice.actions.addTodo.commit` and `.rollback`, each
 * `{ type, match(action), unpack(action) }`. The middleware dispatches the
 * commit (`{sliceName}/{reducerName}/commit`) once the write has landed and the
 * rollback (`{sliceName}/{reducerName}/rollback`) when it failed — for every
 * write, whether or not the reducer defines a handler — so other slices
 * ({@link onCommit}, {@link onRollback}) and listeners can react to them
 * without spelling out a type string.
 *
 * If `hydration` is provided, the returned `slice.reducer` has hydration
 * metadata attached (equivalent to wrapping with `withHydration`), from a raw
 * SQL query or from drizzle select queries — this overload types a drizzle
 * hydration's `transform` from its queries. `applyRows` attaches a row-level
 * apply config the same way.
 *
 * @example
 * const todosSlice = createFireflySlice({
 *   name: 'todos',
 *   initialState: [] as Todo[],
 *   reducers: (fireflyReducer) => ({
 *     addTodo: fireflyReducer({
 *       prepare: (text: string) => ({ payload: { id: tempId(), text } }),
 *       reducer: (state, action) => { state.push(action.payload); },
 *       effect: (payload) => ({
 *         todo: db.insert(todos).values({ text: payload.text }).returning(),
 *         log: db.insert(events).values({ kind: 'added' }),
 *       }),
 *       commit: (state, { payload, results }) => { ... results.todo[0] ... },
 *       rollback: (state, { payload, error }) => { ... },
 *     }),
 *   }),
 * });
 */
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  hydration: DrizzleHydrationQuery<Q, State>;
}): FireflySlice<State, CR, Name>;
/**
 * Creates a Redux Toolkit slice whose writes carry their database effect, with
 * colocated commit/rollback handlers — here with a SQL `hydration`, or none.
 *
 * Every firefly reducer's action creator carries `commit` and `rollback`
 * matchers (`{ type, match(action), unpack(action) }`), dispatched for every
 * write. See the first overload for the full description and an example.
 */
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  hydration?: HydrationQuery;
}): FireflySlice<State, CR, Name>;
/**
 * Creates a Redux Toolkit slice whose writes carry their database effect —
 * with a `hydration` of either kind, as a wrapper of `createFireflySlice`
 * forwards it from its own options. A `hydration` written in place goes
 * through the overloads above, which type its `transform`; this one does not
 * accept a drizzle `transform` annotated with a row type. See the first
 * overload for the full description.
 */
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  hydration?: FireflySliceHydration<State>;
}): FireflySlice<State, CR, Name>;
export function createFireflySlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
>(options: CreateFireflySliceOptions<State, CR, Name> & {
  hydration?: HydrationQuery | DrizzleHydrationQuery<any, State>;
}): FireflySlice<State, CR, Name> {
  return createSliceImpl(options);
}

/**
 * The overloaded `createFireflySlice` signature, parameterized by `Extra`
 * reducer fields added via {@link buildCreateFireflySlice}.
 */
export interface CreateFireflySlice<Extra = unknown> {
  <
    State,
    Name extends string,
    CR extends SliceCaseReducers<State>,
    const Q extends DrizzleQuery | readonly DrizzleQuery[],
  >(
    options: CreateFireflySliceOptions<State, CR, Name, Extra> & {
      hydration: DrizzleHydrationQuery<Q, State>;
    }
  ): FireflySlice<State, CR, Name>;
  <State, Name extends string, CR extends SliceCaseReducers<State>>(
    options: CreateFireflySliceOptions<State, CR, Name, Extra> & {
      hydration?: HydrationQuery;
    }
  ): FireflySlice<State, CR, Name>;
  <State, Name extends string, CR extends SliceCaseReducers<State>>(
    options: CreateFireflySliceOptions<State, CR, Name, Extra> & {
      hydration?: FireflySliceHydration<State>;
    }
  ): FireflySlice<State, CR, Name>;
}

/** Options for {@link buildCreateFireflySlice}. */
export interface BuildCreateFireflySliceOptions<Extra extends object> {
  /**
   * Derives extra properties to merge into the dispatched action's `meta`
   * (alongside `meta.firefly` and any `meta` returned by `prepare`).
   * Called once per firefly reducer when the slice is created.
   */
  meta?: (def: Extra) => Record<string, unknown> | undefined;
}

/**
 * Builds a custom `createFireflySlice` whose `fireflyReducer` accepts extra
 * app-specific fields (`Extra`) and attaches action metadata derived from them,
 * without duplicating `createFireflySlice`'s overloads or wrapping `prepare`.
 *
 * @example
 * const createFireflySlice = buildCreateFireflySlice<{ failure?: FailureCopy }>({
 *   meta: ({ failure }) => (failure ? { failure } : undefined),
 * });
 */
export function buildCreateFireflySlice<Extra extends object = Record<never, never>>(
  options?: BuildCreateFireflySliceOptions<Extra>
): CreateFireflySlice<Extra> {
  const getMeta = options?.meta;
  const factory = (
    sliceOptions: CreateFireflySliceOptions<any, any, any, Extra> & {
      hydration?: HydrationQuery | DrizzleHydrationQuery<any, any>;
    }
  ) => createSliceImpl(sliceOptions, getMeta);
  return factory as CreateFireflySlice<Extra>;
}

function createSliceImpl<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
  Extra = unknown,
>(
  options: CreateFireflySliceOptions<State, CR, Name, Extra> & {
    hydration?: HydrationQuery | DrizzleHydrationQuery<any, State>;
  },
  getMeta?: (def: Extra) => Record<string, unknown> | undefined
): FireflySlice<State, CR, Name> {
  const { name, reducers: reducersFactory, hydration, applyRows: applyRowsConfig, extraReducers: userExtraReducers, ...rest } = options;

  const definitions: CR = reducersFactory(createFireflyCaseReducer<State>() as FireflyReducerFactory<State, Extra>);

  // What createSlice gets: plain case reducers as they are, and for each
  // firefly reducer a `{ reducer, prepare }` built here. The definitions are
  // left untouched — a wrapper may hold on to them.
  const caseReducers: Record<string, unknown> = {};
  const matchers: Record<string, { commit: CommitMatcher; rollback: RollbackMatcher }> = {};
  const handlers: Array<{
    type: string;
    handler: (state: Draft<State>, action: any) => State | void;
  }> = [];

  for (const [key, def] of Object.entries(definitions as Record<string, unknown>)) {
    if (!isFireflyReducer(def)) {
      caseReducers[key] = def;
      continue;
    }

    const commit = commitMatcher(`${name}/${key}/commit`);
    const rollback = rollbackMatcher(`${name}/${key}/rollback`);
    matchers[key] = { commit, rollback };

    // A case only for the handlers the reducer defines: the slice's own
    // extraReducers can then add one for a write that has none, which a
    // second case for the same type would forbid.
    const { commit: onCommitted, rollback: onRolledBack } = def;
    if (onCommitted) {
      handlers.push({
        type: commit.type,
        handler: (state, action) => onCommitted(state, { ...action, ...commit.unpack(action) }),
      });
    }
    if (onRolledBack) {
      handlers.push({
        type: rollback.type,
        handler: (state, action) => onRolledBack(state, { ...action, ...rollback.unpack(action) }),
      });
    }

    const { effect } = def;
    const prepare: (...args: any[]) => { payload: unknown; meta?: unknown } = def.prepare ?? identityPrepare;
    const extraMeta = getMeta?.(def as unknown as Extra);

    caseReducers[key] = {
      reducer: def.reducer ?? noopReducer,
      // Builds meta.firefly from the effect. The commit and rollback are
      // always named, handler or not, so the middleware dispatches both for
      // every write and the matchers fire.
      prepare: (...args: unknown[]) => {
        const prepared = prepare(...args);
        const payload = prepared.payload;

        // An empty write carries no effect at all, so `isFireflyAction` is
        // false for it and a caller can tell from the action alone that no
        // commit or rollback will follow.
        const built = typeof effect === 'function' ? effect(payload) : effect;

        const firefly = {
          effect: isEmptyEffect(built) ? undefined : built,
          originalPayload: payload,
          commit: { type: commit.type },
          rollback: { type: rollback.type },
        };

        const preparedMeta =
          typeof prepared.meta === 'object' && prepared.meta !== null ? prepared.meta : {};

        return {
          ...prepared,
          meta: { ...preparedMeta, ...extraMeta, firefly },
        };
      },
    };
  }

  const slice = createSlice({
    ...rest,
    name,
    reducers: caseReducers as unknown as ValidateSliceCaseReducers<State, CR>,
    extraReducers: (builder) => {
      for (const { type, handler } of handlers) {
        builder.addCase(type, handler);
      }

      if (typeof userExtraReducers === 'function') {
        userExtraReducers(builder);
      }
    },
  });

  const actions = slice.actions as Record<string, object>;
  for (const [key, keyMatchers] of Object.entries(matchers)) {
    Object.assign(actions[key], keyMatchers);
  }

  // Attach hydration metadata to the reducer if provided
  if (hydration) {
    withHydration(slice.reducer, hydration);
  }

  // Attach row-level direct-apply config to the reducer if provided
  if (applyRowsConfig) {
    attachApplyRows(slice.reducer, applyRowsConfig);
  }

  return slice as unknown as FireflySlice<State, CR, Name>;
}

/**
 * Adds a case for the commit of a firefly reducer — another slice's, or this
 * slice's own when the reducer has no `commit` handler. The handler gets the
 * payload the write was dispatched with and the effect's results.
 *
 * @example
 * extraReducers: (builder) => {
 *   onCommit(builder, addRoom, (state, { payload, results }) => {
 *     state.slots.push(...slotsOf(payload, results.room));
 *   });
 * },
 */
export function onCommit<State, P, R>(
  builder: ActionReducerMapBuilder<State>,
  creator: { commit: CommitMatcher<P, R> },
  handler: (state: Draft<State>, committed: FireflyCommitted<P, R>) => State | void
): void {
  builder.addCase(creator.commit.type, (state, action) => handler(state, creator.commit.unpack(action)));
}

/**
 * Adds a case for the rollback of a firefly reducer — another slice's, or this
 * slice's own when the reducer has no `rollback` handler. The handler gets the
 * payload the write was dispatched with and the error that failed it.
 *
 * @example
 * extraReducers: (builder) => {
 *   onRollback(builder, addRoom, (state, { payload, error }) => {
 *     state.failed.push({ id: payload.id, message: error.message });
 *   });
 * },
 */
export function onRollback<State, P>(
  builder: ActionReducerMapBuilder<State>,
  creator: { rollback: RollbackMatcher<P> },
  handler: (state: Draft<State>, rolledBack: FireflyRolledBack<P>) => State | void
): void {
  builder.addCase(creator.rollback.type, (state, action) => handler(state, creator.rollback.unpack(action)));
}

/**
 * Registers a listener reaction on the commit of a firefly write — the
 * listener-middleware twin of {@link onCommit}. The effect receives the
 * unpacked `{ payload, results }` and the listener API.
 *
 * @example
 * onWriteCommit(startListening, addRoom, ({ payload, results }, api) => {
 *   api.dispatch(syncRoom(results.room[0].id));
 * });
 */
export function onWriteCommit<State, DispatchType extends Dispatch, Extra, P, R>(
  startListening: TypedStartListening<State, DispatchType, Extra>,
  creator: { commit: CommitMatcher<P, R> },
  effect: (
    committed: FireflyCommitted<P, R>,
    api: ListenerEffectAPI<State, DispatchType, Extra>
  ) => void | Promise<void>
): UnsubscribeListener {
  return startListening({
    matcher: creator.commit.match,
    effect: (action, api) => effect(creator.commit.unpack(action), api),
  });
}

/**
 * Registers a listener reaction on the rollback of a firefly write — the
 * listener-middleware twin of {@link onRollback}. The effect receives the
 * unpacked `{ payload, error }` and the listener API.
 */
export function onWriteRollback<State, DispatchType extends Dispatch, Extra, P>(
  startListening: TypedStartListening<State, DispatchType, Extra>,
  creator: { rollback: RollbackMatcher<P> },
  effect: (
    rolledBack: FireflyRolledBack<P>,
    api: ListenerEffectAPI<State, DispatchType, Extra>
  ) => void | Promise<void>
): UnsubscribeListener {
  return startListening({
    matcher: creator.rollback.match,
    effect: (action, api) => effect(creator.rollback.unpack(action), api),
  });
}
