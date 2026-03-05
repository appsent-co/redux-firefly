# Redux-Firefly

Redux middleware for persisting state to SQLite in React Native. Redux-firefly provides an easy and reactive API that uses Redux for global state and SQLite as storage.

## Documentation

- **[Quick Start Guide](QUICK_START.md)** - Get up and running in 5 minutes
- **[API Reference](#api-reference)** - Detailed API documentation (below)
- **[Advanced Usage](#advanced-usage)** - Transactions, optimistic updates, and complex patterns

## Features

- **Simple API**: Annotate actions with `meta.firefly` to persist to SQLite
- **Optimistic Updates**: Optional commit/rollback pattern for better UX
- **Transaction Support**: Execute multiple database operations atomically
- **Hydration**: Load initial state from SQLite on app startup
- **React Integration**: FireflyGate component delays rendering until hydration completes
- **TypeScript**: Full type safety with comprehensive TypeScript definitions
- **Custom Schema**: You control the database schema completely

## Installation

```bash
npm install redux-firefly
# or
yarn add redux-firefly
```

**Required peer dependencies:**
```bash
npm install redux react-redux expo-sqlite
```

See the [Quick Start Guide](QUICK_START.md) for a complete setup tutorial.

## API Reference

### `createFirefly(config)`

Creates the Firefly middleware, reducer enhancer, and store enhancer.

**Parameters:**
- `database` (SQLiteDatabase): expo-sqlite database instance
- `onError?` (function): Optional error handler `(error, action) => void`
- `debug?` (boolean): Enable debug logging

**Returns:** `{ middleware, enhanceReducer, enhanceStore }`

**Example:**
```typescript
import { createFirefly, withHydration } from 'redux-firefly';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: db,
  debug: __DEV__,
});

const store = configureStore({
  reducer: enhanceReducer({
    todos: withHydration(todosSlice.reducer, {
      query: 'SELECT * FROM todos',
      transform: (rows) => rows.map(r => ({
        id: r.id, text: r.text, completed: Boolean(r.completed),
      })),
    }),
    user: userReducer,
  }),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(middleware),
});

await store.hydrated;
```

### `withHydration(reducer, config)`

Attaches hydration configuration to a reducer so it can be auto-discovered by `enhanceReducer`.

**Parameters:**
- `reducer` (Reducer): A Redux reducer
- `config` (HydrationQuery): `{ query, params?, transform? }`

**Returns:** The same reducer with hydration metadata attached

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

Execute multiple operations atomically by using an array of effects:

```typescript
export const moveTodoToCategory = (todoId: number, categoryId: number) => ({
  type: 'MOVE_TODO',
  payload: { todoId, categoryId },
  meta: {
    firefly: {
      // Array = transaction (all or nothing)
      effect: [
        {
          type: 'UPDATE',
          table: 'todos',
          values: { category_id: categoryId },
          where: { id: todoId },
        },
        {
          type: 'UPDATE',
          table: 'categories',
          values: { updated_at: Date.now() },
          where: { id: categoryId },
        },
      ],
      commit: { type: 'MOVE_TODO_SUCCESS' },
      rollback: { type: 'MOVE_TODO_FAILURE' },
    },
  },
});
```

### Complex Queries with RAW SQL

For complex queries (joins, aggregations), use the RAW effect:

```typescript
export const archiveOldTodos = () => ({
  type: 'ARCHIVE_OLD_TODOS',
  meta: {
    firefly: {
      effect: {
        type: 'RAW',
        sql: 'UPDATE todos SET archived = 1 WHERE created_at < ?',
        params: [Date.now() - 30 * 86400000], // 30 days ago
      },
    },
  },
});
```

### Optimistic Updates with Commit/Rollback

Handle success and failure for better UX with optimistic updates:

```typescript
export const addTodo = (text: string) => {
  const tempId = `temp_${Date.now()}`;
  return {
    type: 'ADD_TODO_OPTIMISTIC',
    payload: { id: tempId, text, completed: false },
    meta: {
      firefly: {
        effect: {
          type: 'INSERT',
          table: 'todos',
          values: { text, completed: 0 },
        },
        commit: {
          type: 'ADD_TODO_COMMIT',
          payload: { tempId },
        },
        rollback: {
          type: 'ADD_TODO_ROLLBACK',
          payload: { tempId },
        },
      },
    },
  };
};
```

**In your reducer:**
- `ADD_TODO_OPTIMISTIC`: Add todo with temp ID immediately
- `ADD_TODO_COMMIT`: Replace temp ID with real database ID from `action.meta.firefly.result.insertId`
- `ADD_TODO_ROLLBACK`: Remove optimistic todo on failure

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

Alternatively, you can skip `FireflyGate` entirely and await the hydration promise:

```typescript
await store.hydrated;
```

## TypeScript

Redux-Firefly is written in TypeScript and provides comprehensive type definitions.

```typescript
import type {
  FireflyAction,
  FireflyEffect,
  InsertEffect,
  UpdateEffect,
  DeleteEffect,
  OperationResult,
} from 'redux-firefly';
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.
