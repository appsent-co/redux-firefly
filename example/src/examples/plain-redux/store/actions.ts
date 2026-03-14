import type { Todo } from '../../../types';

export const ADD_TODO = 'todos/addTodo';
export const TOGGLE_TODO = 'todos/toggleTodo';
export const DELETE_TODO = 'todos/deleteTodo';

export function addTodo(text: string) {
  const now = Date.now();
  const todo: Todo = {
    id: `temp_${now}`,
    text,
    completed: false,
    tags: [],
    priority: 1,
    createdAt: now,
    updatedAt: now,
    syncing: true,
  };

  return {
    type: ADD_TODO,
    payload: todo,
    meta: {
      firefly: {
        effect: {
          sql: 'INSERT INTO todos (text, completed, created_at, updated_at) VALUES (?, ?, ?, ?)',
          params: [text, 0, Math.floor(now / 1000), Math.floor(now / 1000)],
        },
        originalPayload: todo,
        commit: { type: `${ADD_TODO}/commit` },
        rollback: { type: `${ADD_TODO}/rollback` },
      },
    },
  };
}

export function toggleTodo(id: number | string, currentCompleted: boolean) {
  return {
    type: TOGGLE_TODO,
    payload: { id, currentCompleted },
    meta: {
      firefly: {
        effect: {
          sql: 'UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?',
          params: [currentCompleted ? 0 : 1, Math.floor(Date.now() / 1000), id],
        },
        originalPayload: { id, currentCompleted },
        commit: { type: `${TOGGLE_TODO}/commit` },
        rollback: { type: `${TOGGLE_TODO}/rollback` },
      },
    },
  };
}

export function deleteTodo(id: number | string, deletedTodo: Todo) {
  return {
    type: DELETE_TODO,
    payload: { id, deletedTodo },
    meta: {
      firefly: {
        effect: {
          sql: 'DELETE FROM todos WHERE id = ?',
          params: [id],
        },
        originalPayload: { id, deletedTodo },
        commit: { type: `${DELETE_TODO}/commit` },
        rollback: { type: `${DELETE_TODO}/rollback` },
      },
    },
  };
}
