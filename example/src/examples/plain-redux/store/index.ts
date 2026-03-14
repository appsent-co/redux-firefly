import { createStore, applyMiddleware, compose } from 'redux';
import type { StoreEnhancer } from 'redux';
import { createFirefly } from 'redux-firefly';
import { driver, initDatabase } from '../database';
import todosReducer from './todosReducer';
import type { Todo } from '../../../types';

initDatabase();

const { middleware, enhanceReducer, enhanceStore } = createFirefly({
  database: driver,
  debug: __DEV__,
});

const rootReducer = enhanceReducer({
  todos: todosReducer,
});

// Redux 5's compose() has strict generics that don't infer well with
// multiple enhancers. This explicit annotation is the standard workaround
// for vanilla createStore (RTK's configureStore handles this internally).
const composedEnhancer: StoreEnhancer = compose(
  applyMiddleware(middleware),
  enhanceStore,
);

export const store = createStore(rootReducer, composedEnhancer);

export type RootState = { todos: Todo[] };
export type AppDispatch = typeof store.dispatch;
