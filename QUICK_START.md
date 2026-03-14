# Redux-Firefly Quick Start

Get redux-firefly running in your React Native app in 5 minutes.

## 1. Install

```bash
npm install redux-firefly @reduxjs/toolkit react-redux expo-sqlite
```

## 2. Create Database

`src/db.ts`:
```typescript
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('app.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0
  );
`);
```

## 3. Define a Slice

`src/todosSlice.ts`:
```typescript
import { createFireflySlice } from 'redux-firefly/toolkit';

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
      id: r.id,
      text: r.text,
      completed: Boolean(r.completed),
    })),
  },
  reducers: (fireflyReducer) => ({
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

    deleteTodo: fireflyReducer({
      reducer: (state, action) => {
        return state.filter(t => t.id !== action.payload.id);
      },
      prepare: (id: number) => ({
        payload: { id },
      }),
      effect: (payload) => ({
        sql: 'DELETE FROM todos WHERE id = ?',
        params: [payload.id],
      }),
    }),
  }),
});

export const { addTodo, toggleTodo, deleteTodo } = todosSlice.actions;
export default todosSlice.reducer;
```

## 4. Configure Store

`src/store.ts`:
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createFirefly, expoSQLiteDriver } from 'redux-firefly';
import { db } from './db';
import todosReducer from './todosSlice';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: expoSQLiteDriver(db),
  debug: __DEV__,
});

export const store = configureStore({
  reducer: enhanceReducer({
    todos: todosReducer,
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
```

## 5. Setup App

`App.tsx`:
```tsx
import { Provider, useDispatch, useSelector } from 'react-redux';
import { FireflyGate } from 'redux-firefly/react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import { store } from './src/store';
import { addTodo, toggleTodo, deleteTodo } from './src/todosSlice';

function TodoList() {
  const todos = useSelector((state: any) => state.todos);
  const dispatch = useDispatch();

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Button title="Add Todo" onPress={() => dispatch(addTodo('New Todo'))} />
      {todos.map((todo: any) => (
        <View key={todo.id} style={{ flexDirection: 'row', padding: 10 }}>
          <Text>{todo.text} - {todo.completed ? 'Done' : 'Pending'}</Text>
          <Button title="Toggle" onPress={() => dispatch(toggleTodo(todo.id, todo.completed))} />
          <Button title="Delete" onPress={() => dispatch(deleteTodo(todo.id))} />
        </View>
      ))}
    </View>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <FireflyGate loading={<ActivityIndicator />}>
        <TodoList />
      </FireflyGate>
    </Provider>
  );
}
```

---

## Using Drizzle ORM (Alternative)

Prefer Drizzle ORM over raw SQL? Redux-Firefly supports Drizzle query builders as a drop-in replacement for effect objects.

### Install Drizzle

```bash
npm install drizzle-orm
```

### 2a. Define Schema with Drizzle

`src/tables.ts`:
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  completed: integer('completed', { mode: 'boolean' }).default(false).notNull(),
});
```

`src/db.ts`:
```typescript
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

const expoDb = SQLite.openDatabaseSync('app.db');
export const db = drizzle(expoDb);
```

> You'll still need to create tables via migrations or raw SQL. See [Drizzle migrations](https://orm.drizzle.team/docs/migrations) for details.

### 3a. Define a Slice with Drizzle Effects

`src/todosSlice.ts`:
```typescript
import { createFireflySlice } from 'redux-firefly/toolkit';
import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { todos } from './tables';

interface Todo {
  id: string | number;
  text: string;
  completed: boolean;
}

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState: [] as Todo[],
  hydration: {
    query: db.select().from(todos).orderBy(desc(todos.id)),
    transform: (rows) => rows.map(r => ({
      id: r.id, text: r.text, completed: r.completed,
    })),
  },
  reducers: (fireflyReducer) => ({
    addTodo: fireflyReducer({
      reducer: (state, action) => { state.push(action.payload); },
      prepare: (text: string) => ({
        payload: { id: `temp_${Date.now()}`, text, completed: false } as Todo,
      }),
      effect: (payload) => db.insert(todos).values({ text: payload.text }),
      commit: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.id = action.meta.firefly.result.insertId!;
      },
      rollback: (state, action) => state.filter(t => t.id !== action.payload.id),
    }),

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
      rollback: (state, action) => {
        const todo = state.find(t => t.id === action.payload.id);
        if (todo) todo.completed = !todo.completed;
      },
    }),

    deleteTodo: fireflyReducer({
      reducer: (state, action) => state.filter(t => t.id !== action.payload.id),
      prepare: (id: number) => ({ payload: { id } }),
      effect: (payload) => db.delete(todos).where(eq(todos.id, payload.id)),
    }),
  }),
});

export const { addTodo, toggleTodo, deleteTodo } = todosSlice.actions;
export default todosSlice.reducer;
```

### 4a. Configure Store (Drizzle)

`src/store.ts`:
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createFirefly } from 'redux-firefly';
import { db } from './db';
import todosReducer from './todosSlice';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: db, // pass drizzle instance directly — no driver wrapper needed
  debug: __DEV__,
});

export const store = configureStore({
  reducer: enhanceReducer({ todos: todosReducer }),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: { ignoredActionPaths: ['meta.firefly'] },
    }).concat(middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
});
```

Steps 5 (App setup) and the React component remain identical — see above.

For the full Drizzle API (transactions, JOINs, SELECT queries), see the [Drizzle ORM section](README.md#drizzle-orm) in the README.

---

## That's It!

Your app now:
- Persists data to SQLite automatically
- Loads data on startup (hydration)
- Optimistically updates the UI, then syncs to the database
- Shows a loading indicator during hydration
- Rolls back on database errors

## Next Steps

- See [Advanced Patterns](README.md#advanced-usage) for transactions and static effects
- Read the [API Reference](README.md#api-reference) for complete documentation
- Check out the example app in `/example`

## Common Issues

**Data not saving?**
- Check that your reducer uses `fireflyReducer(...)` with an `effect` property
- Enable `debug: true` to see logs
- Verify table/column names match your schema

**Serializable check warnings?**
- Add `ignoredActionPaths: ['meta.firefly']` to your `serializableCheck` middleware config (see step 4)
