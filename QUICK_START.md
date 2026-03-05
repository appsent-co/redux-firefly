# Redux-Firefly Quick Start

Get redux-firefly running in your React Native app in 5 minutes.

## 1. Install

```bash
npm install redux-firefly redux react-redux expo-sqlite
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

## 3. Configure Store

`src/store.ts`:
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createFirefly, withHydration } from 'redux-firefly';
import { db } from './db';

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: db,
  debug: __DEV__,
});

const todosReducer = withHydration(
  (state = [], action: any) => {
    switch (action.type) {
      case 'ADD_TODO':
        return [...state, action.payload];
      case 'TOGGLE_TODO':
        return state.map(t =>
          t.id === action.payload.id ? { ...t, completed: !t.completed } : t
        );
      case 'DELETE_TODO':
        return state.filter(t => t.id !== action.payload.id);
      default:
        return state;
    }
  },
  {
    query: 'SELECT * FROM todos',
    transform: (rows) => rows.map(r => ({
      id: r.id,
      text: r.text,
      completed: Boolean(r.completed),
    })),
  }
);

export const store = configureStore({
  reducer: enhanceReducer({
    todos: todosReducer,
  }),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(middleware),
});
```

## 4. Create Actions

`src/actions.ts`:
```typescript
export const addTodo = (text: string) => ({
  type: 'ADD_TODO',
  payload: { id: Date.now(), text, completed: false },
  meta: {
    firefly: {
      effect: {
        type: 'INSERT',
        table: 'todos',
        values: { text, completed: 0 },
      },
    },
  },
});

export const toggleTodo = (id: number) => ({
  type: 'TOGGLE_TODO',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE',
        table: 'todos',
        values: { completed: 1 },
        where: { id },
      },
    },
  },
});

export const deleteTodo = (id: number) => ({
  type: 'DELETE_TODO',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'DELETE',
        table: 'todos',
        where: { id },
      },
    },
  },
});
```

## 5. Setup App

`App.tsx`:
```tsx
import { Provider, useDispatch, useSelector } from 'react-redux';
import { FireflyGate } from 'redux-firefly/react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import { store } from './src/store';
import { addTodo, toggleTodo, deleteTodo } from './src/actions';

function TodoList() {
  const todos = useSelector((state: any) => state.todos);
  const dispatch = useDispatch();

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Button title="Add Todo" onPress={() => dispatch(addTodo('New Todo'))} />
      {todos.map((todo: any) => (
        <View key={todo.id} style={{ flexDirection: 'row', padding: 10 }}>
          <Text>{todo.text} - {todo.completed ? '✅' : '⬜'}</Text>
          <Button title="Toggle" onPress={() => dispatch(toggleTodo(todo.id))} />
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

## That's It! 🎉

Your app now:
- ✅ Persists data to SQLite
- ✅ Loads data on startup (hydration)
- ✅ Updates database on every action
- ✅ Shows loading screen during hydration

## Next Steps

- See [Advanced Patterns](README.md#advanced-usage) for transactions and optimistic updates
- Read the [API Reference](README.md#api-reference) for complete documentation
- Check out the example app in `/example`

## Common Issues

**Data not saving?**
- Check action has `meta.firefly` property
- Enable `debug: true` to see logs
- Verify table/column names match your schema
