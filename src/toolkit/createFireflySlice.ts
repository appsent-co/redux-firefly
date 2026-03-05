import { createSlice } from '@reduxjs/toolkit';
import type {
  ActionReducerMapBuilder,
  CaseReducer,
  PayloadAction,
  Reducer,
} from '@reduxjs/toolkit';
import type { HydrationQuery } from '../types';
import type { HydratedReducer } from '../withHydration';

/**
 * Return type for createFireflySlice.
 * Similar to RTK's Slice but with loosely typed actions since
 * we transform the reducers map internally.
 */
export interface FireflySlice<State, Name extends string = string> {
  name: Name;
  reducer: Reducer<State>;
  actions: Record<string, (...args: any[]) => any>;
  caseReducers: Record<string, (...args: any[]) => any>;
  getInitialState: () => State;
}

/**
 * A reducer definition with optional colocated commit/rollback handlers.
 */
type FireflyReducerDefinition<State> =
  | CaseReducer<State, PayloadAction<any>>
  | {
      reducer: CaseReducer<State, any>;
      prepare: (...args: any[]) => { payload: any; meta?: any; error?: any };
      commit?: CaseReducer<State, any>;
      rollback?: CaseReducer<State, any>;
    };

/**
 * Checks if a reducer definition has firefly commit/rollback handlers.
 */
function isFireflyReducer(
  def: unknown
): def is { reducer: CaseReducer; prepare: (...args: any[]) => any; commit?: CaseReducer; rollback?: CaseReducer } {
  return (
    def !== null &&
    typeof def === 'object' &&
    'prepare' in (def as any) &&
    'reducer' in (def as any) &&
    ('commit' in (def as any) || 'rollback' in (def as any))
  );
}

/**
 * Creates a Redux Toolkit slice with colocated Firefly commit/rollback
 * handlers and optional hydration configuration.
 *
 * Commit/rollback handlers are registered internally via extraReducers
 * and do NOT appear in `slice.actions`. The middleware dispatches them
 * automatically using auto-generated type strings:
 * - Commit: `{sliceName}/{reducerName}/commit`
 * - Rollback: `{sliceName}/{reducerName}/rollback`
 *
 * If `hydration` is provided, the returned `slice.reducer` will have
 * hydration metadata attached (equivalent to wrapping with `withHydration`).
 *
 * @example
 * const todosSlice = createFireflySlice({
 *   name: 'todos',
 *   initialState: [] as Todo[],
 *   hydration: {
 *     query: 'SELECT * FROM todos',
 *     transform: (rows) => rows.map(r => ({ ... })),
 *   },
 *   reducers: {
 *     addTodo: {
 *       reducer: (state, action) => { state.push(action.payload); },
 *       prepare: (text: string) => ({
 *         payload: { ... },
 *         meta: {
 *           firefly: {
 *             effect: { type: 'INSERT', table: 'todos', values: { text } },
 *             commit: { payload: { tempId } },
 *             rollback: { payload: { tempId } },
 *           },
 *         },
 *       }),
 *       commit: (state, action) => { ... },
 *       rollback: (state, action) => { ... },
 *     },
 *   },
 * });
 */
export function createFireflySlice<
  State,
  Name extends string = string,
>(options: {
  name: Name;
  initialState: State | (() => State);
  reducers: Record<string, FireflyReducerDefinition<State>>;
  hydration?: HydrationQuery;
  extraReducers?: (builder: ActionReducerMapBuilder<State>) => void;
}): FireflySlice<State, Name> {
  const { name, reducers, hydration, extraReducers: userExtraReducers, ...rest } = options;

  // Collect commit/rollback handlers with their auto-generated type strings
  const fireflyHandlers: Array<{
    type: string;
    handler: CaseReducer<State, any>;
  }> = [];

  // Build a clean reducers map without commit/rollback properties
  const cleanReducers: Record<string, any> = {};

  for (const [key, def] of Object.entries(reducers as Record<string, any>)) {
    if (isFireflyReducer(def)) {
      const commitType = `${name}/${key}/commit`;
      const rollbackType = `${name}/${key}/rollback`;

      if (def.commit) {
        fireflyHandlers.push({ type: commitType, handler: def.commit });
      }

      if (def.rollback) {
        fireflyHandlers.push({ type: rollbackType, handler: def.rollback });
      }

      // Wrap prepare to auto-inject commit/rollback type strings
      const originalPrepare = def.prepare;
      const wrappedPrepare = (...args: any[]) => {
        const prepared = originalPrepare(...args);
        const firefly = { ...prepared.meta?.firefly };

        if (def.commit) {
          firefly.commit = { ...firefly.commit, type: commitType };
        }

        if (def.rollback) {
          firefly.rollback = { ...firefly.rollback, type: rollbackType };
        }

        return {
          ...prepared,
          meta: { ...prepared.meta, firefly },
        };
      };

      cleanReducers[key] = {
        reducer: def.reducer,
        prepare: wrappedPrepare,
      };
    } else {
      cleanReducers[key] = def;
    }
  }

  const slice = createSlice({
    ...rest,
    name,
    reducers: cleanReducers as any,
    extraReducers: (builder) => {
      for (const { type, handler } of fireflyHandlers) {
        builder.addCase(type, handler as any);
      }

      if (typeof userExtraReducers === 'function') {
        userExtraReducers(builder);
      }
    },
  });

  // Attach hydration metadata to the reducer if provided
  if (hydration) {
    (slice.reducer as unknown as HydratedReducer<State>)._fireflyHydration = hydration;
  }

  return slice as any;
}
