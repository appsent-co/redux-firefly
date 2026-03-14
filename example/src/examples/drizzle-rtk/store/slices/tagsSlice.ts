import { createFireflySlice } from 'redux-firefly/toolkit';
import { eq, asc, type InferSelectModel } from 'drizzle-orm';
import { db } from '../../database/schema';
import { tags } from '../../database/tables';
import type { Tag } from '../../../../types';

type TagRow = InferSelectModel<typeof tags>;

const initialState: Tag[] = [];

const tagsSlice = createFireflySlice({
  name: 'tags',
  initialState,
  hydration: {
    query: db.select().from(tags).orderBy(asc(tags.name)),
    transform: (rows: TagRow[]): Tag[] => {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        createdAt: row.createdAt.getTime(),
      }));
    },
  },
  reducers: (fireflyReducer) => ({
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
      effect: (payload) =>
        db.insert(tags).values({
          name: payload.name,
          color: payload.color,
          createdAt: new Date(payload.createdAt ?? Date.now()),
        }).returning(),
      commit: (state, action) => {
        const tag = state.find((t) => t.id === action.payload.id);
        if (tag) {
          const row = action.meta.firefly.result[0];
          tag.id = row.id;
          tag.createdAt = row.createdAt.getTime();
          (tag as any).syncing = false;
        }
      },
      rollback: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
    }),

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
      effect: (payload) =>
        db.update(tags)
          .set({ name: payload.name, color: payload.color })
          .where(eq(tags.id, payload.id))
          .returning(),
      commit: (state, action) => {
        const tag = state.find((t) => t.id === action.payload.id);
        if (tag) {
          const row = action.meta.firefly.result[0];
          tag.name = row.name;
          tag.color = row.color;
        }
      },
    }),

    deleteTag: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((t) => t.id !== action.payload.id);
      },
      prepare: (id: number, deletedTag: Tag) => ({
        payload: { id, deletedTag },
      }),
      effect: (payload) =>
        db.delete(tags).where(eq(tags.id, payload.id)),
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
