import { createFireflySlice } from 'redux-firefly/toolkit';
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
  reducers: (fireflyReducer) => ({
    // Add tag with optimistic updates
    addTag: fireflyReducer({
      reducer: (state, action) => {
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
        };
      },
      effect: (payload) => ({
        type: 'INSERT' as const,
        table: 'tags',
        values: {
          name: payload.name,
          color: payload.color,
          created_at: Math.floor((payload.createdAt ?? Date.now()) / 1000),
        },
      }),
      commit: (state, action) => {
        const realId = action.meta.firefly.result.insertId;
        const tag = state.find((t) => t.id === action.payload.id);
        if (tag && realId) {
          tag.id = realId;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

    // Update tag
    updateTag: fireflyReducer({
      reducer: (state, action) => {
        const tag = state.find((t) => t.id === action.payload.id);
        if (tag) {
          if (action.payload.name) tag.name = action.payload.name;
          if (action.payload.color) tag.color = action.payload.color;
        }
      },
      prepare: (id: number, updates: { name?: string; color?: string }) => ({
        payload: { id, ...updates },
      }),
      effect: (payload) => ({
        type: 'UPDATE' as const,
        table: 'tags',
        values: { name: payload.name, color: payload.color },
        where: { id: payload.id },
      }),
    }),

    // Delete tag
    deleteTag: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number, deletedTag: Tag) => ({
        payload: { id, deletedTag },
      }),
      effect: (payload) => ({
        type: 'DELETE' as const,
        table: 'tags',
        where: { id: payload.id },
      }),
      rollback: (state, action) => {
        state.push(action.payload.deletedTag);
      },
    }),
  }),
});

export const {
  addTag,
  updateTag,
  deleteTag,
} = tagsSlice.actions;

export default tagsSlice.reducer;
