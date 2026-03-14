import { createFireflySlice } from 'redux-firefly/toolkit';
import { eq, asc, desc, like, or, sql } from 'drizzle-orm';
import { db } from '../../database/schema';
import { todos, categories, tags, todoTags } from '../../database/tables';
import type { Todo, Priority } from '../../../../types';

const initialState: Todo[] = [];

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState,
  hydration: {
    // Drizzle query builder with JOINs — returns flat rows (one per todo-tag combo).
    // The transform groups them into nested Todo objects with tags arrays.
    query: db.select({
      id: todos.id,
      text: todos.text,
      description: todos.description,
      completed: todos.completed,
      categoryId: todos.categoryId,
      priority: todos.priority,
      dueDate: todos.dueDate,
      createdAt: todos.createdAt,
      updatedAt: todos.updatedAt,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      categorySortOrder: categories.sortOrder,
      tagId: tags.id,
      tagName: tags.name,
      tagColor: tags.color,
    })
      .from(todos)
      .leftJoin(categories, eq(todos.categoryId, categories.id))
      .leftJoin(todoTags, eq(todos.id, todoTags.todoId))
      .leftJoin(tags, eq(todoTags.tagId, tags.id))
      .orderBy(asc(todos.completed), asc(todos.dueDate), desc(todos.createdAt)),
    transform: (rows: {
      id: number; text: string; description: string | null; completed: boolean;
      categoryId: number | null; priority: number; dueDate: Date | null;
      createdAt: Date; updatedAt: Date;
      categoryName: string | null; categoryColor: string | null;
      categoryIcon: string | null; categorySortOrder: number | null;
      tagId: number | null; tagName: string | null; tagColor: string | null;
    }[]): Todo[] => {
      // Group flat JOIN rows by todo ID
      const todoMap = new Map<number, Todo>();

      for (const row of rows) {
        if (!todoMap.has(row.id)) {
          todoMap.set(row.id, {
            id: row.id,
            text: row.text,
            description: row.description ?? undefined,
            completed: row.completed,
            categoryId: row.categoryId ?? undefined,
            category: row.categoryName
              ? {
                  id: row.categoryId ?? 0,
                  name: row.categoryName,
                  color: row.categoryColor ?? '',
                  icon: row.categoryIcon ?? undefined,
                  sortOrder: row.categorySortOrder ?? 0,
                  createdAt: 0,
                }
              : null,
            tags: [],
            priority: row.priority as Priority,
            dueDate: row.dueDate?.getTime() ?? undefined,
            createdAt: row.createdAt.getTime(),
            updatedAt: row.updatedAt.getTime(),
          });
        }

        if (row.tagId && row.tagName) {
          todoMap.get(row.id)!.tags.push({
            id: row.tagId,
            name: row.tagName,
            color: row.tagColor ?? '#8E8E93',
          });
        }
      }

      return Array.from(todoMap.values());
    },
  },
  reducers: (fireflyReducer) => ({
    // =====================================================
    // PATTERN 1: Simple INSERT (fire-and-forget) with drizzle
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
      effect: (payload) =>
        db.insert(todos).values({
          text: payload.text,
          completed: false,
          priority: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
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
      effect: (payload) =>
        db.insert(todos).values({
          text: payload.text,
          description: payload.description,
          categoryId: payload.categoryId,
          completed: false,
          priority: payload.priority,
          createdAt: new Date(payload.createdAt),
          updatedAt: new Date(payload.updatedAt),
        }).returning(),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0];
          todo.id = row.id;
          todo.createdAt = row.createdAt.getTime();
          todo.updatedAt = row.updatedAt.getTime();
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
      effect: (payload) =>
        db.update(todos)
          .set({
            completed: !payload.currentCompleted,
            updatedAt: new Date(),
          })
          .where(eq(todos.id, typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id))
          .returning(),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0];
          todo.completed = row.completed;
          todo.updatedAt = row.updatedAt.getTime();
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
      effect: (payload) =>
        db.delete(todos)
          .where(eq(todos.id, typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id)),
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
      effect: (payload) =>
        db.update(todos)
          .set({
            text: payload.text,
            description: payload.description,
            updatedAt: new Date(),
          })
          .where(eq(todos.id, typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id))
          .returning(),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0];
          todo.text = row.text;
          todo.description = row.description ?? undefined;
          todo.updatedAt = row.updatedAt.getTime();
        }
      },
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
      effect: (payload) =>
        db.update(todos)
          .set({
            priority: payload.priority,
            updatedAt: new Date(),
          })
          .where(eq(todos.id, typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id))
          .returning(),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0];
          todo.priority = row.priority as Priority;
          todo.updatedAt = row.updatedAt.getTime();
        }
      },
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
      effect: (payload) =>
        db.update(todos)
          .set({
            categoryId: payload.categoryId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(todos.id, typeof payload.id === 'string' ? parseInt(payload.id.replace('temp_', '')) : payload.id))
          .returning(),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0];
          todo.categoryId = row.categoryId ?? undefined;
          todo.updatedAt = row.updatedAt.getTime();
        }
      },
    }),

    // =====================================================
    // PATTERN 6: SELECT Query Results (using drizzle raw SQL)
    // =====================================================
    searchTodos: fireflyReducer({
      reducer: () => {
        // No-op - action is intercepted by firefly middleware
      },
      prepare: (searchText: string) => ({
        payload: { searchText },
      }),
      effect: (payload) =>
        db.select({
          id: todos.id,
          text: todos.text,
          description: todos.description,
          completed: todos.completed,
          categoryId: todos.categoryId,
          priority: todos.priority,
          dueDate: todos.dueDate,
          createdAt: todos.createdAt,
          updatedAt: todos.updatedAt,
          categoryName: categories.name,
          categoryColor: categories.color,
        })
          .from(todos)
          .leftJoin(categories, eq(todos.categoryId, categories.id))
          .where(
            or(
              like(todos.text, `%${payload.searchText}%`),
              like(todos.description, `%${payload.searchText}%`)
            )
          )
          .orderBy(desc(todos.createdAt)),
      commit: (_state, action) => {
        const rows = action.meta.firefly.result || [];
        return rows.map((row: any) => ({
          id: row.id,
          text: row.text,
          description: row.description,
          completed: row.completed,
          categoryId: row.categoryId,
          category: row.categoryName
            ? {
                id: row.categoryId,
                name: row.categoryName,
                color: row.categoryColor,
                sortOrder: 0,
                createdAt: 0,
              }
            : null,
          tags: [],
          priority: row.priority,
          dueDate: row.dueDate?.getTime(),
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
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
      effect: (payload) => [
        db.insert(todos).values({
          text: payload.text,
          completed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning(),
        ...payload.tagIds.map((tagId) =>
          db.insert(todoTags).values({
            todoId: sql`last_insert_rowid()`,
            tagId,
          })
        ),
      ],
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          const row = action.meta.firefly.result[0].rows![0];
          todo.id = row.id;
          todo.createdAt = row.createdAt.getTime();
          todo.updatedAt = row.updatedAt.getTime();
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

    // =====================================================
    // PATTERN 8: Bulk DELETE with drizzle
    // =====================================================
    deleteCompletedTodos: fireflyReducer({
      reducer: (state) => {
        return state.filter((t) => !t.completed);
      },
      effect: db.delete(todos).where(eq(todos.completed, true)),
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
    // PATTERN 9: Transaction - Move to category (drizzle)
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
        db.update(todos)
          .set({
            categoryId: payload.categoryId,
            updatedAt: new Date(),
          })
          .where(eq(todos.id, payload.todoId))
          .returning(),
        db.update(categories)
          .set({ createdAt: new Date() })
          .where(eq(categories.id, payload.categoryId))
          .returning(),
      ],
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.todoId);
        if (todo) {
          const row = action.meta.firefly.result[0].rows![0];
          todo.categoryId = row.categoryId ?? undefined;
          todo.updatedAt = row.updatedAt.getTime();
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
    // PATTERN 10: RAW Query - Statistics (drizzle sql tag)
    // =====================================================
    loadTodoStats: fireflyReducer({
      reducer: () => {
        // No-op
      },
      effect: db.select({
        total: sql<number>`COUNT(*)`,
        completedCount: sql<number>`SUM(completed)`,
        overdueCount: sql<number>`SUM(CASE WHEN due_date < strftime('%s', 'now') AND completed = 0 THEN 1 ELSE 0 END)`,
        avgPriority: sql<number>`AVG(priority)`,
      }).from(todos),
      commit: (_state, action) => {
        console.log('Stats loaded:', action.meta.firefly.result);
      },
    }),

    // =====================================================
    // PATTERN 11: Archive old todos (drizzle delete)
    // =====================================================
    archiveOldTodos: fireflyReducer({
      reducer: () => {
        // No-op
      },
      effect: db.delete(todos).where(eq(todos.completed, true)),
      commit: (_state, action) => {
        console.log('Archived old todos:', action.meta.firefly.result);
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
