import { createFireflySlice } from 'redux-firefly/toolkit';
import type { Todo, Priority, Tag, TodoJoinRow } from '../../types';
import { FireflyCommitAction } from 'redux-firefly';

const initialState: Todo[] = [];

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState,
  hydration: {
    // Complex JOIN query to load todos with their categories and tags
    query: `
      SELECT
        t.id, t.text, t.description, t.completed,
        t.category_id, t.priority, t.due_date,
        t.created_at, t.updated_at,
        c.name as category_name, c.color as category_color,
        c.icon as category_icon, c.sort_order as category_sort_order,
        GROUP_CONCAT(tg.id || ':' || tg.name || ':' || tg.color) as tags_data
      FROM todos t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN todo_tags tt ON t.id = tt.todo_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      GROUP BY t.id
      ORDER BY t.completed ASC, t.due_date ASC, t.created_at DESC
    `,
    transform: (rows: TodoJoinRow[]): Todo[] => {
      return rows.map((row) => {
        // Parse tags from concatenated string
        const tags: Tag[] = [];
        if (row.tags_data) {
          const tagParts = row.tags_data.split(',');
          tagParts.forEach((part: string) => {
            const [id, name, color] = part.split(':');
            tags.push({
              id: parseInt(id),
              name,
              color,
            });
          });
        }

        return {
          id: row.id,
          text: row.text,
          description: row.description ?? undefined,
          completed: Boolean(row.completed),
          categoryId: row.category_id ?? undefined,
          category: row.category_name
            ? {
                id: row.category_id ?? 0,
                name: row.category_name,
                color: row.category_color ?? '',
                icon: row.category_icon ?? undefined,
                sortOrder: row.category_sort_order ?? 0,
                createdAt: 0,
              }
            : null,
          tags,
          priority: row.priority as 1 | 2 | 3,
          dueDate: row.due_date ?? undefined,
          createdAt: row.created_at * 1000,
          updatedAt: row.updated_at * 1000,
        };
      });
    },
  },
  reducers: (fireflyReducer) => ({
    // =====================================================
    // PATTERN 1: Simple INSERT (fire-and-forget)
    // =====================================================
    addTodoSimple: fireflyReducer({
      reducer: (state, action) => {
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
      prepare: (text: string) => ({
        payload: { text },
      }),
      effect: (payload) => ({
        type: 'INSERT' as const,
        table: 'todos',
        values: {
          text: payload.text,
          completed: 0,
          priority: 1,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
      }),
    }),

    // =====================================================
    // PATTERN 2: Optimistic INSERT with commit/rollback
    // =====================================================
    addTodo: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (
        text: string,
        description?: string,
        categoryId?: number,
        priority: Priority = 1
      ) => {
        const tempId = `temp_${Date.now()}`;
        const now = Date.now();
        return {
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
        };
      },
      effect: (payload) => ({
        type: 'INSERT' as const,
        table: 'todos',
        values: {
          text: payload.text,
          description: payload.description,
          category_id: payload.categoryId,
          completed: 0,
          priority: payload.priority,
          created_at: Math.floor(payload.createdAt / 1000),
          updated_at: Math.floor(payload.updatedAt / 1000),
        },
      }),
      commit: (state, action) => {
        const realId = action.meta.firefly.result.insertId;
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo && realId) {
          todo.id = realId;
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

    // =====================================================
    // PATTERN 3: Optimistic UPDATE with commit/rollback
    // =====================================================
    toggleTodo: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = true;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, currentCompleted: boolean) => ({
        payload: { id, currentCompleted },
      }),
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          completed: payload.currentCompleted ? 0 : 1,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id },
      }),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = false;
        }
      },
    }),

    // =====================================================
    // PATTERN 4: Optimistic DELETE
    // =====================================================
    deleteTodo: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number | string, deletedTodo: Todo) => ({
        payload: { id, deletedTodo },
      }),
      effect: (payload) => ({
        type: 'DELETE' as const,
        table: 'todos',
        where: { id: typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id },
      }),
      rollback: (state, action) => {
        state.push(action.payload.deletedTodo);
      },
    }),

    // =====================================================
    // PATTERN 5: Simple UPDATE (fire-and-forget)
    // =====================================================
    updateTodoText: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.text = action.payload.text;
          if (action.payload.description !== undefined) {
            todo.description = action.payload.description;
          }
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, text: string, description?: string) => ({
        payload: { id, text, description },
      }),
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          text: payload.text,
          description: payload.description,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id },
      }),
    }),

    // Update priority
    setPriority: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.priority = action.payload.priority;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, priority: Priority) => ({
        payload: { id, priority },
      }),
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          priority: payload.priority,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id },
      }),
    }),

    // Update category
    updateCategory: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.categoryId = action.payload.categoryId;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, categoryId?: number) => ({
        payload: { id, categoryId },
      }),
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'todos',
        values: {
          category_id: payload.categoryId ?? null,
          updated_at: Math.floor(Date.now() / 1000),
        },
        where: { id: typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id },
      }),
    }),

    // =====================================================
    // PATTERN 6: SELECT Query Results
    // =====================================================
    searchTodos: fireflyReducer({
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      prepare: (searchText: string) => ({
        payload: { searchText },
      }),
      effect: (payload) => ({
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
        params: [`%${payload.searchText}%`, `%${payload.searchText}%`],
      }),
      commit: (_state, action) => {
        // Replace state with search results
        const rows = action.meta.firefly.result?.rows || [];
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
    }),

    clearSearch: () => {
      return initialState;
    },

    // =====================================================
    // PATTERN 7: Transaction - Add todo with tags
    // =====================================================
    addTodoWithTags: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (text: string, tagIds: number[]) => {
        const tempId = `temp_${Date.now()}`;
        const now = Date.now();
        return {
          payload: {
            id: tempId,
            text,
            completed: false,
            tags: [],
            priority: 1,
            createdAt: now,
            updatedAt: now,
            syncing: true,
            tagIds,
          } as Todo & { tagIds: number[] },
        };
      },
      effect: (payload) => {
        const effects: any[] = [
          {
            type: 'INSERT' as const,
            table: 'todos',
            values: {
              text: payload.text,
              completed: 0,
              created_at: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000),
            },
          },
        ];

        payload.tagIds.forEach((tagId) => {
          effects.push({
            type: 'RAW' as const,
            sql: 'INSERT INTO todo_tags (todo_id, tag_id) VALUES (last_insert_rowid(), ?)',
            params: [tagId],
          });
        });

        return effects;
      },
      commit: (state, action) => {
        const results = action.meta.firefly.result.results;
        const realId = results?.[0]?.insertId;
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo && realId) {
          todo.id = realId;
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

    // =====================================================
    // PATTERN 8: Bulk DELETE
    // =====================================================
    deleteCompletedTodos: fireflyReducer({
      reducer: (state) => {
        return state.filter((t) => !t.completed);
      },
      // prepare: () => ({ payload: null }),
      effect: {
        type: 'DELETE' as const,
        table: 'todos',
        where: { completed: 1 },
      },
      commit: (state) => {
        state.forEach((t) => {
          t.syncing = false;
        });
      },
      rollback: (_state, action) => {
        console.error('Failed to delete completed todos:', action.meta.firefly);
      },
    }),

    // =====================================================
    // PATTERN 9: Transaction - Move to category
    // =====================================================
    moveTodoToCategory: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          todo.categoryId = action.payload.categoryId;
          todo.syncing = true;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (todoId: number, categoryId: number) => ({
        payload: { todoId, categoryId },
      }),
      effect: (payload) => [
        {
          type: 'UPDATE' as const,
          table: 'todos',
          values: {
            category_id: payload.categoryId,
            updated_at: Math.floor(Date.now() / 1000),
          },
          where: { id: payload.todoId },
        },
        {
          type: 'RAW' as const,
          sql: 'UPDATE categories SET updated_at = ? WHERE id = ?',
          params: [Math.floor(Date.now() / 1000), payload.categoryId],
        },
      ],
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          todo.syncing = false;
          todo.error = 'Failed to move category';
        }
      },
    }),

    // =====================================================
    // PATTERN 10: RAW Query - Statistics
    // =====================================================
    loadTodoStats: fireflyReducer({
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
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
      commit: (_state, action) => {
        console.log('Stats loaded:', action.meta.firefly.result?.rows);
      },
    }),

    // =====================================================
    // PATTERN 11: Archive old todos
    // =====================================================
    archiveOldTodos: fireflyReducer({
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      effect: {
        type: 'DELETE' as const,
        table: 'todos',
        where: {
          completed: 1,
        },
      },
      commit: (_state, action) => {
        const rowsAffected = action.meta.firefly.result?.rowsAffected || 0;
        console.log(`Archived ${rowsAffected} old todos`);
      },
    }),
  }),
});

export const {
  addTodoSimple,
  addTodo,
  toggleTodo,
  deleteTodo,
  updateTodoText,
  setPriority,
  updateCategory,
  searchTodos,
  clearSearch,
  addTodoWithTags,
  deleteCompletedTodos,
  moveTodoToCategory,
  loadTodoStats,
  archiveOldTodos,
} = todosSlice.actions;

export default todosSlice.reducer;
