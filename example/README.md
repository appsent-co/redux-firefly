# Redux Firefly Example App

A comprehensive example Expo app demonstrating all **redux-firefly** features through a full-featured todo application.

## 🎯 What's Demonstrated

This example showcases every redux-firefly feature:

### Database Operations
- ✅ **INSERT** - Simple fire-and-forget inserts
- ✅ **INSERT (Optimistic)** - With temporary IDs and commit/rollback
- ✅ **UPDATE** - Both simple and optimistic update patterns
- ✅ **DELETE** - Single and bulk delete operations
- ✅ **SELECT** - Query operations with filtering
- ✅ **RAW SQL** - Complex queries with JOINs and aggregates
- ✅ **TRANSACTIONS** - Multi-table atomic operations

### Patterns & Features
- ✅ **Optimistic UI Updates** - Instant feedback with temp IDs
- ✅ **Commit/Rollback** - Error handling with state recovery
- ✅ **Database Hydration** - Complex JOIN queries on app startup
- ✅ **FireflyGate** - Delayed rendering until hydration completes
- ✅ **Sync Status Indicators** - Visual feedback during operations
- ✅ **Error Handling** - Comprehensive error boundaries and recovery
- ✅ **TypeScript** - Fully typed Redux Toolkit setup
- ✅ **Relationships** - One-to-many and many-to-many with foreign keys

## 📦 Setup

### Prerequisites
- Node.js 16+
- Expo CLI: `npm install -g expo-cli`

### Installation

```bash
cd example
npm install
```

### Running the App

```bash
# Start Expo dev server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## 📁 Project Structure

```
example/
├── App.tsx                         # Entry point with FireflyGate
├── package.json                    # Dependencies
├── app.json                        # Expo configuration
├── tsconfig.json                   # TypeScript config
└── src/
    ├── database/
    │   └── schema.ts               # Database schema, seed data
    ├── store/
    │   ├── index.ts                # Store config with hydration
    │   ├── hooks.ts                # Typed Redux hooks
    │   └── slices/
    │       ├── todosSlice.ts       # Todos: ALL patterns demonstrated
    │       ├── categoriesSlice.ts  # Categories CRUD
    │       └── tagsSlice.ts        # Tags CRUD
    ├── types/
    │   └── index.ts                # TypeScript types
    ├── components/
    │   ├── TodoItem.tsx            # Todo with sync indicator
    │   ├── TodoList.tsx            # List with empty state
    │   ├── TodoInput.tsx           # Add todo form
    │   ├── CategoryPicker.tsx      # Category selector modal
    │   ├── TagSelector.tsx         # Multi-select tags modal
    │   ├── FilterBar.tsx           # Filter controls
    │   ├── StatCard.tsx            # Statistics display
    │   └── ErrorBoundary.tsx       # Error handling
    ├── screens/
    │   ├── TodosScreen.tsx         # Main todos screen
    │   ├── CategoriesScreen.tsx    # Manage categories
    │   └── SettingsScreen.tsx      # Stats & bulk operations
    └── navigation/
        └── RootNavigator.tsx       # Bottom tab navigation
```

## 🎓 Code Walkthrough

### 1. Database Setup ([src/database/schema.ts](src/database/schema.ts))

**What to learn:**
- SQLite schema creation with foreign keys
- Indexes for query performance
- Seeding initial data
- CASCADE behavior for relationships

```typescript
// Four tables: todos, categories, tags, todo_tags (junction)
CREATE TABLE todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  category_id INTEGER,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX idx_todos_category ON todos(category_id);
```

**Key functions:**
- `initDatabase()` - Creates tables and seeds data
- `seedSampleTodos()` - Adds example data with relationships

---

### 2. Store Configuration ([src/store/index.ts](src/store/index.ts))

**What to learn:**
- Creating Firefly middleware
- Complex hydration with JOIN queries
- Data transformation during hydration
- Error handling setup

```typescript
// PATTERN: Hydration with JOIN query
const preloadedState = await hydrateFromDatabase(db, {
  todos: {
    query: `
      SELECT t.*, c.name as category_name,
             GROUP_CONCAT(tg.id || ':' || tg.name) as tags_data
      FROM todos t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN todo_tags tt ON t.id = tt.todo_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      GROUP BY t.id
    `,
    transform: (rows) => {
      // Parse joined data into nested objects
      return rows.map(row => ({
        id: row.id,
        text: row.text,
        category: row.category_name ? { ... } : null,
        tags: parseTags(row.tags_data),
      }));
    },
  },
});
```

**Key features:**
- Firefly middleware with `onError` callback
- Hydration of multiple slices
- Type-safe store exports

---

### 3. Todos Slice ([src/store/slices/todosSlice.ts](src/store/slices/todosSlice.ts))

**⭐ Most important file - demonstrates ALL patterns**

#### PATTERN 1: Simple INSERT (Fire-and-Forget)
```typescript
// Action creator (line ~235)
export const addTodoSimple = (text: string) => ({
  type: 'todos/addSimple',
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

// Reducer (line ~26)
addSimple: (state, action) => {
  state.push({ id: Date.now(), text: action.payload.text, ... });
}
```
**When to use:** Background operations, non-critical updates

---

#### PATTERN 2: Optimistic INSERT with Commit/Rollback
```typescript
// Action creator (line ~260)
export const addTodo = (text: string, categoryId?: number) => {
  const tempId = `temp_${Date.now()}`; // Temporary ID

  return {
    type: 'todos/addOptimistic',
    payload: {
      id: tempId,  // Use temp ID in UI immediately
      text,
      syncing: true,
      ...
    },
    meta: {
      firefly: {
        effect: {
          type: 'INSERT',
          table: 'todos',
          values: { text, category_id: categoryId },
        },
        // Success: Replace temp ID with real ID
        commit: {
          type: 'todos/addCommit',
          payload: { tempId },
        },
        // Failure: Remove item from state
        rollback: {
          type: 'todos/addRollback',
          payload: { tempId },
        },
      },
    },
  };
};

// Reducers (lines ~36-48)
addOptimistic: (state, action) => {
  state.push(action.payload); // Add with temp ID
},
addCommit: (state, action) => {
  const realId = action.meta.firefly.result.insertId;
  const todo = state.find(t => t.id === action.payload.tempId);
  if (todo) {
    todo.id = realId; // Replace temp ID
    todo.syncing = false;
  }
},
addRollback: (state, action) => {
  return state.filter(t => t.id !== action.payload.tempId); // Remove
}
```
**When to use:** User-initiated actions needing instant feedback

---

#### PATTERN 3: Optimistic UPDATE
```typescript
// Action creator (line ~320)
export const toggleTodo = (id: number, currentCompleted: boolean) => ({
  type: 'todos/toggleOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE',
        table: 'todos',
        values: { completed: currentCompleted ? 0 : 1 },
        where: { id },
      },
      commit: { type: 'todos/toggleCommit', payload: { id } },
      rollback: { type: 'todos/toggleRollback', payload: { id } },
    },
  },
});

// Reducers (lines ~55-72)
toggleOptimistic: (state, action) => {
  const todo = state.find(t => t.id === action.payload.id);
  if (todo) {
    todo.completed = !todo.completed; // Toggle immediately
    todo.syncing = true;
  }
},
toggleCommit: (state, action) => {
  const todo = state.find(t => t.id === action.payload.id);
  if (todo) todo.syncing = false; // Clear syncing flag
},
toggleRollback: (state, action) => {
  const todo = state.find(t => t.id === action.payload.id);
  if (todo) {
    todo.completed = !todo.completed; // Revert change
    todo.syncing = false;
  }
}
```

---

#### PATTERN 4: DELETE
```typescript
// Action creator (line ~345)
export const deleteTodo = (id: number, deletedTodo: Todo) => ({
  type: 'todos/deleteOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'DELETE',
        table: 'todos',
        where: { id },
      },
      rollback: {
        type: 'todos/deleteRollback',
        payload: { deletedTodo }, // Pass full object to restore
      },
    },
  },
});
```

---

#### PATTERN 5: SELECT Query
```typescript
// Action creator (line ~400)
export const searchTodos = (searchText: string) => ({
  type: 'todos/searchStarted',
  meta: {
    firefly: {
      effect: {
        type: 'RAW', // Use RAW for complex queries
        sql: `
          SELECT t.*, c.name as category_name,
                 GROUP_CONCAT(tg.name) as tag_names
          FROM todos t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN todo_tags tt ON t.id = tt.todo_id
          LEFT JOIN tags tg ON tt.tag_id = tg.id
          WHERE t.text LIKE ? OR t.description LIKE ?
          GROUP BY t.id
        `,
        params: [`%${searchText}%`, `%${searchText}%`],
      },
      commit: {
        type: 'todos/setSearchResults', // Commit receives result.rows
      },
    },
  },
});

// Reducer (line ~140)
setSearchResults: (state, action) => {
  const rows = action.meta.firefly.result.rows;
  return rows.map(row => ({
    id: row.id,
    text: row.text,
    category: row.category_name ? { ... } : null,
    tags: parseTagNames(row.tag_names),
  }));
}
```

---

#### PATTERN 6: RAW Query (Aggregates)
```typescript
// Action creator (line ~510)
export const loadTodoStats = () => ({
  type: 'todos/loadStats',
  meta: {
    firefly: {
      effect: {
        type: 'RAW',
        sql: `
          SELECT
            COUNT(*) as total,
            SUM(completed) as completed_count,
            SUM(CASE WHEN due_date < strftime('%s', 'now') THEN 1 ELSE 0 END) as overdue
          FROM todos
        `,
      },
      commit: { type: 'todos/setStats' },
    },
  },
});
```
**See also:** [SettingsScreen.tsx](src/screens/SettingsScreen.tsx) line 30 for direct DB queries

---

#### PATTERN 7: TRANSACTION (Add Todo with Tags)
```typescript
// Action creator (line ~435)
export const addTodoWithTags = (text: string, tagIds: number[]) => {
  const tempId = `temp_${Date.now()}`;

  // Build array of effects for transaction
  const effects = [
    {
      type: 'INSERT',
      table: 'todos',
      values: { text },
    },
    // Insert junction records for each tag
    ...tagIds.map(tagId => ({
      type: 'RAW',
      sql: 'INSERT INTO todo_tags (todo_id, tag_id) VALUES (last_insert_rowid(), ?)',
      params: [tagId],
    })),
  ];

  return {
    type: 'todos/addOptimistic',
    payload: { id: tempId, text, ... },
    meta: {
      firefly: {
        effect: effects, // Array = transaction (all or nothing)
        commit: {
          type: 'todos/addWithTagsCommit',
          payload: { tempId, tagIds },
        },
        rollback: {
          type: 'todos/addRollback',
          payload: { tempId },
        },
      },
    },
  };
};

// Reducer (line ~160)
addWithTagsCommit: (state, action) => {
  const { tempId } = action.payload;
  const results = action.meta.firefly.results; // Array of results
  const realId = results[0].insertId; // First effect was todo insert
  const todo = state.find(t => t.id === tempId);
  if (todo) {
    todo.id = realId;
    todo.syncing = false;
  }
}
```
**Key concept:** Array of effects = atomic transaction

---

#### PATTERN 8: Bulk DELETE
```typescript
// Action creator (line ~490)
export const deleteCompletedTodos = () => ({
  type: 'todos/deleteCompletedOptimistic',
  meta: {
    firefly: {
      effect: {
        type: 'DELETE',
        table: 'todos',
        where: { completed: 1 }, // Deletes ALL matching rows
      },
      commit: { type: 'todos/deleteCompletedSuccess' },
      rollback: { type: 'todos/deleteCompletedFailure' },
    },
  },
});
```

---

### 4. UI Components

#### TodoItem ([src/components/TodoItem.tsx](src/components/TodoItem.tsx))
**Demonstrates:**
- Sync status indicator (`syncing` flag)
- Disabled state during operations
- Error display
- Priority/category/tag badges

```typescript
// Line 30: Syncing indicator
{todo.syncing ? (
  <ActivityIndicator size="small" color="#007AFF" />
) : (
  todo.completed && <Text>✓</Text>
)}

// Line 45: Error display
{todo.error && (
  <Text style={styles.errorText}>❌ {todo.error}</Text>
)}
```

---

#### FilterBar ([src/components/FilterBar.tsx](src/components/FilterBar.tsx))
**Demonstrates:**
- Category filtering (uses state filtering, not SELECT)
- Could be enhanced to use SELECT queries
- Active filter indicators

---

### 5. Screens

#### TodosScreen ([src/screens/TodosScreen.tsx](src/screens/TodosScreen.tsx))
**Demonstrates:**
- Dispatching Firefly actions
- Reading from Redux state
- Client-side filtering (could use SELECT queries)

```typescript
const handleAddTodo = (text: string, description?: string) => {
  dispatch(addTodo(text, description, selectedCategoryId));
};

const handleToggleTodo = (todo: Todo) => {
  dispatch(toggleTodo(todo.id, todo.completed));
};
```

---

#### SettingsScreen ([src/screens/SettingsScreen.tsx](src/screens/SettingsScreen.tsx))
**Demonstrates:**
- Direct database queries with `db.getAllSync()`
- RAW SQL with aggregates
- Bulk DELETE operation

```typescript
// Line 32: Direct RAW query (not through Redux action)
const result = db.getAllSync(`
  SELECT
    COUNT(*) as total,
    SUM(completed) as completed,
    SUM(CASE WHEN due_date < strftime('%s', 'now') AND completed = 0 THEN 1 ELSE 0 END) as overdue
  FROM todos
`);
```

---

### 6. App Entry Point ([App.tsx](App.tsx))

**Demonstrates:**
- Async store creation
- FireflyGate integration
- Loading states
- Error boundaries

```typescript
// Line 24: Create store with hydration
const appStore = await createStore();

// Line 46: FireflyGate delays rendering until hydration completes
<FireflyGate
  loading={<LoadingSpinner />}
  onBeforeHydrate={() => console.log('Hydrating...')}
>
  <RootNavigator />
</FireflyGate>
```

---

## 🔑 Key Concepts

### 1. Optimistic Updates Flow
```
User Action → Dispatch Action
   ↓
Reducer runs (optimistic update, syncing=true)
   ↓
Middleware executes DB operation (async)
   ↓
Success: Dispatch commit (clear syncing, use real ID)
Failure: Dispatch rollback (revert state)
```

### 2. Temporary IDs
```typescript
// Use string IDs with prefix
const tempId = `temp_${Date.now()}`;

// In commit, get real ID
const realId = action.meta.firefly.result.insertId;

// Replace temp ID with real ID
todo.id = realId;
```

### 3. Transactions
```typescript
// Single effect = single operation
effect: { type: 'INSERT', ... }

// Array of effects = transaction (all or nothing)
effect: [
  { type: 'INSERT', table: 'todos', ... },
  { type: 'RAW', sql: 'INSERT INTO todo_tags ...', ... },
]
```

### 4. Error Handling
```typescript
// Middleware level
createFireflyMiddleware({
  onError: (error, action) => console.error(error),
});

// Action level
meta: {
  firefly: {
    effect: { ... },
    rollback: { type: 'ACTION_ROLLBACK' }, // Revert state
  },
}

// UI level
{todo.error && <Text>{todo.error}</Text>}
```

---

## 📚 Additional Resources

- **Main Documentation:** [../README.md](../README.md)
- **Quick Start Guide:** [../QUICK_START.md](../QUICK_START.md)
- **Full Usage Guide:** [../USAGE.md](../USAGE.md)

---

## 🐛 Troubleshooting

### Database not initializing
- Check console for SQL errors
- Verify schema in `src/database/schema.ts`
- Try resetting: Delete app data and reinstall

### Actions not persisting
- Verify `meta.firefly` is correctly structured
- Check middleware is added to store
- Look for errors in `onError` callback

### Hydration issues
- Ensure `_firefly` reducer is registered
- Check transform functions in hydration config
- Verify SQL queries return expected data

### TypeScript errors
- Run `npm run typecheck`
- Ensure all types are imported correctly
- Check Redux state type definitions

---

## 📝 License

MIT

---

**Built with [Redux Firefly](https://github.com/yourusername/redux-firefly) - Redux middleware for SQLite persistence in React Native**
