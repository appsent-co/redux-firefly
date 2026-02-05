import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Todo, Priority, TodoStats } from '../../types';

const initialState: Todo[] = [];

const todosSlice = createSlice({
  name: 'todos',
  initialState,
  reducers: {
    // =====================================================
    // PATTERN 1: Simple INSERT (fire-and-forget)
    // =====================================================
    addSimple: (state, action: PayloadAction<{ text: string }>) => {
      const now = Date.now();
      state.push({
        id: Date.now(),
        text: action.payload.text,
        completed: false,
        tags: [],
        priority: 1,
        createdAt: now,
        updatedAt: now,
      });
    },

    // =====================================================
    // PATTERN 2: Optimistic INSERT with commit/rollback
    // =====================================================
    addOptimistic: (state, action: PayloadAction<Todo>) => {
      state.push(action.payload);
    },
    addCommit: (state, action) => {
      const { tempId } = action.payload;
      const realId = action.meta.firefly.result.insertId;
      const todo = state.find((t) => t.id === tempId);
      if (todo) {
        todo.id = realId;
        todo.syncing = false;
      }
    },
    addRollback: (state, action) => {
      return state.filter((t) => t.id !== action.payload.tempId);
    },

    // =====================================================
    // PATTERN 3: Optimistic UPDATE with commit/rollback
    // =====================================================
    toggleOptimistic: (state, action: PayloadAction<{ id: number | string }>) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.completed = !todo.completed;
        todo.syncing = true;
        todo.updatedAt = Date.now();
      }
    },
    toggleCommit: (state, action) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.syncing = false;
      }
    },
    toggleRollback: (state, action) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.completed = !todo.completed;
        todo.syncing = false;
      }
    },

    // =====================================================
    // PATTERN 4: Optimistic DELETE
    // =====================================================
    deleteOptimistic: (state, action: PayloadAction<{ id: number | string }>) => {
      return state.filter((t) => t.id !== action.payload.id);
    },
    deleteRollback: (state, action: PayloadAction<{ deletedTodo: Todo }>) => {
      state.push(action.payload.deletedTodo);
    },

    // =====================================================
    // PATTERN 5: Simple UPDATE (fire-and-forget)
    // =====================================================
    updateTodoSimple: (
      state,
      action: PayloadAction<{ id: number | string; text: string; description?: string }>
    ) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.text = action.payload.text;
        if (action.payload.description !== undefined) {
          todo.description = action.payload.description;
        }
        todo.updatedAt = Date.now();
      }
    },

    // Update priority
    updatePriority: (
      state,
      action: PayloadAction<{ id: number | string; priority: Priority }>
    ) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.priority = action.payload.priority;
        todo.updatedAt = Date.now();
      }
    },

    // Update category
    updateCategory: (
      state,
      action: PayloadAction<{ id: number | string; categoryId?: number }>
    ) => {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.categoryId = action.payload.categoryId;
        todo.updatedAt = Date.now();
      }
    },

    // =====================================================
    // PATTERN 6: SELECT Query Results
    // =====================================================
    setSearchResults: (state, action) => {
      // Replace state with search results
      const rows = action.meta?.firefly?.result?.rows || [];
      return rows.map((row: any) => ({
        id: row.id,
        text: row.text,
        description: row.description,
        completed: Boolean(row.completed),
        categoryId: row.category_id,
        category: row.category_name
          ? {
              id: row.category_id,
              name: row.category_name,
              color: row.category_color,
              sortOrder: 0,
              createdAt: 0,
            }
          : null,
        tags: row.tag_names
          ? row.tag_names.split(',').map((name: string) => ({
              id: 0,
              name,
              color: '#8E8E93',
            }))
          : [],
        priority: row.priority,
        dueDate: row.due_date,
        createdAt: row.created_at * 1000,
        updatedAt: row.updated_at * 1000,
      }));
    },

    clearSearch: () => {
      return initialState;
    },

    // =====================================================
    // PATTERN 7: Transaction - Add todo with tags
    // =====================================================
    addWithTagsCommit: (state, action) => {
      const { tempId, tagIds } = action.payload;
      const results = action.meta.firefly.results;
      const realId = results[0].insertId; // First result is the todo insert
      const todo = state.find((t) => t.id === tempId);
      if (todo) {
        todo.id = realId;
        todo.syncing = false;
        // Tags would be loaded separately or via refetch
      }
    },

    // =====================================================
    // PATTERN 8: Bulk DELETE success
    // =====================================================
    deleteCompletedOptimistic: (state) => {
      return state.filter((t) => !t.completed);
    },
    deleteCompletedSuccess: (state) => {
      // Already removed optimistically, just clear any syncing flags
      state.forEach((t) => {
        t.syncing = false;
      });
    },
    deleteCompletedFailure: (state, action) => {
      // Would need to refetch or restore from backup
      console.error('Failed to delete completed todos:', action.meta?.firefly?.error);
    },

    // =====================================================
    // PATTERN 9: Transaction success
    // =====================================================
    moveToCategoryOptimistic: (
      state,
      action: PayloadAction<{ todoId: number | string; categoryId: number }>
    ) => {
      const todo = state.find((t) => t.id === action.payload.todoId);
      if (todo) {
        todo.categoryId = action.payload.categoryId;
        todo.syncing = true;
        todo.updatedAt = Date.now();
      }
    },
    moveToCategorySuccess: (state, action) => {
      const todo = state.find((t) => t.id === action.payload.todoId);
      if (todo) {
        todo.syncing = false;
      }
    },
    moveToCategoryFailure: (state, action) => {
      const todo = state.find((t) => t.id === action.payload.todoId);
      if (todo) {
        todo.syncing = false;
        todo.error = 'Failed to move category';
      }
    },

    // =====================================================
    // PATTERN 10: RAW Query - Statistics
    // =====================================================
    setStats: (state, action) => {
      // Stats are handled in a separate slice or local component state
      // This is just for demonstration
      console.log('Stats loaded:', action.meta?.firefly?.result?.rows);
    },

    // =====================================================
    // PATTERN 11: Archive old todos
    // =====================================================
    archiveSuccess: (state, action) => {
      const rowsAffected = action.meta?.firefly?.result?.rowsAffected || 0;
      console.log(`Archived ${rowsAffected} old todos`);
      // Would typically refetch or update UI to reflect archived todos
    },
  },
});

export const {
  addSimple,
  addOptimistic,
  addCommit,
  addRollback,
  toggleOptimistic,
  toggleCommit,
  toggleRollback,
  deleteOptimistic,
  deleteRollback,
  updateTodoSimple,
  updatePriority,
  updateCategory,
  setSearchResults,
  clearSearch,
  addWithTagsCommit,
  deleteCompletedOptimistic,
  deleteCompletedSuccess,
  deleteCompletedFailure,
  moveToCategoryOptimistic,
  moveToCategorySuccess,
  moveToCategoryFailure,
  setStats,
  archiveSuccess,
} = todosSlice.actions;

export default todosSlice.reducer;

// =====================================================
// ACTION CREATORS (with meta.firefly)
// =====================================================

/**
 * PATTERN 1: Simple INSERT (fire-and-forget)
 * Use when you don't need optimistic updates or complex error handling
 */
export const addTodoSimple = (text: string) => ({
  type: 'todos/addSimple',
  payload: { text },
  meta: {
    firefly: {
      effect: {
        type: 'INSERT' as const,
        table: 'todos',
        values: {
          text,
          completed: 0,
          priority: 1,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  },
});

/**
 * PATTERN 2: Optimistic INSERT with commit/rollback
 * Best for user-initiated actions where instant feedback is important
 */
export const addTodo = (
  text: string,
  description?: string,
  categoryId?: number,
  priority: Priority = 1
) => {
  const tempId = `temp_${Date.now()}`;
  const now = Date.now();

  return {
    type: 'todos/addOptimistic',
    payload: {
      id: tempId,
      text,
      description,
      completed: false,
      categoryId,
      category: null,
      tags: [],
      priority,
      createdAt: now,
      updatedAt: now,
      syncing: true,
    } as Todo,
    meta: {
      firefly: {
        effect: {
          type: 'INSERT' as const,
          table: 'todos',
          values: {
            text,
            description,
            category_id: categoryId,
            completed: 0,
            priority,
            created_at: Math.floor(now / 1000),
            updated_at: Math.floor(now / 1000),
          },
        },
        commit: {
          type: 'todos/addCommit',
          payload: { tempId },
        },
        rollback: {
          type: 'todos/addRollback',
          payload: { tempId },
        },
      },
    },
  };
};

/**
 * PATTERN 3: Optimistic UPDATE
 */
export const toggleTodo = (id: number | string, currentCompleted: boolean) => ({
  type: 'todos/toggleOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          completed: currentCompleted ? 0 : 1,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof id === 'string' ? parseInt(id.replace('temp_', '')) : id },
      },
      commit: { type: 'todos/toggleCommit', payload: { id } },
      rollback: { type: 'todos/toggleRollback', payload: { id } },
    },
  },
});

/**
 * PATTERN 4: Optimistic DELETE
 */
export const deleteTodo = (id: number | string, deletedTodo: Todo) => ({
  type: 'todos/deleteOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'DELETE' as const,
        table: 'todos',
        where: { id: typeof id === 'string' ? parseInt(id.replace('temp_', '')) : id },
      },
      rollback: {
        type: 'todos/deleteRollback',
        payload: { deletedTodo },
      },
    },
  },
});

/**
 * PATTERN 5: Simple UPDATE
 */
export const updateTodoText = (id: number | string, text: string, description?: string) => ({
  type: 'todos/updateTodoSimple',
  payload: { id, text, description },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          text,
          description,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof id === 'string' ? parseInt(id.replace('temp_', '')) : id },
      },
    },
  },
});

export const setPriority = (id: number | string, priority: Priority) => ({
  type: 'todos/updatePriority',
  payload: { id, priority },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          priority,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof id === 'string' ? parseInt(id.replace('temp_', '')) : id },
      },
    },
  },
});

/**
 * PATTERN 6: SELECT Query
 */
export const searchTodos = (searchText: string) => ({
  type: 'todos/searchStarted',
  payload: { searchText },
  meta: {
    firefly: {
      effect: {
        type: 'RAW' as const,
        sql: `
          SELECT
            t.*,
            c.name as category_name, c.color as category_color,
            GROUP_CONCAT(tg.name) as tag_names
          FROM todos t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN todo_tags tt ON t.id = tt.todo_id
          LEFT JOIN tags tg ON tt.tag_id = tg.id
          WHERE t.text LIKE ? OR t.description LIKE ?
          GROUP BY t.id
          ORDER BY t.created_at DESC
        `,
        params: [`%${searchText}%`, `%${searchText}%`],
      },
      commit: {
        type: 'todos/setSearchResults',
      },
    },
  },
});

/**
 * PATTERN 7: TRANSACTION - Add todo with tags
 */
export const addTodoWithTags = (text: string, tagIds: number[]) => {
  const tempId = `temp_${Date.now()}`;
  const now = Date.now();

  // Build effects array: first insert todo, then insert junction records
  const effects: any[] = [
    {
      type: 'INSERT' as const,
      table: 'todos',
      values: {
        text,
        completed: 0,
        created_at: Math.floor(now / 1000),
        updated_at: Math.floor(now / 1000),
      },
    },
  ];

  // Add junction table inserts for each tag
  tagIds.forEach((tagId) => {
    effects.push({
      type: 'RAW' as const,
      sql: 'INSERT INTO todo_tags (todo_id, tag_id) VALUES (last_insert_rowid(), ?)',
      params: [tagId],
    });
  });

  return {
    type: 'todos/addOptimistic',
    payload: {
      id: tempId,
      text,
      completed: false,
      tags: [],
      priority: 1,
      createdAt: now,
      updatedAt: now,
      syncing: true,
    } as Todo,
    meta: {
      firefly: {
        effect: effects,
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

/**
 * PATTERN 8: TRANSACTION - Move todo to category
 */
export const moveTodoToCategory = (todoId: number, categoryId: number) => ({
  type: 'todos/moveToCategoryOptimistic',
  payload: { todoId, categoryId },
  meta: {
    firefly: {
      effect: [
        {
          type: 'UPDATE' as const,
          table: 'todos',
          values: {
            category_id: categoryId,
            updated_at: Math.floor(Date.now() / 1000),
          },
          where: { id: todoId },
        },
        {
          type: 'RAW' as const,
          sql: 'UPDATE categories SET updated_at = ? WHERE id = ?',
          params: [Math.floor(Date.now() / 1000), categoryId],
        },
      ],
      commit: { type: 'todos/moveToCategorySuccess', payload: { todoId } },
      rollback: { type: 'todos/moveToCategoryFailure', payload: { todoId } },
    },
  },
});

/**
 * PATTERN 9: Bulk DELETE
 */
export const deleteCompletedTodos = () => ({
  type: 'todos/deleteCompletedOptimistic',
  meta: {
    firefly: {
      effect: {
        type: 'DELETE' as const,
        table: 'todos',
        where: { completed: 1 },
      },
      commit: { type: 'todos/deleteCompletedSuccess' },
      rollback: { type: 'todos/deleteCompletedFailure' },
    },
  },
});

/**
 * PATTERN 10: RAW Query - Statistics
 */
export const loadTodoStats = () => ({
  type: 'todos/loadStats',
  meta: {
    firefly: {
      effect: {
        type: 'RAW' as const,
        sql: `
          SELECT
            COUNT(*) as total,
            SUM(completed) as completed_count,
            SUM(CASE WHEN due_date < strftime('%s', 'now') AND completed = 0 THEN 1 ELSE 0 END) as overdue_count,
            AVG(priority) as avg_priority
          FROM todos
        `,
      },
      commit: { type: 'todos/setStats' },
    },
  },
});

/**
 * PATTERN 11: Bulk UPDATE with RAW
 */
export const archiveOldTodos = (daysOld = 30) => ({
  type: 'todos/archiveOld',
  meta: {
    firefly: {
      effect: {
        type: 'DELETE' as const,
        table: 'todos',
        where: {
          completed: 1,
        },
      },
      commit: { type: 'todos/archiveSuccess' },
    },
  },
});
