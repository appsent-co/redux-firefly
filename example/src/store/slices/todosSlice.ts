import type { PayloadAction } from '@reduxjs/toolkit';
import { createFireflySlice, type FireflyCommitPayloadAction } from 'redux-firefly/toolkit';
import type { Todo, Priority, Tag, TodoJoinRow } from '../../types';

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
  reducers: {
    // =====================================================
    // PATTERN 1: Simple INSERT (fire-and-forget)
    // =====================================================
    addTodoSimple: {
      reducer: (state, action: PayloadAction<{ text: string }>) => {
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
      }),
    },

    // =====================================================
    // PATTERN 2: Optimistic INSERT with commit/rollback
    // =====================================================
    addTodo: {
      reducer: (state, action: PayloadAction<Todo>) => {
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
              commit: { payload: { tempId } },
              rollback: { payload: { tempId } },
            },
          },
        };
      },
      commit: (state, action: FireflyCommitPayloadAction<{ tempId: string }>) => {
        const realId = action.meta.firefly.result.insertId;
        const todo = state.find((t) => t.id === action.payload.tempId);
        if (todo && realId) {
          todo.id = realId;
          todo.syncing = false;
        }
      },
      rollback: (state, action: PayloadAction<{ tempId: string }>) => {
        return state.filter((t) => t.id !== action.payload.tempId);
      },
    },

    // =====================================================
    // PATTERN 3: Optimistic UPDATE with commit/rollback
    // =====================================================
    toggleTodo: {
      reducer: (state, action: PayloadAction<{ id: number | string }>) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = true;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, currentCompleted: boolean) => ({
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
            commit: { payload: { id } },
            rollback: { payload: { id } },
          },
        },
      }),
      commit: (state, action: PayloadAction<{ id: number | string }>) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.syncing = false;
        }
      },
      rollback: (state, action: PayloadAction<{ id: number | string }>) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = false;
        }
      },
    },

    // =====================================================
    // PATTERN 4: Optimistic DELETE
    // =====================================================
    deleteTodo: {
      reducer: (state, action: PayloadAction<{ id: number | string }>) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number | string, deletedTodo: Todo) => ({
        payload: { id },
        meta: {
          firefly: {
            effect: {
              type: 'DELETE' as const,
              table: 'todos',
              where: { id: typeof id === 'string' ? parseInt(id.replace('temp_', '')) : id },
            },
            rollback: { payload: { deletedTodo } },
          },
        },
      }),
      rollback: (state, action: PayloadAction<{ deletedTodo: Todo }>) => {
        state.push(action.payload.deletedTodo);
      },
    },

    // =====================================================
    // PATTERN 5: Simple UPDATE (fire-and-forget)
    // =====================================================
    updateTodoText: {
      reducer: (
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
      prepare: (id: number | string, text: string, description?: string) => ({
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
      }),
    },

    // Update priority
    setPriority: {
      reducer: (
        state,
        action: PayloadAction<{ id: number | string; priority: Priority }>
      ) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.priority = action.payload.priority;
          todo.updatedAt = Date.now();
        }
      },
      prepare: (id: number | string, priority: Priority) => ({
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
      }),
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
    searchTodos: {
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      prepare: (searchText: string) => ({
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
            commit: {},
          },
        },
      }),
      commit: (_state, action: FireflyCommitPayloadAction) => {
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
    },

    clearSearch: () => {
      return initialState;
    },

    // =====================================================
    // PATTERN 7: Transaction - Add todo with tags
    // =====================================================
    addTodoWithTags: {
      reducer: (state, action: PayloadAction<Todo>) => {
        state.push(action.payload);
      },
      prepare: (text: string, tagIds: number[]) => {
        const tempId = `temp_${Date.now()}`;
        const now = Date.now();

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

        tagIds.forEach((tagId) => {
          effects.push({
            type: 'RAW' as const,
            sql: 'INSERT INTO todo_tags (todo_id, tag_id) VALUES (last_insert_rowid(), ?)',
            params: [tagId],
          });
        });

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
          } as Todo,
          meta: {
            firefly: {
              effect: effects,
              commit: { payload: { tempId, tagIds } },
              rollback: { payload: { tempId } },
            },
          },
        };
      },
      commit: (state, action: FireflyCommitPayloadAction<{ tempId: string; tagIds: number[] }>) => {
        const results = action.meta.firefly.result.results;
        const realId = results?.[0]?.insertId;
        const todo = state.find((t) => t.id === action.payload.tempId);
        if (todo && realId) {
          todo.id = realId;
          todo.syncing = false;
        }
      },
      rollback: (state, action: PayloadAction<{ tempId: string }>) => {
        return state.filter((t) => t.id !== action.payload.tempId);
      },
    },

    // =====================================================
    // PATTERN 8: Bulk DELETE
    // =====================================================
    deleteCompletedTodos: {
      reducer: (state) => {
        return state.filter((t) => !t.completed);
      },
      prepare: () => ({
        payload: undefined as undefined,
        meta: {
          firefly: {
            effect: {
              type: 'DELETE' as const,
              table: 'todos',
              where: { completed: 1 },
            },
            commit: {},
            rollback: {},
          },
        },
      }),
      commit: (state) => {
        state.forEach((t) => {
          t.syncing = false;
        });
      },
      rollback: (_state, action: FireflyCommitPayloadAction) => {
        console.error('Failed to delete completed todos:', action.meta.firefly);
      },
    },

    // =====================================================
    // PATTERN 9: Transaction - Move to category
    // =====================================================
    moveTodoToCategory: {
      reducer: (
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
      prepare: (todoId: number, categoryId: number) => ({
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
            commit: { payload: { todoId } },
            rollback: { payload: { todoId } },
          },
        },
      }),
      commit: (state, action: PayloadAction<{ todoId: number | string }>) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          todo.syncing = false;
        }
      },
      rollback: (state, action: PayloadAction<{ todoId: number | string }>) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          todo.syncing = false;
          todo.error = 'Failed to move category';
        }
      },
    },

    // =====================================================
    // PATTERN 10: RAW Query - Statistics
    // =====================================================
    loadTodoStats: {
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      prepare: () => ({
        payload: undefined as undefined,
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
            commit: {},
          },
        },
      }),
      commit: (_state, action: FireflyCommitPayloadAction) => {
        console.log('Stats loaded:', action.meta.firefly.result?.rows);
      },
    },

    // =====================================================
    // PATTERN 11: Archive old todos
    // =====================================================
    archiveOldTodos: {
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      prepare: (_daysOld = 30) => ({
        payload: undefined as undefined,
        meta: {
          firefly: {
            effect: {
              type: 'DELETE' as const,
              table: 'todos',
              where: {
                completed: 1,
              },
            },
            commit: {},
          },
        },
      }),
      commit: (_state, action: FireflyCommitPayloadAction) => {
        const rowsAffected = action.meta.firefly.result?.rowsAffected || 0;
        console.log(`Archived ${rowsAffected} old todos`);
      },
    },
  },
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
