import { configureStore } from '@reduxjs/toolkit';
import { createFirefly } from 'redux-firefly';
import { db, initDatabase } from '../database/schema';
import todosReducer from './slices/todosSlice';
import categoriesReducer from './slices/categoriesSlice';
import tagsReducer from './slices/tagsSlice';
import type { Todo, Category, Tag } from '../../../types';

// Initialize database schema
initDatabase();

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: db, // drizzle instance — no driver wrapper needed
  onError: (error, action) => {
    console.error('[Firefly Error]', {
      error: error.message,
      action: action.type,
      timestamp: new Date().toISOString(),
      stack: error.stack,
    });
  },
  debug: __DEV__,
});

/**
 * Create Redux store with Firefly middleware and hydration
 * Hydration config is colocated in each slice via createFireflySlice
 */
export const store = configureStore({
  reducer: enhanceReducer({
    todos: todosReducer,
    categories: categoriesReducer,
    tags: tagsReducer,
  }),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore firefly metadata in actions
        ignoredActionPaths: ['meta.firefly'],
      },
    }).concat(middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
});

// Export types for TypeScript
export type RootState = {
  todos: Todo[];
  categories: Category[];
  tags: Tag[];
};

export type AppStore = typeof store;
export type AppDispatch = AppStore['dispatch'];
