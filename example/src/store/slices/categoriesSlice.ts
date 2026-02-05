import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Category } from '../../types';

const initialState: Category[] = [];

const categoriesSlice = createSlice({
  name: 'categories',
  initialState,
  reducers: {
    // Add category optimistically
    addCategoryOptimistic: (state, action: PayloadAction<Category>) => {
      state.push(action.payload);
    },
    addCategoryCommit: (state, action) => {
      const { tempId } = action.payload;
      const realId = action.meta.firefly.result.insertId;
      const category = state.find((c) => c.id === tempId);
      if (category) {
        category.id = realId;
      }
    },
    addCategoryRollback: (state, action) => {
      return state.filter((c) => c.id !== action.payload.tempId);
    },

    // Update category
    updateCategoryOptimistic: (
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

    // Delete category
    deleteCategoryOptimistic: (state, action: PayloadAction<{ id: number }>) => {
      return state.filter((c) => c.id !== action.payload.id);
    },
    deleteCategoryRollback: (state, action: PayloadAction<{ deletedCategory: Category }>) => {
      state.push(action.payload.deletedCategory);
    },

    // Reorder categories
    reorderCategories: (state, action: PayloadAction<Category[]>) => {
      return action.payload;
    },
  },
});

export const {
  addCategoryOptimistic,
  addCategoryCommit,
  addCategoryRollback,
  updateCategoryOptimistic,
  deleteCategoryOptimistic,
  deleteCategoryRollback,
  reorderCategories,
} = categoriesSlice.actions;

export default categoriesSlice.reducer;

// =====================================================
// ACTION CREATORS
// =====================================================

/**
 * Add a new category with optimistic updates
 */
export const addCategory = (name: string, color: string, icon?: string) => {
  const tempId = `temp_${Date.now()}` as any;
  const now = Date.now();

  return {
    type: 'categories/addCategoryOptimistic',
    payload: {
      id: tempId,
      name,
      color,
      icon,
      sortOrder: 999, // Will be updated on commit
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
        commit: {
          type: 'categories/addCategoryCommit',
          payload: { tempId },
        },
        rollback: {
          type: 'categories/addCategoryRollback',
          payload: { tempId },
        },
      },
    },
  };
};

/**
 * Update a category
 */
export const updateCategory = (
  id: number,
  updates: { name?: string; color?: string; icon?: string }
) => ({
  type: 'categories/updateCategoryOptimistic',
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
});

/**
 * Delete a category
 * Note: This uses CASCADE behavior - all todos with this category will have category_id set to NULL
 */
export const deleteCategory = (id: number, deletedCategory: Category) => ({
  type: 'categories/deleteCategoryOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'DELETE' as const,
        table: 'categories',
        where: { id },
      },
      rollback: {
        type: 'categories/deleteCategoryRollback',
        payload: { deletedCategory },
      },
    },
  },
});

/**
 * Reorder categories (bulk update using transaction)
 */
export const reorderCategoriesAction = (categories: Category[]) => {
  // Build update effects for each category
  const effects = categories.map((cat, index) => ({
    type: 'UPDATE' as const,
    table: 'categories',
    values: { sort_order: index },
    where: { id: cat.id },
  }));

  return {
    type: 'categories/reorderCategories',
    payload: categories.map((cat, index) => ({ ...cat, sortOrder: index })),
    meta: {
      firefly: {
        effect: effects,
      },
    },
  };
};
