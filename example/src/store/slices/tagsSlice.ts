import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Tag } from '../../types';

const initialState: Tag[] = [];

const tagsSlice = createSlice({
  name: 'tags',
  initialState,
  reducers: {
    // Add tag
    addTagOptimistic: (state, action: PayloadAction<Tag>) => {
      state.push(action.payload);
    },
    addTagCommit: (state, action) => {
      const { tempId } = action.payload;
      const realId = action.meta.firefly.result.insertId;
      const tag = state.find((t) => t.id === tempId);
      if (tag) {
        tag.id = realId;
      }
    },
    addTagRollback: (state, action) => {
      return state.filter((t) => t.id !== action.payload.tempId);
    },

    // Update tag
    updateTagOptimistic: (
      state,
      action: PayloadAction<{ id: number; name?: string; color?: string }>
    ) => {
      const tag = state.find((t) => t.id === action.payload.id);
      if (tag) {
        if (action.payload.name) tag.name = action.payload.name;
        if (action.payload.color) tag.color = action.payload.color;
      }
    },

    // Delete tag
    deleteTagOptimistic: (state, action: PayloadAction<{ id: number }>) => {
      return state.filter((t) => t.id !== action.payload.id);
    },
    deleteTagRollback: (state, action: PayloadAction<{ deletedTag: Tag }>) => {
      state.push(action.payload.deletedTag);
    },
  },
});

export const {
  addTagOptimistic,
  addTagCommit,
  addTagRollback,
  updateTagOptimistic,
  deleteTagOptimistic,
  deleteTagRollback,
} = tagsSlice.actions;

export default tagsSlice.reducer;

// =====================================================
// ACTION CREATORS
// =====================================================

/**
 * Add a new tag with optimistic updates
 */
export const addTag = (name: string, color: string) => {
  const tempId = `temp_${Date.now()}` as any;
  const now = Date.now();

  return {
    type: 'tags/addTagOptimistic',
    payload: {
      id: tempId,
      name,
      color,
      createdAt: now,
    } as Tag,
    meta: {
      firefly: {
        effect: {
          type: 'INSERT' as const,
          table: 'tags',
          values: {
            name,
            color,
            created_at: Math.floor(now / 1000),
          },
        },
        commit: {
          type: 'tags/addTagCommit',
          payload: { tempId },
        },
        rollback: {
          type: 'tags/addTagRollback',
          payload: { tempId },
        },
      },
    },
  };
};

/**
 * Update a tag
 */
export const updateTag = (id: number, updates: { name?: string; color?: string }) => ({
  type: 'tags/updateTagOptimistic',
  payload: { id, ...updates },
  meta: {
    firefly: {
      effect: {
        type: 'UPDATE' as const,
        table: 'tags',
        values: updates,
        where: { id },
      },
    },
  },
});

/**
 * Delete a tag
 * Note: This will cascade delete all todo_tags entries via foreign key
 */
export const deleteTag = (id: number, deletedTag: Tag) => ({
  type: 'tags/deleteTagOptimistic',
  payload: { id },
  meta: {
    firefly: {
      effect: {
        type: 'DELETE' as const,
        table: 'tags',
        where: { id },
      },
      rollback: {
        type: 'tags/deleteTagRollback',
        payload: { deletedTag },
      },
    },
  },
});
