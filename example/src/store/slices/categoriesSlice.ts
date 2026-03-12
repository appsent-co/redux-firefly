import { createFireflySlice } from 'redux-firefly/toolkit';
import type { Category, CategoryRow } from '../../types';

const initialState: Category[] = [];

const categoriesSlice = createFireflySlice({
  name: 'categories',
  initialState,
  hydration: {
    query: 'SELECT * FROM categories ORDER BY sort_order ASC, name ASC',
    transform: (rows: CategoryRow[]): Category[] => {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at * 1000,
      }));
    },
  },
  reducers: (fireflyReducer) => ({
    // Add category with optimistic updates
    addCategory: fireflyReducer({
      reducer: (state, action) => {
        state.push(action.payload);
      },
      prepare: (name: string, color: string, icon?: string) => {
        const tempId = `temp_${Date.now()}` as any;
        const now = Date.now();
        return {
          payload: {
            id: tempId,
            name,
            color,
            icon,
            sortOrder: 999,
            createdAt: now,
          },
        };
      },
      effect: (payload) => ({
        type: 'INSERT' as const,
        table: 'categories',
        values: {
          name: payload.name,
          color: payload.color,
          icon: payload.icon,
          sort_order: 999,
          created_at: Math.floor(payload.createdAt / 1000),
        },
      }),
      commit: (state, action) => {
        const realId = action.meta.firefly.result.insertId;
        const category = state.find((c) => c.id === action.payload.id);
        if (category && realId) {
          category.id = realId;
        }
      },
      rollback: (state, action) => {
        return state.filter((c) => c.id !== action.payload.id);
      },
    }),

    // Update category
    updateCategory: fireflyReducer({
      prepare: (
        id: number,
        updates: { name?: string; color?: string; icon?: string }
      ) => ({
        payload: { id, ...updates },
      }),
      reducer: (state, action) => {
        const category = state.find((c) => c.id === action.payload.id);
        if (category) {
          if (action.payload.name) category.name = action.payload.name;
          if (action.payload.color) category.color = action.payload.color;
          if (action.payload.icon !== undefined) category.icon = action.payload.icon;
        }
      },
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'categories',
        values: { name: payload.name, color: payload.color, icon: payload.icon },
        where: { id: payload.id },
      }),
    }),

    // Delete category
    deleteCategory: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((c) => c.id !== action.payload.id);
      },
      prepare: (id: number, deletedCategory: Category) => ({
        payload: { id, deletedCategory },
      }),
      effect: (payload) => ({
        type: 'DELETE' as const,
        table: 'categories',
        where: { id: payload.id },
      }),
      rollback: (state, action) => {
        state.push(action.payload.deletedCategory);
      },
    }),

    // Reorder categories (bulk update using transaction)
    reorderCategories: fireflyReducer({
      reducer: (_state, action) => {
        return action.payload;
      },
      prepare: (categories: Category[]) => ({
        payload: categories.map((cat, index) => ({ ...cat, sortOrder: index })),
      }),
      effect: (payload) =>
        payload.map((cat, index) => ({
          type: 'UPDATE' as const,
          table: 'categories',
          values: { sort_order: index },
          where: { id: cat.id },
        })),
    }),
  }),
});

export const {
  addCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} = categoriesSlice.actions;

export default categoriesSlice.reducer;
