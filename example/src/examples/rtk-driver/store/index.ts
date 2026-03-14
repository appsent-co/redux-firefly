import { configureStore } from '@reduxjs/toolkit';
import { createFirefly } from 'redux-firefly';
import { driver, initDatabase } from '../database';
import todosReducer from './todosSlice';
import type { Todo } from '../../../types';

initDatabase();

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: driver,
  debug: __DEV__,
});

export const store = configureStore({
  reducer: enhanceReducer({
    todos: todosReducer,
  }),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActionPaths: ['meta.firefly'],
      },
    }).concat(middleware),
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers().concat(enhanceStore),
});

export type RootState = { todos: Todo[] };
export type AppDispatch = typeof store.dispatch;
