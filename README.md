# Redux-Firefly

Redux middleware for persisting state to SQLite in React Native. Redux-Firefly provides an easy and reactive API that uses Redux for global state and SQLite as storage.

## Features

- **Simple API**: Annotate actions with `meta.firefly` to persist to SQLite
- **Optimistic Updates**: Optional commit/rollback pattern for better UX
- **Transaction Support**: Execute multiple database operations atomically
- **Hydration**: Load initial state from SQLite on app startup
- **React Integration**: FireflyGate component delays rendering until hydration completes
- **TypeScript**: Full type safety with comprehensive TypeScript definitions
- **Redux Toolkit Integration**: `createFireflySlice` for colocated effect, commit, and rollback handlers
- **Drizzle ORM Support**: Use Drizzle query builders as effects — pass your drizzle database directly to `createFirefly`
- **Driver Abstraction**: Bring your own SQLite client via the `FireflyDriver` interface
- **Custom Schema**: You control the database schema completely

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
import { createFirefly, expoSQLiteDriver } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('app.db');

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: expoSQLiteDriver(db),
  onError: (error, action) => console.error('[Firefly]', error.message, action.type),
  debug: __DEV__,
});
```

**With Drizzle ORM** — pass your drizzle instance directly, no driver wrapper needed:

```typescript
import { createFirefly } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

const expoDb = SQLite.openDatabaseSync('app.db');
const db = drizzle(expoDb);

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
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

### `createFirefly(config)`

Creates the Firefly middleware, reducer enhancer, and store enhancer.

**Parameters:**
- `database` (FireflyDriver | DrizzleDatabase): A database driver instance (e.g. `expoSQLiteDriver(db)`) or a Drizzle database instance (e.g. `drizzle(expoDb)`)
- `changes?` (FireflyChangeSource): A FireflyDB `FireflyClient` (or anything with its `subscribeToChanges`). Merged rows from its change events are applied to the matching `applyRows` slices — see [FireflyDB live updates](#fireflydb-live-updates-merged-rows)
- `onError?` (`(error: Error, action: FireflyAction) => void`): Optional error handler
- `debug?` (boolean): Enable debug logging
- `serializeEffects?` (boolean, default `true`): Run DB effects one at a time. Required for single-connection drivers; set `false` for pooled drivers

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
import { createFirefly, fireflyClientDriver } from 'redux-firefly';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
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

Requires `changes` to be set on `createFirefly`. Use the `applyRows` option of `createFireflySlice` instead when using the toolkit entry.

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

Each case reducer defined via `fireflyReducer(...)` takes:
- `reducer`: The Redux case reducer (called optimistically)
- `effect`: The database operation — a static effect object, array (transaction), or function `(payload) => effect`
- `prepare?`: Optional prepare callback for the action creator
- `commit?`: Called on database success — receives `action.payload` (the original payload) and `action.meta.firefly.result`
- `rollback?`: Called on database failure — receives `action.payload` and `action.meta.firefly.error`

Commit/rollback handlers are dispatched automatically by the middleware using auto-generated action types: `{name}/{reducerKey}/commit` and `{name}/{reducerKey}/rollback`.

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

    // Fire-and-forget INSERT (no commit/rollback)
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

Import `FireflyCommitAction` and `FireflyRollbackAction` from `redux-firefly/toolkit` for type-safe handlers:

- **Commit** actions include `action.meta.firefly.result` (`OperationResult`) with `insertId`, `rowsAffected`, `rows`, etc.
- **Rollback** actions include `action.meta.firefly.error` (`Error`)
- Both receive `action.payload` — the original action payload, forwarded automatically.

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

## Drizzle ORM

Redux-Firefly has first-class support for [Drizzle ORM](https://orm.drizzle.team/). You can use Drizzle query builders directly as effects instead of plain effect objects — no wrapping or adapters needed.

> **Note:** `drizzle-orm` is an optional peer dependency. Redux-Firefly uses structural typing internally, so the core bundle never imports Drizzle.

### Setup

Pass your Drizzle database instance directly to `createFirefly`:

```typescript
import { createFirefly } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

const expoDb = SQLite.openDatabaseSync('app.db');
const db = drizzle(expoDb);

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
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
  commit: (_state, action) => {
    const rows = action.meta.firefly.result?.rows || [];
    return rows.map((row: any) => ({
      id: row.id, text: row.text, completed: row.completed,
    }));
  },
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

For transactions, `action.meta.firefly.result.results` contains an array of individual `OperationResult` objects.

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
import { createFirefly, withHydration, applyRows, listApply } from 'redux-firefly';

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

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
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
import { createFirefly, fireflyClientDriver } from 'redux-firefly';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: fireflyClientDriver(client),
  changes: client,
});
```

For drizzle effects, see the next section — they bypass the driver.

### Drizzle + FireflyDB

A drizzle effect is awaited directly and carries its own db handle, so it
bypasses whatever `database` driver you configured. To run drizzle on the
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
import { createFirefly } from 'redux-firefly';
import { makeDb } from './db';

const client = createFireflyClient({ /* relayUrl, databaseID, token, … */ });
await client.init();
await client.open();

const db = makeDb(client);

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
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
- **Transactions work through the proxy**: drizzle's `db.transaction` (and array
  effects) forward `BEGIN`/`COMMIT`/`ROLLBACK` through `client.exec`. The client
  is a single connection, so keep `serializeEffects` on (the default) to prevent
  overlapping transactions.
- The full loop: dispatch → optimistic reducer → drizzle effect writes through
  the client (tracked, syncs to the relay) → commit action. Other devices
  receive the change as merged rows → their `applyRows` slices update — and
  yours do the same for their writes.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
