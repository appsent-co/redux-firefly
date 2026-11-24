# Redux-Firefly

Redux middleware for persisting state to SQLite in React Native. Redux-Firefly provides an easy and reactive API that uses Redux for global state and SQLite as storage.

## Features

- **Simple API**: Annotate actions with `meta.firefly` to persist to SQLite
- **Optimistic Updates**: Optional commit/rollback pattern for better UX
- **Transaction Support**: Execute multiple database operations atomically
- **Record Effects**: Name the statements of a write — they run in one transaction and the commit hands back each result under its name, typed per slot
- **Commit/Rollback Matchers**: Every toolkit action creator carries `.commit` and `.rollback` matchers, plus `onCommit` / `onRollback` for cross-slice reactions
- **Hydration**: Load initial state from SQLite on app startup
- **React Integration**: FireflyGate component delays rendering until hydration completes
- **TypeScript**: Full type safety with comprehensive TypeScript definitions
- **Redux Toolkit Integration**: `createFireflySlice` for colocated effect, commit, and rollback handlers
- **Drizzle ORM Support**: Use Drizzle query builders as effects — pass your drizzle database directly to `createReduxFirefly`
- **Driver Abstraction**: Bring your own SQLite client via the `FireflyDriver` interface
- **Custom Schema**: You control the database schema completely

> **Upgrading from 1.x?** 2.0 changes four behaviours. See [Migrating from 1.x](CHANGELOG.md#migrating-from-1x) in the changelog.

## Installation

```bash
npm install redux-firefly
# or
yarn add redux-firefly
```

**Required peer dependencies:**
```bash
npm install @reduxjs/toolkit react-redux expo-sqlite
```

**Optional — for Drizzle ORM support:**
```bash
npm install drizzle-orm
```

## Quick Start

### 1. Create the Firefly instance

```typescript
import { createReduxFirefly, expoSQLiteDriver } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('app.db');

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: expoSQLiteDriver(db),
  onError: (error, action) => console.error('[Firefly]', error.message, action.type),
  debug: __DEV__,
});
```

**With Drizzle ORM** — pass your drizzle instance directly, no driver wrapper needed:

```typescript
import { createReduxFirefly } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

const expoDb = SQLite.openDatabaseSync('app.db');
const db = drizzle(expoDb);

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: db,
  debug: __DEV__,
});
```

### 2. Configure the store

```typescript
import { configureStore } from '@reduxjs/toolkit';

const store = configureStore({
  reducer: enhanceReducer({
    todos: todosSlice.reducer,  // hydration config is auto-discovered
    user: userReducer,
  }),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActionPaths: ['meta.firefly'],
      },
    }).concat(middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
});

// Wait for hydration before rendering
await store.hydrated;
```

### 3. Define a slice with persistence

```typescript
import { createFireflySlice } from 'redux-firefly/toolkit';

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: [] as Todo[],
  hydration: {
    query: 'SELECT * FROM todos',
    transform: (rows) => rows.map(r => ({
      id: r.id, text: r.text, completed: Boolean(r.completed),
    })),
  },
  reducers: (fireflyReducer) => ({
    addTodo: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (text: string) => ({
        payload: { id: `temp_${Date.now()}`, text, completed: false },
      }),
      effect: (payload) => ({
        sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)',
        params: [payload.text, 0],
      }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.id = action.meta.firefly.result.lastInsertRowId;
      },
      rollback: (state, action) => {
        return state.filter(t => t.id !== action.payload.id);
      },
    }),
  }),
});

export const { addTodo } = todosSlice.actions;
export default todosSlice.reducer;
```

## API Reference

### `createReduxFirefly(config)`

Creates the Firefly middleware, reducer enhancer, and store enhancer.

**Parameters:**
- `database` (FireflyDriver | DrizzleDatabase): A database driver instance (e.g. `expoSQLiteDriver(db)`) or a Drizzle database instance (e.g. `drizzle(expoDb)`)
- `changes?` (FireflyChangeSource): A FireflyDB `FireflyClient` (or anything with its `subscribeToChanges`). Merged rows from its change events are applied to the matching `applyRows` slices — see [FireflyDB live updates](#fireflydb-live-updates-merged-rows)
- `onError?` (`(error: Error, action: FireflyAction) => void`): Optional error handler, called when a write fails. `action` is the action you dispatched, including any `meta` its `prepare` added (see [Passing `meta` Through `prepare`](#passing-meta-through-prepare))
- `debug?` (boolean): Enable debug logging
- `serializeEffects?` (boolean, default `true`): Run DB effects one at a time. Required for single-connection drivers; set `false` for pooled drivers, together with `transactionalSingleStatements: false`
- `transactionalSingleStatements?` (boolean, default `true`): Run a bare single drizzle query through `database.transaction`, like an array or a record, so it waits behind a transaction already open on the same database instead of running inside it. Set `false` to await the query directly as 1.x did; a database whose `transaction()` is synchronous and refuses an async callback (Drizzle's `better-sqlite3`) gets the direct await either way. **Set it to `false` for a pooled driver**: there the transaction and the query each take a connection, and concurrent writes can exhaust the pool and hang (see [Single Statements](#single-statements))

**Returns:** `{ middleware, enhanceReducer, enhanceStore }`

### `expoSQLiteDriver(db)`

Wraps an expo-sqlite database instance into a `FireflyDriver`. Compatible with expo-sqlite v14 and v15.

```typescript
import { expoSQLiteDriver } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';

const driver = expoSQLiteDriver(SQLite.openDatabaseSync('app.db'));
```

### `fireflyClientDriver(client)`

Adapts a FireflyDB `FireflyClient` to the `FireflyDriver` interface, so **raw-SQL** effects and hydration queries run on the client's CRDT-tracked connection — which is what makes the writes sync.

```typescript
import { createReduxFirefly, fireflyClientDriver } from 'redux-firefly';

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: fireflyClientDriver(client),
  changes: client, // live merged-row updates, same client
});
```

Notes:
- `runAsync` reports `{ lastInsertRowId: 0, changes: 0 }` — FireflyDB rows use app-generated ids (UUIDs / `firefly_uuid()`), so commit handlers must not rely on SQLite's last-insert-rowid.
- The client is a single connection: keep `serializeEffects` on (the default) so transactions can't overlap.
- **Drizzle effects bypass this driver** (a drizzle query carries its own db handle). To use drizzle with FireflyDB, build the drizzle instance over the client instead — see [Drizzle + FireflyDB](#drizzle--fireflydb).

### `FireflyDriver` Interface

Implement this interface to use a custom SQLite client:

```typescript
interface FireflyDriver {
  runAsync(sql: string, params?: any[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  withTransactionAsync(callback: () => Promise<void>): Promise<void>;
}
```

### `withHydration(reducer, config)`

Attaches hydration configuration to a reducer so it can be auto-discovered by `enhanceReducer`.

**Parameters:**
- `reducer` (Reducer): A Redux reducer
- `config` (HydrationQuery): `{ query, params?, transform? }`

**Returns:** The same reducer with hydration metadata attached

Use this when you're not using `createFireflySlice` (which handles hydration automatically via its `hydration` option).

### `applyRows(reducer, config)`

Attaches a row-level apply config to a reducer so `enhanceReducer` can apply FireflyDB merged rows into the slice — no SQL read. The live-update mirror of `withHydration`; the two compose (hydration for the initial load, applyRows for changes after that).

**Parameters:**
- `reducer` (Reducer): A Redux reducer
- `config` (ApplyRowsConfig): `{ table, apply }`
  - `table` (string): The table whose merged rows drive this slice (matched case-insensitively)
  - `apply` (`(state, { upserts, deletes }) => state`): Pure reducer over merged rows — `upserts` are live rows to insert/update, `deletes` are tombstones to remove

**Returns:** The same reducer with the apply config attached

Requires `changes` to be set on `createReduxFirefly`. Use the `applyRows` option of `createFireflySlice` instead when using the toolkit entry.

### `listApply(options)`

Builds an `apply` function for the common "slice holds a list of items" shape, so you don't hand-write the merge logic. Upserts replace the existing item with the same id in place (or append new items at the end); deletes remove items by id; if an id is both upserted and deleted in one batch, the upsert wins. Returns a new state object only when something changed, otherwise the original reference (no spurious re-renders).

**Parameters:**
- `toItem` (`(row: MergedRow) => Item`): Map a merged row to the item shape stored in state — decoded column values are in `row.columns`
- `getId` (`(item: Item) => string | number`): Stable id of an item already in state, used to match rows to items
- `rowId?` (`(row: MergedRow) => string | number`): Id derived from a merged row; defaults to the decoded primary key (`row.key`). Override when items are keyed by something other than the PK — must agree with `getId(toItem(row))`
- `listKey?` (string): The state property holding the array (e.g. `'items'`). Omit when the slice state **is** the array

**Returns:** An `apply` function to pass to `applyRows` (or the `applyRows` option of `createFireflySlice`)

```typescript
import { applyRows, listApply } from 'redux-firefly';

// State shape: { items: Todo[] }
const todosReducer = applyRows(todosSlice.reducer, {
  table: 'todos',
  apply: listApply<Todo>({
    toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
    getId: (todo) => todo.id,
    listKey: 'items',
  }),
});
```

For non-list state shapes (maps keyed by id, nested objects, aggregates), write the `apply` reducer by hand instead.

### `createFireflySlice(options)` (Toolkit)

Creates a Redux Toolkit slice with colocated Firefly effect, commit, and rollback handlers plus optional hydration. Import from `redux-firefly/toolkit`.

**Parameters:**
- `name` (string): Slice name
- `initialState` (State | () => State): Initial state
- `reducers` (`(fireflyReducer) => CaseReducers`): A callback that receives the `fireflyReducer` helper and returns case reducer definitions
- `hydration?` (HydrationQuery | DrizzleHydrationQuery): Hydration query config (equivalent to wrapping with `withHydration`). For Drizzle queries, `transform` receives fully typed rows inferred from the query. Supports a single query or an array of queries (see [Drizzle Hydration](#drizzle-hydration)).
- `applyRows?` (ApplyRowsConfig): Row-level apply config `{ table, apply }` (equivalent to wrapping with `applyRows`) — applies FireflyDB merged rows into the slice on change events (see [`listApply`](#listapplyoptions))
- `extraReducers?` (function): Standard RTK `extraReducers` builder callback

**Returns:** An RTK slice. Each action creator built with `fireflyReducer(...)` also carries `.commit` and `.rollback` matchers (see [Commit and Rollback Matchers](#commit-and-rollback-matchers)).

Each case reducer defined via `fireflyReducer(...)` takes:
- `effect`: The database operation — a single effect, an array of effects (transaction, positional results), or a record of named slots (transaction, results by name — see [Record Effects](#record-effects)). Pass it as a static value or as a function `(payload) => effect`
- `reducer?`: The Redux case reducer (called optimistically, before the database work). Omit it for a [commit-only write](#commit-only-writes)
- `prepare?`: Optional prepare callback for the action creator. Any `meta` it returns stays on the dispatched action (see [Passing `meta` Through `prepare`](#passing-meta-through-prepare))
- `commit?`: Called on database success — receives the commit action plus `results`: `(state, { payload, results })`. `payload` is the original payload, `results` is what the effect returned (also at `action.meta.firefly.result`)
- `rollback?`: Called on database failure — receives the rollback action plus `error`: `(state, { payload, error })`. `error` is always an `Error` (also at `action.meta.firefly.error`)

Write `effect` before `commit` in the definition: TypeScript types the commit's `results` from the effect, and it reads the properties in order. With `commit` first, `results` is `any`.

After every write that ran, the middleware dispatches a commit or a rollback action — whether or not the reducer defines a handler for it — using auto-generated action types: `{name}/{reducerKey}/commit` and `{name}/{reducerKey}/rollback`. You never have to spell those strings out: use the action creator's `.commit` and `.rollback` matchers. The one exception is an [empty write](#empty-writes), which dispatches neither.

**Example:**
```typescript
import { createFireflySlice } from 'redux-firefly/toolkit';
import type { FireflyCommitAction, FireflyRollbackAction } from 'redux-firefly/toolkit';

interface Todo {
  id: string | number;
  text: string;
  completed: boolean;
}

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: [] as Todo[],
  hydration: {
    query: 'SELECT * FROM todos',
    transform: (rows) => rows.map(r => ({
      id: r.id, text: r.text, completed: Boolean(r.completed),
    })),
  },
  reducers: (fireflyReducer) => ({
    // Simple reducer (no database effect)
    clearAll: () => [],

    // Fire-and-forget INSERT (no commit/rollback handlers)
    addTodoSimple: fireflyReducer({
      reducer: (state, action) => {
        state.push({ id: Date.now(), text: action.payload.text, completed: false });
      },
      prepare: (text: string) => ({ payload: { text } }),
      effect: (payload) => ({
        sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)',
        params: [payload.text, 0],
      }),
    }),

    // Optimistic INSERT with commit/rollback
    addTodo: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (text: string) => ({
        payload: { id: `temp_${Date.now()}`, text, completed: false } as Todo,
      }),
      effect: (payload) => ({
        sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)',
        params: [payload.text, 0],
      }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.id = action.meta.firefly.result.lastInsertRowId;
      },
      rollback: (state, action) => {
        return state.filter(t => t.id !== action.payload.id);
      },
    }),

    // Optimistic UPDATE
    toggleTodo: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.completed = !todo.completed;
      },
      prepare: (id: number, currentCompleted: boolean) => ({
        payload: { id, currentCompleted },
      }),
      effect: (payload) => ({
        sql: 'UPDATE todos SET completed = ? WHERE id = ?',
        params: [payload.currentCompleted ? 0 : 1, payload.id],
      }),
      rollback: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.completed = !todo.completed;
      },
    }),

    // Optimistic DELETE
    deleteTodo: fireflyReducer({
      reducer: (state, action) => {
        return state.filter(t => t.id !== action.payload.id);
      },
      prepare: (id: number, deletedTodo: Todo) => ({
        payload: { id, deletedTodo },
      }),
      effect: (payload) => ({
        sql: 'DELETE FROM todos WHERE id = ?',
        params: [payload.id],
      }),
      rollback: (state, action) => {
        state.push(action.payload.deletedTodo);
      },
    }),
  }),
});

export const { addTodo, addTodoSimple, toggleTodo, deleteTodo, clearAll } = todosSlice.actions;
export default todosSlice.reducer;
```

Since `hydration` is specified in the slice, store setup stays clean — no need to wrap with `withHydration` manually:

```typescript
const store = configureStore({
  reducer: enhanceReducer({
    todos: todosSlice.reducer, // hydration config is auto-discovered
  }),
  // ... middleware and enhancers
});
```

#### Typed Commit/Rollback Actions

A `commit` or `rollback` handler receives the dispatched action with one field added, so you can destructure what you need or keep reading the action:

```typescript
// Destructured
commit: (state, { payload, results }) => { /* ... */ },
rollback: (state, { payload, error }) => { /* ... */ },

// The same values, read off the action
commit: (state, action) => { /* action.payload, action.meta.firefly.result */ },
rollback: (state, action) => { /* action.payload, action.meta.firefly.error */ },
```

- **Commit** handlers get `results` — the same value as `action.meta.firefly.result`. Its type is inferred from the effect.
- **Rollback** handlers get `error` — the same value as `action.meta.firefly.error`, always an `Error`. The database is unchanged.
- Both get `payload` — the original action payload, forwarded automatically.

What `results` holds depends on the form of the effect:

| Effect | `results` |
| --- | --- |
| Single SQL effect | `{ lastInsertRowId, changes }` for a mutation, the rows array for a `SELECT` |
| Single Drizzle query | Whatever the query resolves to (rows for `select()` / `.returning()`, the driver's run result otherwise) |
| Array of effects | One `{ success, rows }` per statement, in array order |
| Record of named slots | An object with each slot's result under its name (see [Record Effects](#record-effects)) |

The dispatched actions are typed `FireflyCommitAction<Payload, Results>` and `FireflyRollbackAction<Payload>`; what a handler destructures is `FireflyCommitted<Payload, Results>` (`{ payload, results }`) and `FireflyRolledBack<Payload>` (`{ payload, error }`). All four are exported from `redux-firefly/toolkit`.

#### Commit and Rollback Matchers

For every reducer built with `fireflyReducer(...)`, the action creator carries two matchers, `.commit` and `.rollback`. They describe the actions the middleware dispatches when the write settles; they are not action creators, and you never dispatch them yourself.

```typescript
const { addTodo } = todosSlice.actions;

addTodo.commit.type;           // 'todos/addTodo/commit'
addTodo.commit.match(action);  // is this addTodo's commit?
addTodo.commit.unpack(action); // { payload, results }

addTodo.rollback.type;           // 'todos/addTodo/rollback'
addTodo.rollback.match(action);  // is this addTodo's rollback?
addTodo.rollback.unpack(action); // { payload, error } — error is always an Error
```

- `type` (string): The action type
- `match(action)`: Type guard — narrows `action` to the commit (or rollback) action. It works wherever Redux Toolkit takes a matcher, like the `match` of an RTK action creator
- `unpack(action)`: Returns `{ payload, results }` for a commit and `{ payload, error }` for a rollback, typed from the reducer's `prepare` and `effect`

Both actions are dispatched for every write that ran, including reducers that define no `commit` or `rollback` handler, so anything can react to a write settling. In listener middleware:

```typescript
import { createListenerMiddleware } from '@reduxjs/toolkit';
import { addTodo } from './todosSlice';

const listener = createListenerMiddleware();

listener.startListening({
  matcher: addTodo.commit.match,
  effect: (action) => {
    const { payload, results } = addTodo.commit.unpack(action);
    console.log('Todo saved', payload.id, results);
  },
});

listener.startListening({
  matcher: addTodo.rollback.match,
  effect: (action) => {
    const { payload, error } = addTodo.rollback.unpack(action);
    console.warn('Could not save todo', payload.id, error.message);
  },
});
```

The same guards fit `predicate: (action) => addTodo.commit.match(action)`, `builder.addMatcher(addTodo.commit.match, ...)` and `isAnyOf(addTodo.commit, deleteTodo.commit)`.

Plain reducers (the ones not built with `fireflyReducer`) have no `.commit` or `.rollback`.

#### `onCommit` and `onRollback`

To update one slice when another slice's write lands (or fails), use `onCommit` and `onRollback` in `extraReducers`. They take the builder, the action creator, and a handler that receives the unpacked action:

```typescript
import { createSlice } from '@reduxjs/toolkit';
import { onCommit, onRollback } from 'redux-firefly/toolkit';
import { addTodo, deleteTodo } from './todosSlice';

const statsSlice = createSlice({
  name: 'stats',
  initialState: { count: 0, lastSavedText: '', lastError: null as string | null },
  reducers: {},
  extraReducers: (builder) => {
    onCommit(builder, addTodo, (state, { payload }) => {
      state.count += 1;
      state.lastSavedText = payload.text;
    });
    onCommit(builder, deleteTodo, (state) => {
      state.count -= 1;
    });
    onRollback(builder, addTodo, (state, { error }) => {
      state.lastError = error.message;
    });
  },
});
```

- `onCommit(builder, creator, handler)`: `handler` is `(state, { payload, results }) => ...`
- `onRollback(builder, creator, handler)`: `handler` is `(state, { payload, error }) => ...`

Both work in any `extraReducers` — a plain `createSlice` or a `createFireflySlice`. They register a case with `builder.addCase`, so call them before any `builder.addMatcher` / `builder.addDefaultCase`, as RTK requires.

#### Commit-only Writes

`reducer` is optional. Leave it out when the state should change only once the write has landed — nothing is applied optimistically, so there is nothing to roll back:

```typescript
renameTodo: fireflyReducer({
  prepare: (id: number, text: string) => ({ payload: { id, text } }),
  // No `reducer`: the dispatched action changes nothing by itself.
  effect: (payload) => ({
    sql: 'UPDATE todos SET text = ? WHERE id = ?',
    params: [payload.text, payload.id],
  }),
  commit: (state, { payload }) => {
    const todo = state.find(t => t.id === payload.id);
    if (todo) todo.text = payload.text;
  },
}),
```

Without a `prepare` either, the action creator takes the payload itself; annotate it on the effect's parameter (`effect: (payload: { id: number; text: string }) => ...`) to type it.

#### Passing `meta` Through `prepare`

Whatever `meta` your `prepare` returns stays on the dispatched action, next to `meta.firefly`. Reducers and middleware see it, and so does `onError(error, action)`, which receives that same action. That makes `meta` the place for per-write data your error handler needs — for example the message to show when the write fails:

```typescript
// todosSlice.ts
deleteTodo: fireflyReducer({
  prepare: (id: number) => ({
    payload: { id },
    meta: {
      failure: { title: 'Could not delete', message: 'The todo is still there. Please try again.' },
    },
  }),
  effect: (payload) => ({ sql: 'DELETE FROM todos WHERE id = ?', params: [payload.id] }),
  commit: (state, { payload }) => state.filter(t => t.id !== payload.id),
}),
```

```typescript
// store.ts
const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: expoSQLiteDriver(db),
  onError: (error, action) => {
    console.error('[Firefly]', error.message, action.type);
    const failure = action.meta.failure;
    if (failure) Alert.alert(failure.title, failure.message);
  },
});
```

`meta.firefly` is reserved for Redux-Firefly; every other key is yours. The commit and rollback actions do not carry your `meta` — they have `payload` and `meta.firefly.result` / `meta.firefly.error` only — so put anything a commit or rollback handler needs in the payload.

#### Wrapping `createFireflySlice`

Because `reducers` is a callback that receives `fireflyReducer`, an app can put its own conventions in a thin wrapper around `createFireflySlice`: wrap that helper, and add to what every reducer's `prepare` returns. Here each reducer may declare `failure` copy, which the wrapper puts on the action as `meta.failure` for `onError` to read:

```typescript
import type { SliceCaseReducers } from '@reduxjs/toolkit';
import { createFireflySlice } from 'redux-firefly/toolkit';
import type {
  CreateFireflySliceOptions,
  DrizzleHydrationQuery,
  DrizzleQuery,
  FireflyReducerFactory,
  FireflySlice,
  FireflySliceHydration,
  HydrationQuery,
} from 'redux-firefly/toolkit';

/** What this app's `fireflyReducer` accepts on top of the library's. */
interface WithFailure {
  failure?: { title: string; message: string };
}

function withFailure<State>(
  fireflyReducer: FireflyReducerFactory<State>
): FireflyReducerFactory<State, WithFailure> {
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

type AppSliceOptions<State, CR extends SliceCaseReducers<State>, Name extends string> =
  CreateFireflySliceOptions<State, CR, Name, WithFailure>;

// The two `hydration` overloads of createFireflySlice, so that callers keep a
// typed `transform`; the implementation forwards either kind.
export function createAppSlice<
  State,
  Name extends string,
  CR extends SliceCaseReducers<State>,
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
>(
  options: AppSliceOptions<State, CR, Name> & { hydration: DrizzleHydrationQuery<Q, State> }
): FireflySlice<State, CR, Name>;
export function createAppSlice<State, Name extends string, CR extends SliceCaseReducers<State>>(
  options: AppSliceOptions<State, CR, Name> & { hydration?: HydrationQuery }
): FireflySlice<State, CR, Name>;
export function createAppSlice<State, Name extends string, CR extends SliceCaseReducers<State>>(
  options: AppSliceOptions<State, CR, Name> & { hydration?: FireflySliceHydration<State> }
): FireflySlice<State, CR, Name> {
  const { reducers, ...rest } = options;
  return createFireflySlice({
    ...rest,
    reducers: (fireflyReducer) => reducers(withFailure(fireflyReducer)),
  });
}
```

Slices written with `createAppSlice` look the same as before, plus `failure: { ... }` on a reducer. Everything else passes through with its types: `hydration`, `applyRows`, the action creators, their `.commit` / `.rollback` matchers and the per-slot results.

- `FireflyReducerFactory<State, Extra>` is the type of the `fireflyReducer` helper; `Extra` names the fields your wrapper accepts on top of the library's.
- `CreateFireflySliceOptions<State, CR, Name, Extra>` is the options object without `hydration`, which each overload types.
- `FireflySliceHydration<State>` is either kind of hydration. It is for the implementation signature only: `createFireflySlice` has a third overload that accepts it, so the wrapper can forward its options without a cast. Its Drizzle `transform` takes `unknown` rows, so a `hydration` written in place with an annotated `transform` is still checked against its query by the typed overloads.
- `prepare`'s declared return type is `{ payload }`: a `meta` it returns is kept at runtime but is not part of the type, which is why the wrapper above widens `prepared` before reading `prepared.meta`.

### SQL Effects

Plain SQL effects are simple objects with `sql` and optional `params`:

```typescript
{
  sql: string,
  params?: any[]
}
```

The driver automatically detects SELECT queries (returns rows) vs mutations (returns `{ lastInsertRowId, changes }`). Examples:

```typescript
// INSERT
{ sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)', params: [text, 0] }

// UPDATE
{ sql: 'UPDATE todos SET completed = ? WHERE id = ?', params: [1, todoId] }

// DELETE
{ sql: 'DELETE FROM todos WHERE id = ?', params: [todoId] }

// SELECT (result available in commit handler)
{ sql: 'SELECT * FROM todos WHERE completed = ?', params: [1] }
```

### Record Effects

A record effect names its statements. Instead of an array whose results you read by position, return an object whose keys you choose — the commit hands the results back under the same keys. Shown here with [Drizzle](#drizzle-orm) queries:

```typescript
addTodoWithTags: fireflyReducer({
  prepare: (text: string, tagIds: number[], categoryId?: number) => ({
    payload: { id: Crypto.randomUUID(), text, tagIds, categoryId },
  }),
  effect: (payload) => ({
    // One statement
    todo: db.insert(todos).values({ id: payload.id, text: payload.text }).returning(),
    // A list of statements (may be empty)
    tags: payload.tagIds.map((tagId) =>
      db.insert(todoTags).values({ todoId: payload.id, tagId })
    ),
    // Skipped when the todo has no category
    category: payload.categoryId !== undefined &&
      db.update(categories)
        .set({ updatedAt: Date.now() })
        .where(eq(categories.id, payload.categoryId))
        .returning({ id: categories.id }),
  }),
  commit: (state, { payload, results }) => {
    const [row] = results.todo; // the rows from .returning()
    state.push({ id: row.id, text: row.text, completed: row.completed });

    results.tags;     // one result per insert, [] when tagIds was empty
    results.category; // { id: number }[] | undefined
  },
}),
```

Each key is a **slot**. What a slot holds decides what the commit returns for it:

| Slot value | `results.<name>` |
| --- | --- |
| One statement | That statement's result |
| A list of statements | An array with one result per statement, in list order — `[]` when the list is empty |
| `undefined`, `null`, `false`, or any other falsy value (`0`, `''`) | `undefined` |

A statement is a Drizzle query or an SQL effect (`{ sql, params }`). A falsy slot is skipped, so a guard can be any condition: `payload.removeOld && query`, `payload.ids.length && query`, `payload.name && query`.

- **One transaction.** Every statement of the record runs in a single transaction — `database.transaction` for Drizzle queries, the driver's `withTransactionAsync` for SQL effects — also when the record holds just one statement. If a statement fails, the whole write fails: a rollback is dispatched, `onError` is called, and no partial results are committed.
- **Record order.** Statements run in slot order, then in the order inside a list slot. Slot order is JavaScript's property order, so integer-like names (`'0'`, `'1'`) run first, in ascending order, however you wrote them. Use descriptive names.
- **One kind of statement.** A record holds Drizzle queries or SQL effects, not both — they cannot share a transaction. A mixed record fails before anything runs.
- **Typed results.** With Drizzle queries, `results` is typed slot by slot from the queries: a single slot gives the query's result, a list slot an array of them, and `condition && query` gives `Result | undefined`, whether the condition is a boolean, a number or a string. SQL effects are typed as loosely as they are in the single form: a slot is typed as a mutation result (`{ lastInsertRowId, changes }`) even when it is a `SELECT`, and a record with an inline `{ sql, params }` slot has `any` results.
- **Checked slots.** In `fireflyReducer`, a slot that is not a statement, a list of statements or a falsy value does not compile: a Promise (`await`ed or `.run()` query), a query builder that was not called, a list with a skipped entry (`[cond && query]` — skip the whole slot instead). The error is on `effect` and names the slot: `... is not assignable to type 'FireflyInvalidEffectSlot<"deleted">'`. In a plain action, such a record fails when it runs, before any statement does.
- **No slot named `sql`.** An object with a `sql` key is always read as an [SQL effect](#sql-effects), so `sql` cannot be a slot name.
- **Nothing to run.** A record whose slots are all skipped or empty lists is an [empty write](#empty-writes).

Records work everywhere an effect does: as a static value, as a function of the payload, and in [plain actions](#plain-actions-without-toolkit), where the named results arrive as `action.meta.firefly.result`.

### Empty Writes

An effect with nothing to run is a no-op. That is any of:

- `[]`
- `{}`
- a record whose slots are all skipped (`undefined` / `null` / `false`, or another falsy value) or empty lists
- `undefined` or `null`

The dispatched action still reaches the reducers, so an optimistic `reducer` runs as usual. After that nothing happens: no database work, no commit, no rollback, and `onError` is not called. You can build an effect from your data without guarding against the empty case:

```typescript
tagTodos: fireflyReducer({
  prepare: (todoIds: number[], tagId: number) => ({ payload: { todoIds, tagId } }),
  // No todos selected: nothing runs and nothing is dispatched.
  effect: (payload) =>
    payload.todoIds.map((todoId) => db.insert(todoTags).values({ todoId, tagId: payload.tagId })),
  commit: (state, { payload }) => { /* ... */ },
}),
```

Notes:
- No commit or rollback follows an empty write, so do not have the optimistic `reducer` mark state as pending when there is nothing to write — no handler will run to clear it.
- Arrays are positional: only a zero-length array is empty, and entries are not filtered. For statements that are sometimes skipped, use a [record](#record-effects).
- `isEmptyEffect(effect)`, exported from `redux-firefly`, is the check the middleware uses.
- Only these forms are empty. A value that is not an effect at all is not: a Promise (an `async` effect function, or a query that was awaited or run), a `Date`, an `{ sql }` object whose `sql` is not a string. Such a write fails like any other — rollback and `onError` — with an error that says what it was given. `fireflyReducer` rejects an effect that returns a Promise at compile time.
- A `createFireflySlice` write with an empty effect is dispatched with `meta.firefly.effect` set to `undefined`, so `isFireflyAction(action)` is `false` for it.

## Drizzle ORM

Redux-Firefly has first-class support for [Drizzle ORM](https://orm.drizzle.team/). You can use Drizzle query builders directly as effects instead of plain effect objects — no wrapping or adapters needed.

> **Note:** `drizzle-orm` is an optional peer dependency. Redux-Firefly uses structural typing internally, so the core bundle never imports Drizzle.

### Setup

Pass your Drizzle database instance directly to `createReduxFirefly`:

```typescript
import { createReduxFirefly } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

const expoDb = SQLite.openDatabaseSync('app.db');
const db = drizzle(expoDb);

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: db, // no driver wrapper needed
});
```

### Drizzle Effects

Use Drizzle query builders anywhere you'd normally pass an effect object:

```typescript
import { eq } from 'drizzle-orm';
import { todos } from './tables';

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: [] as Todo[],
  reducers: (fireflyReducer) => ({
    // INSERT
    addTodo: fireflyReducer({
      reducer: (state, action) => { state.push(action.payload); },
      prepare: (text: string) => ({
        payload: { id: `temp_${Date.now()}`, text, completed: false } as Todo,
      }),
      effect: (payload) => db.insert(todos).values({ text: payload.text, completed: false }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.syncing = false;
      },
      rollback: (state, action) => state.filter(t => t.id !== action.payload.id),
    }),

    // UPDATE
    toggleTodo: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.completed = !todo.completed;
      },
      prepare: (id: number, currentCompleted: boolean) => ({
        payload: { id, currentCompleted },
      }),
      effect: (payload) =>
        db.update(todos)
          .set({ completed: !payload.currentCompleted })
          .where(eq(todos.id, payload.id)),
    }),

    // DELETE
    deleteTodo: fireflyReducer({
      reducer: (state, action) => state.filter(t => t.id !== action.payload.id),
      prepare: (id: number) => ({ payload: { id } }),
      effect: (payload) => db.delete(todos).where(eq(todos.id, payload.id)),
    }),

    // Static drizzle effect (no payload dependency)
    deleteCompleted: fireflyReducer({
      reducer: (state) => state.filter(t => !t.completed),
      effect: db.delete(todos).where(eq(todos.completed, true)),
    }),
  }),
});
```

### Drizzle Hydration

Pass a Drizzle query as the `query` property in your hydration config. The `transform` callback receives **fully typed rows** inferred from your query — no manual type annotations needed:

```typescript
import { eq, asc, desc } from 'drizzle-orm';
import { todos, categories } from './tables';

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: [] as Todo[],
  hydration: {
    query: db.select({
      id: todos.id,
      text: todos.text,
      completed: todos.completed,
      categoryName: categories.name,
    })
      .from(todos)
      .leftJoin(categories, eq(todos.categoryId, categories.id))
      .orderBy(asc(todos.completed), desc(todos.createdAt)),
    // rows is automatically typed as { id: number; text: string; completed: boolean; categoryName: string | null }[]
    transform: (rows) => rows.map(row => ({
      id: row.id,
      text: row.text,
      completed: row.completed,
      category: row.categoryName ?? null,
    })),
  },
  reducers: (fireflyReducer) => ({ /* ... */ }),
});
```

#### Multiple Hydration Queries

Pass an array of Drizzle queries to hydrate from multiple tables. The `transform` callback receives a typed tuple of `OperationResult` objects, one per query:

```typescript
import { asc } from 'drizzle-orm';
import { todos, categories } from './tables';

const appSlice = createFireflySlice({
  name: 'app',
  initialState: { todos: [], categories: [] } as AppState,
  hydration: {
    query: [
      db.select().from(todos).orderBy(asc(todos.createdAt)),
      db.select().from(categories).orderBy(asc(categories.name)),
    ],
    // results is typed as [OperationResult<Todo[]>, OperationResult<Category[]>]
    transform: (results) => ({
      todos: results[0].rows ?? [],
      categories: results[1].rows ?? [],
    }),
  },
  reducers: (fireflyReducer) => ({ /* ... */ }),
});
```

### Drizzle Transactions

Return an array of Drizzle queries to execute them in a single transaction:

```typescript
addTodoWithTags: fireflyReducer({
  reducer: (state, action) => { state.push(action.payload); },
  prepare: (text: string, tagIds: number[]) => ({
    payload: { id: `temp_${Date.now()}`, text, tagIds, completed: false } as Todo & { tagIds: number[] },
  }),
  effect: (payload) => [
    db.insert(todos).values({ text: payload.text, completed: false }),
    ...payload.tagIds.map(tagId =>
      db.insert(todoTags).values({ todoId: sql`last_insert_rowid()`, tagId })
    ),
  ],
}),
```

An array's results are positional: the commit gets one `{ success, rows }` per query, in array order. To read results by name instead — or to skip some statements conditionally — return a record of named queries; it runs in one transaction the same way. See [Record Effects](#record-effects).

> **What "one transaction" means.** For Drizzle effects, Redux-Firefly only ever calls `database.transaction(callback)` and awaits each statement inside the callback — it never issues `BEGIN` / `COMMIT` itself. The statements are atomic when your database's `transaction()` waits for an async callback, as Drizzle's async drivers do (for example `sqlite-proxy`, used in [Drizzle + FireflyDB](#drizzle--fireflydb)). Drizzle's synchronous `expo-sqlite` driver commits as soon as the callback returns its promise, before the awaited statements have run: the write still completes and commits its results, but the statements are not wrapped by that transaction. The same goes for a `transaction()` that does not wait for its callback at all (Drizzle's `durable-sqlite` driver returns before the statements run): Redux-Firefly waits for the statements themselves, then commits their results or rolls back with the error of the one that failed. This holds for arrays, records and single statements alike.
>
> **A `transaction()` that refuses an async callback.** Drizzle's `better-sqlite3` driver goes one step further: its `transaction()` throws (`Transaction function cannot return a promise`) instead of committing early. There, no transaction can hold the statements, so an array or a record effect rolls back without running any of them, with an error that says so, and a single query is awaited directly (see [Single Statements](#single-statements)). To write several statements atomically on such a driver, configure a `database` whose `transaction()` waits for an async callback.

### Single Statements

A single Drizzle query takes the same route as an array or a record: Redux-Firefly calls `database.transaction(callback)` and awaits the query inside the callback. On a database that queues its transactions, a single-statement write therefore waits behind a transaction that is already open instead of running inside it. The commit result is unchanged — it is the query's own result.

To await single queries directly instead, as 1.x did, turn the option off:

```typescript
const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: db,
  transactionalSingleStatements: false,
});
```

> **Pooled drivers must turn it off.** With a connection pool (for example `node-postgres`), `database.transaction` holds one connection for as long as its callback runs, and the query — which was built on `database`, not on the transaction — takes a second one to run. Every single-statement write then needs two connections at once, and the statement does not even run inside that transaction. With `serializeEffects: false`, as many concurrent writes as the pool has connections hold all of them while each waits for one more: they wait forever (no commit, no rollback, no `onError`) unless the pool has an acquire timeout. Configure a pooled database with both options off:
>
> ```typescript
> createReduxFirefly({
>   database: db,
>   serializeEffects: false,
>   transactionalSingleStatements: false,
> });
> ```
>
> Arrays and records had this cost in 1.x already, and still do: on a pooled driver their statements run on other connections than the transaction's.

Notes:
- The option covers the bare single-query form only. Arrays and records always use a transaction.
- If the configured `database` has no `transaction` function (a `FireflyDriver`), a single Drizzle query is awaited directly.
- If `database.transaction` is synchronous and refuses an async callback (Drizzle's `better-sqlite3` driver throws `Transaction function cannot return a promise`), a single Drizzle query is awaited directly too, as 1.x did. Each write then costs one refused `BEGIN` / `ROLLBACK`; set `transactionalSingleStatements: false` to skip it.
- A single SQL effect is not affected: it runs through the driver's `runAsync` / `getAllAsync`, without a transaction.
- The outcome of the write is the callback's, not `transaction()`'s. If `database.transaction` resolves, or returns, before its callback has finished, the statement is running on its own: Redux-Firefly waits for it, and commits its result or rolls back with its error, as 1.x did. If it resolves although its callback was never called, the statement did not run: the write rolls back.

### SELECT Queries with Drizzle

Use Drizzle `select()` as an effect to run queries and handle results in the `commit` handler:

```typescript
searchTodos: fireflyReducer({
  reducer: () => { /* no-op */ },
  prepare: (searchText: string) => ({ payload: { searchText } }),
  effect: (payload) =>
    db.select({ id: todos.id, text: todos.text, completed: todos.completed })
      .from(todos)
      .where(like(todos.text, `%${payload.searchText}%`)),
  // `results` is the query's rows, typed from the select
  commit: (_state, { results }) =>
    results.map((row) => ({
      id: row.id, text: row.text, completed: row.completed,
    })),
}),
```

## Advanced Usage

### Transactions

Execute multiple operations atomically by returning an array of effects:

```typescript
moveTodoToCategory: fireflyReducer({
  reducer: (state, action) => {
    const todo = state.find(t => t.id === action.payload.todoId);
    if (todo) todo.categoryId = action.payload.categoryId;
  },
  prepare: (todoId: number, categoryId: number) => ({
    payload: { todoId, categoryId },
  }),
  effect: (payload) => [
    {
      sql: 'UPDATE todos SET category_id = ? WHERE id = ?',
      params: [payload.categoryId, payload.todoId],
    },
    {
      sql: 'UPDATE categories SET updated_at = ? WHERE id = ?',
      params: [Math.floor(Date.now() / 1000), payload.categoryId],
    },
  ],
  commit: (state, action) => {
    const todo = state.find(t => t.id === action.payload.todoId);
    if (todo) todo.syncing = false;
  },
  rollback: (state, action) => {
    const todo = state.find(t => t.id === action.payload.todoId);
    if (todo) todo.error = 'Failed to move category';
  },
}),
```

For an array effect, `results` (`action.meta.firefly.result`) is an array with one `OperationResult` (`{ success, rows }`) per statement, in array order. To get the results by name instead, return a record of named statements — see [Record Effects](#record-effects):

```typescript
effect: (payload) => ({
  todo: {
    sql: 'UPDATE todos SET category_id = ? WHERE id = ?',
    params: [payload.categoryId, payload.todoId],
  },
  category: {
    sql: 'UPDATE categories SET updated_at = ? WHERE id = ?',
    params: [Math.floor(Date.now() / 1000), payload.categoryId],
  },
}),
commit: (state, { payload, results }) => {
  // results.todo and results.category are each { lastInsertRowId, changes }
},
```

### Static Effects

When the effect doesn't depend on the payload, pass a static object instead of a function:

```typescript
deleteCompletedTodos: fireflyReducer({
  reducer: (state) => state.filter(t => !t.completed),
  effect: {
    sql: 'DELETE FROM todos WHERE completed = 1',
  },
}),
```

### Plain Actions (without Toolkit)

You can also dispatch plain Redux actions with `meta.firefly` — no toolkit required:

```typescript
export const archiveOldTodos = () => ({
  type: 'ARCHIVE_OLD_TODOS',
  meta: {
    firefly: {
      effect: {
        sql: 'UPDATE todos SET archived = 1 WHERE created_at < ?',
        params: [Date.now() - 30 * 86400000],
      },
      commit: { type: 'ARCHIVE_OLD_TODOS_COMMIT' },
      rollback: { type: 'ARCHIVE_OLD_TODOS_ROLLBACK' },
    },
  },
});
```

`commit` and `rollback` are optional here: a hand-written action dispatches only the ones it declares. The commit action is `{ type, payload, meta: { firefly: { result } } }` and the rollback action `{ type, payload, meta: { firefly: { error } } }`, where `payload` is `meta.firefly.originalPayload` if you set it. `effect` takes every form `createFireflySlice` does — a single effect, an array, or a [record](#record-effects) — and [empty writes](#empty-writes) are skipped the same way.

## React Integration

### FireflyGate

Delays rendering your app until hydration completes, similar to redux-persist's PersistGate.

```tsx
import { FireflyGate } from 'redux-firefly/react';

<Provider store={store}>
  <FireflyGate loading={<LoadingScreen />}>
    <App />
  </FireflyGate>
</Provider>
```

**Props:**
- `loading?` (ReactNode): Component to show while hydrating
- `children` (ReactNode): App to render after hydration
- `onBeforeHydrate?` (function): Callback invoked before hydration
- `context?` (React.Context): Custom react-redux context for multi-store setups

Alternatively, you can skip `FireflyGate` entirely and await the hydration promise:

```typescript
await store.hydrated;
```

### Store Hydration API

The enhanced store exposes these hydration helpers:

```typescript
store.hydrated              // Promise<void> — resolves when hydration completes
store.isHydrated()          // boolean — synchronous check
store.onHydrationChange(cb) // subscribe to hydration status changes; returns unsubscribe fn
store.refreshAll()          // re-run hydration for every slice (manual escape hatch)
store.dispose()             // tear down the change subscription
```

## FireflyDB live updates (merged rows)

Redux-Firefly persists to a local SQLite database. When that database is a
[FireflyDB](https://github.com/fireflydb/fireflydb) CRDT connection, every remote
change event carries the **merged rows** — the post-merge value of every changed
column. Redux-Firefly applies those rows straight into your slices: **no SQL
read, no re-hydration**. Hydration runs once at launch; after that, live updates
flow exclusively through the change callback.

Pass the `FireflyClient` as `changes` and bind each slice to its table with
`applyRows`:

```typescript
import { createReduxFirefly, withHydration, applyRows, listApply } from 'redux-firefly';

const todosReducer = applyRows(
  withHydration(todosSlice.reducer, { query: 'SELECT * FROM todos', /* … */ }),
  {
    table: 'todos',
    apply: listApply<Todo>({
      toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
      getId: (todo) => todo.id,
      listKey: 'items', // omit when the slice state *is* the array
    }),
  },
);

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: db, // drizzle over the FireflyClient connection
  changes: client,
});
```

`apply` is a plain reducer over rows: `(state, { upserts, deletes }) => nextState`.
`listApply` is a convenience builder for the common "slice holds a list of items"
shape: it **upserts** each row by id (replace existing / append new) and
**removes** deleted rows by id. `rowId` defaults to the decoded `row.key`; for
non-list shapes write your own `apply`.

With `createFireflySlice`, pass `applyRows` as an option instead of wrapping:

```typescript
const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: { items: [] as Todo[] },
  reducers: (firefly) => ({ /* … */ }),
  hydration: { query: 'SELECT * FROM todos', transform: (rows) => ({ items: rows }) },
  applyRows: {
    table: 'todos',
    apply: listApply<Todo>({
      toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
      getId: (todo) => todo.id,
      listKey: 'items',
    }),
  },
});
```

Notes:

- Merged rows are bucketed by table and applied to the matching `applyRows`
  slices in one synchronous `@@firefly/APPLY_ROWS` dispatch. Tables without an
  `applyRows` slice are ignored.
- Rows arriving **during** the initial hydration are buffered and applied right
  after it, so nothing is missed (applies are idempotent — upserts replace by
  id).
- Local writes are already reflected by the optimistic reducer + commit; only
  remote change events carry merged rows.
- Anything that bypasses the change listener (e.g. an explicit `client.sync()`
  pull) can be reconciled manually with `store.refreshAll()`.

### Running effects on the FireflyDB connection

Every write must run on the client's **CRDT-tracked connection** — a write that
goes around it never syncs. For **raw-SQL** effects, wrap the client with
[`fireflyClientDriver`](#fireflyclientdriverclient):

```typescript
import { createReduxFirefly, fireflyClientDriver } from 'redux-firefly';

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: fireflyClientDriver(client),
  changes: client,
});
```

For drizzle effects, see the next section — they bypass the driver.

### Drizzle + FireflyDB

A drizzle effect carries its own db handle: its statements run on the drizzle
instance that built them, so they bypass whatever `database` driver you
configured (Redux-Firefly only calls `database.transaction` around them, when
the configured database has one). To run drizzle on the
tracked connection, build the drizzle instance **over the client itself** with
drizzle's `sqlite-proxy` driver, forwarding to `client.exec` / `client.query`:

```typescript
// db.ts
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { FireflyClient } from '@fireflydb/expo'; // or @fireflydb/op-sqlite
import * as schema from './schema';

export function makeDb(client: FireflyClient) {
  return drizzle(
    async (sql, params, method) => {
      if (method === 'run') {
        await client.exec(sql, params);
        return { rows: [] };
      }
      // drizzle expects each row as an array of values in SELECT column order.
      // drizzle always generates explicit column lists, so object key order matches.
      const rows = await client.query<Record<string, unknown>>(sql, params);
      const values = rows.map((row) => Object.values(row));
      return method === 'get' ? { rows: values[0] ?? [] } : { rows: values };
    },
    { schema },
  );
}
```

Wire it all up — the proxy db as `database` (drizzle effects + hydration run
tracked), the client as `changes` (remote merged rows flow into `applyRows`
slices):

```typescript
import { createFireflyClient } from '@fireflydb/expo';
import { createReduxFirefly } from 'redux-firefly';
import { makeDb } from './db';

const client = createFireflyClient({ /* relayUrl, databaseID, token, … */ });
await client.init();
await client.open();

const db = makeDb(client);

const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
  database: db,
  changes: client,
});
```

A slice then combines all three Firefly features — drizzle hydration for the
initial load, a drizzle effect for writes, and `applyRows` for live updates:

```typescript
import { createFireflySlice, listApply } from 'redux-firefly/toolkit';
import { fireflyHydration } from 'redux-firefly';
import { todos } from './schema';

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: { items: [] as Todo[] },
  // Lazy query factory: `db` is created after the async client init,
  // so don't build the query at module load.
  hydration: fireflyHydration(
    () => db.select().from(todos),
    (rows) => ({ items: rows }),
  ),
  applyRows: {
    table: 'todos',
    apply: listApply<Todo>({
      toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
      getId: (todo) => todo.id,
      listKey: 'items',
    }),
  },
  reducers: (firefly) => ({
    addTodo: firefly({
      reducer: (state, action) => { state.items.push(action.payload); },
      prepare: (text: string) => ({ payload: { id: Crypto.randomUUID(), text } }),
      effect: (todo) => db.insert(todos).values(todo),
    }),
  }),
});
```

Notes:

- **Generate row ids in the app** (UUIDs / `firefly_uuid()`). CRDT rows need ids
  that are stable across devices — never rely on `AUTOINCREMENT` or
  last-insert-rowid.
- **Transactions work through the proxy**: drizzle's `db.transaction` — and so
  array effects, [record effects](#record-effects) and
  [single statements](#single-statements) — forward `BEGIN`/`COMMIT`/`ROLLBACK`
  through `client.exec`. The client is a single connection, so keep
  `serializeEffects` on (the default) to prevent overlapping transactions.
- The full loop: dispatch → optimistic reducer → drizzle effect writes through
  the client (tracked, syncs to the relay) → commit action. Other devices
  receive the change as merged rows → their `applyRows` slices update — and
  yours do the same for their writes.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
