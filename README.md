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
- `onError?` (`(error: Error, action: FireflyAction) => void`): Optional error handler
- `debug?` (boolean): Enable debug logging

**Returns:** `{ middleware, enhanceReducer, enhanceStore }`

### `expoSQLiteDriver(db)`

Wraps an expo-sqlite database instance into a `FireflyDriver`. Compatible with expo-sqlite v14 and v15.

```typescript
import { expoSQLiteDriver } from 'redux-firefly';
import * as SQLite from 'expo-sqlite';

const driver = expoSQLiteDriver(SQLite.openDatabaseSync('app.db'));
```

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

### `createFireflySlice(options)` (Toolkit)

Creates a Redux Toolkit slice with colocated Firefly effect, commit, and rollback handlers plus optional hydration. Import from `redux-firefly/toolkit`.

**Parameters:**
- `name` (string): Slice name
- `initialState` (State | () => State): Initial state
- `reducers` (`(fireflyReducer) => CaseReducers`): A callback that receives the `fireflyReducer` helper and returns case reducer definitions
- `hydration?` (HydrationQuery): Hydration query config (equivalent to wrapping with `withHydration`)
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

Pass a Drizzle query as the `query` property in your hydration config. Use `transform` to shape the rows into your state:

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
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
