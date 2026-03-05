import type { PayloadAction } from '@reduxjs/toolkit';
import { createFireflySlice, type FireflyCommitPayloadAction } from 'redux-firefly/toolkit';
import type { Tag, TagRow } from '../../types';

const initialState: Tag[] = [];

const tagsSlice = createFireflySlice({
  name: 'tags',
  initialState,
  hydration: {
    query: 'SELECT * FROM tags ORDER BY name ASC',
    transform: (rows: TagRow[]): Tag[] => {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        createdAt: row.created_at * 1000,
      }));
    },
  },
  reducers: {
    // Add tag with optimistic updates
    addTag: {
      reducer: (state, action: PayloadAction<Tag>) => {
        state.push(action.payload);
      },
      prepare: (name: string, color: string) => {
        const tempId = `temp_${Date.now()}` as any;
        const now = Date.now();
        return {
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
              commit: { payload: { tempId } },
              rollback: { payload: { tempId } },
            },
          },
        };
      },
      commit: (state, action: FireflyCommitPayloadAction<{ tempId: any }>) => {
        const realId = action.meta.firefly.result.insertId;
        const tag = state.find((t) => t.id === action.payload.tempId);
        if (tag && realId) {
          tag.id = realId;
        }
      },
      rollback: (state, action: PayloadAction<{ tempId: any }>) => {
        return state.filter((t) => t.id !== action.payload.tempId);
      },
    },

    // Update tag
    updateTag: {
      reducer: (
        state,
        action: PayloadAction<{ id: number; name?: string; color?: string }>
      ) => {
        const tag = state.find((t) => t.id === action.payload.id);
        if (tag) {
          if (action.payload.name) tag.name = action.payload.name;
          if (action.payload.color) tag.color = action.payload.color;
        }
      },
      prepare: (id: number, updates: { name?: string; color?: string }) => ({
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
      }),
    },

    // Delete tag
    deleteTag: {
      reducer: (state, action: PayloadAction<{ id: number }>) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number, deletedTag: Tag) => ({
        payload: { id },
        meta: {
          firefly: {
            effect: {
              type: 'DELETE' as const,
              table: 'tags',
              where: { id },
            },
            rollback: { payload: { deletedTag } },
          },
        },
      }),
      rollback: (state, action: PayloadAction<{ deletedTag: Tag }>) => {
        state.push(action.payload.deletedTag);
      },
    },
  },
});

export const {
  addTag,
  updateTag,
  deleteTag,
} = tagsSlice.actions;

export default tagsSlice.reducer;
