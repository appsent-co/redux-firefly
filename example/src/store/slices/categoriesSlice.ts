import type { PayloadAction } from '@reduxjs/toolkit';
import { createFireflySlice, type FireflyCommitPayloadAction } from 'redux-firefly/toolkit';
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
  reducers: {
    // Add category with optimistic updates
    addCategory: {
      reducer: (state, action: PayloadAction<Category>) => {
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
          } as Category,
          meta: {
            firefly: {
              effect: {
                type: 'INSERT' as const,
                table: 'categories',
                values: {
                  name,
                  color,
                  icon,
                  sort_order: 999,
                  created_at: Math.floor(now / 1000),
                },
              },
              commit: { payload: { tempId } },
              rollback: { payload: { tempId } },
            },
          },
        };
      },
      commit: (state, action: FireflyCommitPayloadAction<{ tempId: any }>) => {
        const realId = action.meta.firefly.result.insertId;
        const category = state.find((c) => c.id === action.payload.tempId);
        if (category && realId) {
          category.id = realId;
        }
      },
      rollback: (state, action: PayloadAction<{ tempId: any }>) => {
        return state.filter((c) => c.id !== action.payload.tempId);
      },
    },

    // Update category
    updateCategory: {
      reducer: (
        state,
        action: PayloadAction<{ id: number; name?: string; color?: string; icon?: string }>
      ) => {
        const category = state.find((c) => c.id === action.payload.id);
        if (category) {
          if (action.payload.name) category.name = action.payload.name;
          if (action.payload.color) category.color = action.payload.color;
          if (action.payload.icon !== undefined) category.icon = action.payload.icon;
        }
      },
      prepare: (
        id: number,
        updates: { name?: string; color?: string; icon?: string }
      ) => ({
        payload: { id, ...updates },
        meta: {
          firefly: {
            effect: {
              type: 'UPDATE' as const,
              table: 'categories',
              values: updates,
              where: { id },
            },
          },
        },
      }),
    },

    // Delete category
    deleteCategory: {
      reducer: (state, action: PayloadAction<{ id: number }>) => {
        return state.filter((c) => c.id !== action.payload.id);
      },
      prepare: (id: number, deletedCategory: Category) => ({
        payload: { id },
        meta: {
          firefly: {
            effect: {
              type: 'DELETE' as const,
              table: 'categories',
              where: { id },
            },
            rollback: { payload: { deletedCategory } },
          },
        },
      }),
      rollback: (state, action: PayloadAction<{ deletedCategory: Category }>) => {
        state.push(action.payload.deletedCategory);
      },
    },

    // Reorder categories (bulk update using transaction)
    reorderCategories: {
      reducer: (_state, action: PayloadAction<Category[]>) => {
        return action.payload;
      },
      prepare: (categories: Category[]) => ({
        payload: categories.map((cat, index) => ({ ...cat, sortOrder: index })),
        meta: {
          firefly: {
            effect: categories.map((cat, index) => ({
              type: 'UPDATE' as const,
              table: 'categories',
              values: { sort_order: index },
              where: { id: cat.id },
            })),
          },
        },
      }),
    },
  },
});

export const {
  addCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} = categoriesSlice.actions;

export default categoriesSlice.reducer;
