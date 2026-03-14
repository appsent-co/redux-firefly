import { createFireflySlice } from 'redux-firefly/toolkit';
import type { Todo } from '../../../types';

const initialState: Todo[] = [];

const todosSlice = createFireflySlice({
  name: 'todos',
  initialState,
  hydration: {
    query: 'SELECT * FROM todos ORDER BY created_at DESC',
    transform: (rows: any[]): Todo[] =>
      rows.map((row) => ({
        id: row.id,
        text: row.text,
        completed: Boolean(row.completed),
        tags: [],
        priority: 1,
        createdAt: row.created_at * 1000,
        updatedAt: row.updated_at * 1000,
      })),
  },
  reducers: (fireflyReducer) => ({
    addTodo: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (text: string) => {
        const now = Date.now();
        return {
          payload: {
            id: `temp_${now}`,
            text,
            completed: false,
            tags: [],
            priority: 1 as const,
            createdAt: now,
            updatedAt: now,
            syncing: true,
          } as Todo,
        };
      },
      effect: (payload) => ({
        sql: 'INSERT INTO todos (text, completed, created_at, updated_at) VALUES (?, ?, ?, ?)',
        params: [payload.text, 0, Math.floor(payload.createdAt / 1000), Math.floor(payload.updatedAt / 1000)],
      }),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.id = action.meta.firefly.result?.lastInsertRowId ?? todo.id;
          todo.syncing = false;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

    toggleTodo: fireflyReducer({
      reducer: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = true;
        }
      },
      prepare: (id: number | string, currentCompleted: boolean) => ({
        payload: { id, currentCompleted },
      }),
      effect: (payload) => ({
        sql: 'UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?',
        params: [payload.currentCompleted ? 0 : 1, Math.floor(Date.now() / 1000), payload.id],
      }),
      commit: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) todo.syncing = false;
      },
      rollback: (state, action) => {
        const todo = state.find((t) => t.id === action.payload.id);
        if (todo) {
          todo.completed = !todo.completed;
          todo.syncing = false;
        }
      },
    }),

    deleteTodo: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number | string, deletedTodo: Todo) => ({
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

export const { addTodo, toggleTodo, deleteTodo } = todosSlice.actions;
export default todosSlice.reducer;
