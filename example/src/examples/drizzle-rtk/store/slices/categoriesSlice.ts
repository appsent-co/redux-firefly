import { createFireflySlice } from 'redux-firefly/toolkit';
import { eq, asc, type InferSelectModel } from 'drizzle-orm';
import { db } from '../../database/schema';
import { categories } from '../../database/tables';
import type { Category } from '../../../../types';

type CategoryRow = InferSelectModel<typeof categories>;

const initialState: Category[] = [];

const categoriesSlice = createFireflySlice({
  name: 'categories',
  initialState,
  hydration: {
    query: db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    transform: (rows: CategoryRow[]): Category[] => {
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon ?? undefined,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.getTime(),
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
      effect: (payload) =>
        db.insert(categories).values({
          name: payload.name,
          color: payload.color,
          icon: payload.icon,
          sortOrder: 999,
          createdAt: new Date(payload.createdAt),
        }).returning(),
      commit: (state, action) => {
        const category = state.find((c) => c.id === action.payload.id);
        if (category) {
          const row = action.meta.firefly.result[0];
          category.id = row.id;
          category.sortOrder = row.sortOrder;
          category.createdAt = row.createdAt.getTime();
          (category as any).syncing = false;
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
      effect: (payload) =>
        db.update(categories)
          .set({
            name: payload.name,
            color: payload.color,
            icon: payload.icon,
          })
          .where(eq(categories.id, payload.id))
          .returning(),
      commit: (state, action) => {
        const category = state.find((c) => c.id === action.payload.id);
        if (category) {
          const row = action.meta.firefly.result[0];
          category.name = row.name;
          category.color = row.color;
          category.icon = row.icon ?? undefined;
        }
      },
    }),

    // Delete category
    deleteCategory: fireflyReducer({
      reducer: (state, action) => {
        return state.filter((c) => c.id !== action.payload.id);
      },
      prepare: (id: number, deletedCategory: Category) => ({
        payload: { id, deletedCategory },
      }),
      effect: (payload) =>
        db.delete(categories).where(eq(categories.id, payload.id)),
      rollback: (state, action) => {
        state.push(action.payload.deletedCategory);
      },
    }),

    // Reorder categories (transaction with multiple drizzle updates)
    reorderCategories: fireflyReducer({
      reducer: (_state, action) => {
        return action.payload;
      },
      prepare: (cats: Category[]) => ({
        payload: cats.map((cat, index) => ({ ...cat, sortOrder: index })),
      }),
      effect: (payload) =>
        payload.map((cat, index) =>
          db.update(categories)
            .set({ sortOrder: index })
            .where(eq(categories.id, cat.id))
        ),
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
