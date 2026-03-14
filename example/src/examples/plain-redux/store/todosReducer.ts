import { withHydration } from 'redux-firefly';
import { ADD_TODO, TOGGLE_TODO, DELETE_TODO } from './actions';
import type { Todo } from '../../../types';

const initialState: Todo[] = [];

function todosReducer(state = initialState, action: any): Todo[] {
  switch (action.type) {
    case ADD_TODO:
      return [...state, action.payload];

    case TOGGLE_TODO:
      return state.map((todo) =>
        todo.id === action.payload.id
          ? { ...todo, completed: !todo.completed, syncing: true }
          : todo
      );

    case DELETE_TODO:
      return state.filter((todo) => todo.id !== action.payload.id);

    // Commit handlers
    case `${ADD_TODO}/commit`:
      return state.map((todo) =>
        todo.id === action.payload.id
          ? { ...todo, id: action.meta.firefly.result?.lastInsertRowId ?? todo.id, syncing: false }
          : todo
      );

    case `${TOGGLE_TODO}/commit`:
      return state.map((todo) =>
        todo.id === action.payload.id ? { ...todo, syncing: false } : todo
      );

    // Rollback handlers
    case `${ADD_TODO}/rollback`:
      return state.filter((todo) => todo.id !== action.payload.id);

    case `${TOGGLE_TODO}/rollback`:
      return state.map((todo) =>
        todo.id === action.payload.id
          ? { ...todo, completed: !todo.completed, syncing: false }
          : todo
      );

    case `${DELETE_TODO}/rollback`:
      return [...state, action.payload.deletedTodo];

    default:
      return state;
  }
}

export default withHydration(todosReducer, {
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
});
