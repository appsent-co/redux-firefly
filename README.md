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
        type: 'INSERT',
        table: 'todos',
        values: { text: payload.text, completed: 0 },
      }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.id = action.meta.firefly.result.insertId!;
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
- `database` (FireflyDriver): A database driver instance (e.g. `expoSQLiteDriver(db)`)
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
        type: 'INSERT',
        table: 'todos',
        values: { text: payload.text, completed: 0 },
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
        type: 'INSERT',
        table: 'todos',
        values: { text: payload.text, completed: 0 },
      }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.id = action.meta.firefly.result.insertId!;
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
        type: 'UPDATE',
        table: 'todos',
        values: { completed: payload.currentCompleted ? 0 : 1 },
        where: { id: payload.id },
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
        type: 'DELETE',
        table: 'todos',
        where: { id: payload.id },
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

### Effect Types

#### INSERT

```typescript
{
  type: 'INSERT',
  table: string,
  values: Record<string, any>
}
```

#### UPDATE

```typescript
{
  type: 'UPDATE',
  table: string,
  values: Record<string, any>,
  where: { [column: string]: value }
}
```

#### DELETE

```typescript
{
  type: 'DELETE',
  table: string,
  where: { [column: string]: value }
}
```

#### SELECT

```typescript
{
  type: 'SELECT',
  table: string,
  columns?: string[],
  where?: { [column: string]: value },
  orderBy?: string,
  limit?: number
}
```

#### RAW SQL

```typescript
{
  type: 'RAW',
  sql: string,
  params?: any[]
}
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
      type: 'UPDATE',
      table: 'todos',
      values: { category_id: payload.categoryId },
      where: { id: payload.todoId },
    },
    {
      type: 'UPDATE',
      table: 'categories',
      values: { updated_at: Math.floor(Date.now() / 1000) },
      where: { id: payload.categoryId },
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
    type: 'DELETE',
    table: 'todos',
    where: { completed: 1 },
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
        type: 'RAW',
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
