import { expectTypeOf } from 'expect-type';
import { combineSlices, configureStore, createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import type {
  Action,
  Draft,
  PayloadAction,
  Slice,
  SliceCaseReducers,
  UnknownAction,
} from '@reduxjs/toolkit';
import { createFireflySlice, listApply, onCommit, onRollback } from '../src/toolkit';
import type {
  CommitMatcher,
  FireflyCommitAction,
  FireflyCommitted,
  FireflyRollbackAction,
  FireflyRolledBack,
  RollbackMatcher,
} from '../src/toolkit';
import { fireflyHydration } from '../src';
import type { DriverMutationResult, HydratedReducer, OperationResult } from '../src';
import { fakeStatement } from './helpers';

// Type-level tests: they pass by compiling (ts-jest and `yarn typecheck` both
// type-check this file, in strict mode). The slices are real, so the file also
// proves that what compiles builds a slice.

interface Task {
  id: string;
  title: string;
}
interface TaskEvent {
  taskId: string;
  level: number;
}
interface RunResult {
  changes: number;
}
interface TasksState {
  list: Task[];
  count: number;
}

const initialState: TasksState = { list: [], count: 0 };

/** For code that only has to compile, or not to: type-checked, never run. */
function typeOnly(_check: () => void): void {}

const insertTask = (task: Task) => fakeStatement<Task[]>([task]);
const insertEvent = (_event: TaskEvent) => fakeStatement<RunResult>({ changes: 1 });
const run = () => fakeStatement<RunResult>({ changes: 1 });

type NewTaskPayload = { task: Task; event: TaskEvent; assignees: string[] };

const tasksSlice = createFireflySlice({
  name: 'tasks',
  initialState,
  reducers: (fireflyReducer) => ({
    // A plain case reducer, next to the firefly ones.
    counted: (state, action: PayloadAction<number>) => {
      state.count += action.payload;
    },

    // Record effect, written prepare first.
    addTask: fireflyReducer({
      prepare: (task: Task, level: number) => ({
        payload: { task, event: { taskId: task.id, level }, assignees: [] as string[] },
      }),
      reducer: (state, action) => {
        expectTypeOf(state).toEqualTypeOf<Draft<TasksState>>();
        expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
        state.list.push(action.payload.task);
      },
      effect: (payload) => {
        expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
        return {
          task: insertTask(payload.task),
          seed: insertEvent(payload.event),
          assignees: payload.assignees.length > 0 ? run() : undefined,
          links: payload.assignees.map(() => run()),
          removed: payload.assignees.length === 0 && run(),
        };
      },
      commit: (state, { payload, results }) => {
        expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
        // single slot → that statement's result
        expectTypeOf(results.task).toEqualTypeOf<Task[]>();
        expectTypeOf(results.seed).toEqualTypeOf<RunResult>();
        // conditional slot → the result, or undefined when it was skipped
        expectTypeOf(results.assignees).toEqualTypeOf<RunResult | undefined>();
        expectTypeOf(results.removed).toEqualTypeOf<RunResult | undefined>();
        // list slot → an array
        expectTypeOf(results.links).toEqualTypeOf<RunResult[]>();
        // @ts-expect-error — not a slot of this effect
        void results.nope;
        state.list = results.task;
      },
      rollback: (state, action) => {
        expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(action.error).toEqualTypeOf<Error>();
        expectTypeOf(action.meta.firefly.error).toEqualTypeOf<Error>();
        // @ts-expect-error — a rollback carries no results
        void action.results;
        state.list = state.list.filter((task) => task.id !== action.payload.task.id);
      },
    }),

    // Single query, 1.x order (reducer before prepare) and 1.x handlers.
    renameTask: fireflyReducer({
      reducer: (state, action) => {
        expectTypeOf(action.payload).toEqualTypeOf<{ id: string; title: string }>();
        state.count += 1;
      },
      prepare: (id: string, title: string) => ({ payload: { id, title } }),
      effect: (payload) => insertTask({ id: payload.id, title: payload.title }),
      commit: (state, action) => {
        expectTypeOf(action.type).toEqualTypeOf<string>();
        expectTypeOf(action.payload).toEqualTypeOf<{ id: string; title: string }>();
        expectTypeOf(action.meta.firefly.result).toEqualTypeOf<Task[]>();
        // The same results, unpacked.
        expectTypeOf(action.results).toEqualTypeOf<Task[]>();
        state.list = action.meta.firefly.result;
      },
      rollback: (state, { payload, error }) => {
        expectTypeOf(payload).toEqualTypeOf<{ id: string; title: string }>();
        expectTypeOf(error).toEqualTypeOf<Error>();
        state.count -= 1;
      },
    }),

    // Commit-only: no reducer.
    archiveTask: fireflyReducer({
      prepare: (id: string) => ({ payload: { id } }),
      effect: (payload) => ({ archived: run(), id: insertTask({ id: payload.id, title: '' }) }),
      commit: (state, { payload, results }) => {
        expectTypeOf(payload).toEqualTypeOf<{ id: string }>();
        expectTypeOf(results).toEqualTypeOf<{ archived: RunResult; id: Task[] }>();
        state.list = state.list.filter((task) => task.id !== payload.id);
      },
    }),

    // No prepare: the payload type comes from the reducer's annotated action.
    replaceTask: fireflyReducer({
      reducer: (state, action: PayloadAction<Task>) => {
        state.list = [action.payload];
      },
      effect: (payload) => {
        expectTypeOf(payload).toEqualTypeOf<Task>();
        return [insertTask(payload), run()];
      },
      commit: (state, { payload, results }) => {
        expectTypeOf(payload).toEqualTypeOf<Task>();
        // Array form: positional, one OperationResult per query, as in 1.x.
        expectTypeOf(results).toEqualTypeOf<readonly [OperationResult<Task[]>, OperationResult<RunResult>]>();
        state.list = results[0].rows ?? [];
      },
    }),

    // No prepare, an optional payload.
    refresh: fireflyReducer({
      reducer: (state, action: PayloadAction<string | undefined>) => {
        state.count += action.payload?.length ?? 0;
      },
      effect: { sql: 'UPDATE tasks SET seen = 1' },
      commit: (state, { results }) => {
        // Raw SQL effect: the driver's mutation result, as in 1.x.
        expectTypeOf(results).toEqualTypeOf<DriverMutationResult>();
        state.count += results.changes;
      },
    }),

    // No prepare, no reducer, no handler: only an effect.
    purge: fireflyReducer({
      effect: [{ sql: 'DELETE FROM tasks' }, { sql: 'DELETE FROM events' }],
    }),

    // An effect that may be absent: its results are those of when it is not.
    maybeSave: fireflyReducer({
      prepare: (task: Task | null) => ({ payload: { task } }),
      effect: ({ task }) => (task ? { saved: insertTask(task) } : undefined),
      commit: (state, { results }) => {
        expectTypeOf(results).toEqualTypeOf<{ saved: Task[] }>();
        state.list = results.saved;
      },
    }),
  }),
});

const { addTask, renameTask, archiveTask, replaceTask, refresh, purge, maybeSave, counted } = tasksSlice.actions;

describe('createFireflySlice action creators', () => {
  it('keep the arguments of prepare', () => {
    expectTypeOf(addTask).parameters.toEqualTypeOf<[task: Task, level: number]>();
    expectTypeOf(renameTask).parameters.toEqualTypeOf<[id: string, title: string]>();
    expectTypeOf(archiveTask).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(maybeSave).parameters.toEqualTypeOf<[task: Task | null]>();

    // @ts-expect-error — level is missing
    addTask({ id: 't1', title: 'Sweep' });
    // @ts-expect-error — level is a number
    addTask({ id: 't1', title: 'Sweep' }, 'high');
  });

  it('take the payload itself when there is no prepare', () => {
    expectTypeOf(replaceTask).parameters.toEqualTypeOf<[payload: Task]>();
    expectTypeOf(replaceTask({ id: 't1', title: 'Sweep' }).payload).toEqualTypeOf<Task>();
    // @ts-expect-error — the payload is required
    replaceTask();

    // A payload that may be undefined is optional.
    expectTypeOf(refresh).parameters.toEqualTypeOf<[payload?: string | undefined]>();
    refresh();
    refresh('all');

    // Nothing says what the payload is: anything goes, as with createSlice.
    purge();
    purge({ anything: true });
  });

  it('return a typed action, with the slice-qualified type', () => {
    const action = addTask({ id: 't1', title: 'Sweep' }, 2);

    expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
    expectTypeOf(action.type).toEqualTypeOf<'tasks/addTask'>();
    expectTypeOf(addTask.type).toEqualTypeOf<'tasks/addTask'>();
    expectTypeOf(renameTask.type).toEqualTypeOf<'tasks/renameTask'>();
    expect(addTask.type).toBe('tasks/addTask');
  });

  it('leave a plain case reducer as Redux Toolkit types it, without matchers', () => {
    expectTypeOf(counted).parameters.toEqualTypeOf<[payload: number]>();
    expectTypeOf(counted(1)).toEqualTypeOf<{ payload: number; type: 'tasks/counted' }>();
    expectTypeOf(counted).not.toHaveProperty('commit');
    expectTypeOf(counted).not.toHaveProperty('rollback');

    // @ts-expect-error — a plain case reducer has no commit
    void counted.commit;
    // @ts-expect-error — nor a rollback
    void counted.rollback;
  });
});

describe('commit and rollback matcher types', () => {
  type AddTaskResults = {
    task: Task[];
    seed: RunResult;
    assignees: RunResult | undefined;
    links: RunResult[];
    removed: RunResult | undefined;
  };

  it('carry the payload and the results of each reducer', () => {
    expectTypeOf(addTask.commit).toEqualTypeOf<CommitMatcher<NewTaskPayload, AddTaskResults>>();
    expectTypeOf(addTask.rollback).toEqualTypeOf<RollbackMatcher<NewTaskPayload>>();

    expectTypeOf(renameTask.commit).toEqualTypeOf<CommitMatcher<{ id: string; title: string }, Task[]>>();
    expectTypeOf(archiveTask.commit).toEqualTypeOf<
      CommitMatcher<{ id: string }, { archived: RunResult; id: Task[] }>
    >();
    expectTypeOf(replaceTask.commit).toEqualTypeOf<
      CommitMatcher<Task, readonly [OperationResult<Task[]>, OperationResult<RunResult>]>
    >();
    expectTypeOf(refresh.commit).toEqualTypeOf<CommitMatcher<string | undefined, DriverMutationResult>>();
    expectTypeOf(purge.commit.unpack).returns.toHaveProperty('results').toEqualTypeOf<OperationResult[]>();
    expectTypeOf(maybeSave.commit).toEqualTypeOf<CommitMatcher<{ task: Task | null }, { saved: Task[] }>>();

    expectTypeOf(addTask.commit.type).toEqualTypeOf<string>();
    expectTypeOf(addTask.rollback.type).toEqualTypeOf<string>();
  });

  const task: Task = { id: 't1', title: 'Sweep' };
  const payload: NewTaskPayload = { task, event: { taskId: 't1', level: 2 }, assignees: [] };

  it('unpack a commit into { payload, results }', () => {
    const action: UnknownAction = {
      type: addTask.commit.type,
      payload,
      meta: { firefly: { result: { task: [task], seed: { changes: 1 }, links: [] } } },
    };
    const unpacked = addTask.commit.unpack(action);

    expectTypeOf(unpacked).toEqualTypeOf<FireflyCommitted<NewTaskPayload, AddTaskResults>>();
    expectTypeOf(unpacked.payload.event.level).toEqualTypeOf<number>();
    expectTypeOf(unpacked.results.task).toEqualTypeOf<Task[]>();
    expectTypeOf(unpacked.results.assignees).toEqualTypeOf<RunResult | undefined>();
    // @ts-expect-error — not a slot of this effect
    void unpacked.results.nope;
    // @ts-expect-error — a commit carries no error
    void unpacked.error;
  });

  it('unpack a rollback into { payload, error }', () => {
    const action: UnknownAction = {
      type: addTask.rollback.type,
      payload,
      meta: { firefly: { error: new Error('disk full') } },
    };
    const unpacked = addTask.rollback.unpack(action);

    expectTypeOf(unpacked).toEqualTypeOf<FireflyRolledBack<NewTaskPayload>>();
    expectTypeOf(unpacked.error).toEqualTypeOf<Error>();
    expectTypeOf(unpacked.payload.task).toEqualTypeOf<Task>();
    // @ts-expect-error — a rollback carries no results
    void unpacked.results;
  });

  it('take an action, not anything', () => {
    addTask.commit.unpack({} as Action);
    addTask.commit.unpack({} as FireflyCommitAction);
    addTask.rollback.unpack({} as FireflyRollbackAction);

    // @ts-expect-error — a string is no action
    expect(() => addTask.commit.unpack('tasks/addTask/commit')).not.toThrow();
    // @ts-expect-error — nor is an object without a type
    expect(() => addTask.rollback.unpack({ payload: 1 })).not.toThrow();
  });

  it('narrow with match', () => {
    const action: unknown = { type: 'something/else' };

    if (addTask.commit.match(action)) {
      expectTypeOf(action).toEqualTypeOf<FireflyCommitAction<NewTaskPayload, AddTaskResults> & UnknownAction>();
      expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
      expectTypeOf(action.meta.firefly.result.seed).toEqualTypeOf<RunResult>();
      expectTypeOf(addTask.commit.unpack(action).results.seed).toEqualTypeOf<RunResult>();

      // What it narrows to is the commit action, for code typed against it.
      const commit: FireflyCommitAction<NewTaskPayload, AddTaskResults> = action;
      void commit;
    }
    if (addTask.rollback.match(action)) {
      expectTypeOf(action).toEqualTypeOf<FireflyRollbackAction<NewTaskPayload> & UnknownAction>();
      expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
      expectTypeOf(action.meta.firefly.error).toEqualTypeOf<Error>();

      const rollback: FireflyRollbackAction<NewTaskPayload> = action;
      void rollback;
    }
  });

  it('work as a listener matcher, like the match of a Redux Toolkit action creator', () => {
    const listener = createListenerMiddleware();

    listener.startListening({
      matcher: addTask.commit.match,
      effect: (action) => {
        expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(action.meta.firefly.result.task).toEqualTypeOf<Task[]>();
        expectTypeOf(addTask.commit.unpack(action).results.links).toEqualTypeOf<RunResult[]>();
      },
    });
    listener.startListening({
      matcher: addTask.rollback.match,
      effect: (action) => {
        expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(action.meta.firefly.error).toEqualTypeOf<Error>();
      },
    });

    // Several writes at once. (Built first: Redux Toolkit does not infer the
    // action from an isAnyOf written inline, for its own action creators either.)
    const settled = isAnyOf(renameTask.commit, archiveTask.commit);
    listener.startListening({
      matcher: settled,
      effect: (action) => {
        expectTypeOf(action.payload).toEqualTypeOf<{ id: string; title: string } | { id: string }>();
      },
    });
  });

  it('work as a listener predicate, the way an app listens for a commit', () => {
    const listener = createListenerMiddleware();

    listener.startListening({
      predicate: (action) => addTask.commit.match(action),
      effect: (action) => {
        const { payload, results } = addTask.commit.unpack(action);
        expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(results.task).toEqualTypeOf<Task[]>();
      },
    });
    listener.startListening({
      predicate: (action) => addTask.rollback.match(action),
      effect: (action) => {
        expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(addTask.rollback.unpack(action).error).toEqualTypeOf<Error>();
      },
    });
  });

  it('work with the matcher utilities of Redux Toolkit', () => {
    // A matcher is `{ match }`, which isAnyOf takes as is.
    const settled = isAnyOf(renameTask.commit, archiveTask.commit);
    const action: unknown = { type: 'something/else' };
    if (settled(action)) {
      expectTypeOf(action.payload).toEqualTypeOf<{ id: string; title: string } | { id: string }>();
    }

    createFireflySlice({
      name: 'matched',
      initialState: { settled: 0 },
      reducers: () => ({}),
      extraReducers: (builder) => {
        builder.addMatcher(addTask.commit.match, (state, matched) => {
          expectTypeOf(matched.meta.firefly.result.task).toEqualTypeOf<Task[]>();
          state.settled += 1;
        });
        builder.addMatcher(isAnyOf(addTask.rollback, renameTask.rollback), (state, matched) => {
          expectTypeOf(matched.meta.firefly.error).toEqualTypeOf<Error>();
          state.settled += 1;
        });
      },
    });
  });

  it('can be taken generically, by a helper that awaits any write', () => {
    type WriteCreator<Args extends unknown[], P, R> = ((...args: Args) => { type: string; payload: P }) & {
      commit: CommitMatcher<P, R>;
      rollback: RollbackMatcher<P>;
    };
    type Outcome<R> = { committed: true; results: R } | { committed: false; error: Error };

    // The shape of a "dispatch and wait for the commit or the rollback" helper.
    function outcomeOf<Args extends unknown[], P, R>(
      creator: WriteCreator<Args, P, R>,
      settled: UnknownAction,
      ..._args: Args
    ): Outcome<R> {
      return creator.commit.match(settled)
        ? { committed: true, results: creator.commit.unpack(settled).results }
        : { committed: false, error: creator.rollback.unpack(settled).error };
    }

    const settled: UnknownAction = { type: renameTask.commit.type, payload: { id: 't1', title: 'Mop' } };
    expectTypeOf(outcomeOf(addTask, settled, task, 1)).toEqualTypeOf<Outcome<AddTaskResults>>();
    expectTypeOf(outcomeOf(renameTask, settled, 't1', 'Mop')).toEqualTypeOf<Outcome<Task[]>>();
    expect(outcomeOf(renameTask, settled, 't1', 'Mop').committed).toBe(true);
    expect(outcomeOf(addTask, settled, task, 1).committed).toBe(false);
    typeOnly(() => {
      // @ts-expect-error — the creator's own arguments are checked
      outcomeOf(renameTask, settled, 't1');
      // @ts-expect-error — a plain case reducer's creator is no write
      outcomeOf(counted, settled, 1);
    });

    // The payload and results of a write, read off its matcher.
    type Unpacked = ReturnType<typeof archiveTask.commit.unpack> extends { payload: infer P; results: infer R }
      ? { payload: P; results: R }
      : never;
    expectTypeOf<Unpacked>().toEqualTypeOf<{ payload: { id: string }; results: { archived: RunResult; id: Task[] } }>();
  });
});

describe('onCommit and onRollback types', () => {
  it('type the handler from the creator, in another slice', () => {
    const slice = createFireflySlice({
      name: 'mirror',
      initialState: { ids: [] as string[] },
      reducers: () => ({}),
      extraReducers: (builder) => {
        onCommit(builder, addTask, (state, { payload, results }) => {
          expectTypeOf(state).toEqualTypeOf<Draft<{ ids: string[] }>>();
          expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
          expectTypeOf(results.task).toEqualTypeOf<Task[]>();
          expectTypeOf(results.links).toEqualTypeOf<RunResult[]>();
          // @ts-expect-error — not a slot of this effect
          void results.nope;
          state.ids.push(payload.task.id);
        });
        onCommit(builder, renameTask, (state, committed) => {
          expectTypeOf(committed).toEqualTypeOf<FireflyCommitted<{ id: string; title: string }, Task[]>>();
        });
        onRollback(builder, addTask, (state, { payload, error }) => {
          expectTypeOf(state).toEqualTypeOf<Draft<{ ids: string[] }>>();
          expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
          expectTypeOf(error).toEqualTypeOf<Error>();
          state.ids = state.ids.filter((id) => id !== payload.task.id);
        });
        onRollback(builder, archiveTask, (state, rolledBack) => {
          expectTypeOf(rolledBack).toEqualTypeOf<FireflyRolledBack<{ id: string }>>();
          // @ts-expect-error — a rollback carries no results
          void rolledBack.results;
        });

        typeOnly(() => {
          // @ts-expect-error — a plain case reducer's creator has no commit
          onCommit(builder, counted, () => {});
          // @ts-expect-error — nor a rollback
          onRollback(builder, counted, () => {});
          // @ts-expect-error — the handler must return this slice's state, or nothing
          onCommit(builder, addTask, () => ({ ids: 'not an array' }));
        });
      },
    });

    expectTypeOf(slice.getInitialState()).toEqualTypeOf<{ ids: string[] }>();
  });

  it('type the handler from the creator, in the slice the write belongs to', () => {
    const audit = createFireflySlice({
      name: 'audit',
      initialState: { entries: [] as string[] },
      reducers: (fireflyReducer) => ({
        record: fireflyReducer({
          prepare: (what: string) => ({ payload: { what } }),
          effect: () => ({ row: run() }),
        }),
      }),
      extraReducers: (builder) => {
        // The slice refers to its own creator: the callback runs lazily.
        onCommit(builder, audit.actions.record, (state, { payload, results }) => {
          expectTypeOf(payload).toEqualTypeOf<{ what: string }>();
          expectTypeOf(results).toEqualTypeOf<{ row: RunResult }>();
          state.entries.push(payload.what);
        });
        onRollback(builder, audit.actions.record, (state, { payload, error }) => {
          expectTypeOf(payload).toEqualTypeOf<{ what: string }>();
          state.entries.push(error.message);
        });
      },
    });

    expectTypeOf(audit.actions.record).parameters.toEqualTypeOf<[what: string]>();
  });
});

describe('fireflyReducer definition types', () => {
  it('reject what is not part of a definition', () => {
    createFireflySlice({
      name: 'strict',
      initialState,
      reducers: (fireflyReducer) => ({
        save: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: () => run(),
          // @ts-expect-error — not a field of a firefly reducer
          failure: { titleKey: 'a', messageKey: 'b' },
        }),
        // @ts-expect-error — the effect is required
        noEffect: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          reducer: (state) => {
            state.count += 1;
          },
        }),
        wrongState: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: () => run(),
          // @ts-expect-error — a handler returns the slice's state, or nothing
          commit: () => ({ list: 'not an array', count: 0 }),
        }),
      }),
    });
  });

  it('type the results from the effect only when it is written before commit', () => {
    const slice = createFireflySlice({
      name: 'ordered',
      initialState,
      reducers: (fireflyReducer) => ({
        effectFirst: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: (payload) => ({ row: insertTask({ id: payload.id, title: '' }) }),
          commit: (state, { results }) => {
            expectTypeOf(results).toEqualTypeOf<{ row: Task[] }>();
          },
        }),
        // TypeScript reads an object's callbacks top to bottom: a commit above
        // the effect function is typed before the effect is known.
        commitFirst: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          commit: (state, { payload, results }) => {
            expectTypeOf(payload).toEqualTypeOf<{ id: string }>();
            expectTypeOf(results).toBeAny();
          },
          effect: (payload) => ({ row: insertTask({ id: payload.id, title: '' }) }),
        }),
        // An effect that is a value, not a function, can sit anywhere.
        staticEffectLast: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          commit: (state, { results }) => {
            expectTypeOf(results).toEqualTypeOf<{ row: RunResult }>();
          },
          effect: { row: run() },
        }),
      }),
    });

    expectTypeOf(slice.actions.effectFirst.commit.unpack).returns.toEqualTypeOf<
      FireflyCommitted<{ id: string }, { row: Task[] }>
    >();
  });

  it('type the payload of every callback from prepare', () => {
    createFireflySlice({
      name: 'typed',
      initialState,
      reducers: (fireflyReducer) => ({
        save: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          reducer: (state, action) => {
            // @ts-expect-error — the payload has no title
            void action.payload.title;
          },
          effect: (payload) => {
            // @ts-expect-error — the payload has no title
            void payload.title;
            return run();
          },
          commit: (state, { payload, results }) => {
            // @ts-expect-error — the payload has no title
            void payload.title;
            // @ts-expect-error — a single query's result is not a record
            void results.task;
          },
          rollback: (state, { payload }) => {
            // @ts-expect-error — the payload has no title
            void payload.title;
          },
        }),
      }),
    });
  });
});

describe('record effect slots, checked at compile time', () => {
  type Guarded = { ids: string[]; name: string; count: bigint; flag: boolean };
  const guarded = (ids: string[], name: string) => ({ payload: { ids, name, count: 0n, flag: true } });

  it('types a slot guarded by a number, a string or a bigint, like one guarded by a boolean', () => {
    const slice = createFireflySlice({
      name: 'guarded',
      initialState,
      reducers: (fireflyReducer) => ({
        save: fireflyReducer({
          prepare: guarded,
          effect: (payload) => {
            expectTypeOf(payload).toEqualTypeOf<Guarded>();
            return {
              task: insertTask({ id: 't1', title: payload.name }),
              removed: payload.ids.length && run(),
              renamed: payload.name && insertTask({ id: 't1', title: payload.name }),
              counted: payload.count && run(),
              flagged: payload.flag && run(),
            };
          },
          commit: (state, { results }) => {
            expectTypeOf(results).not.toBeAny();
            expectTypeOf(results.task).toEqualTypeOf<Task[]>();
            expectTypeOf(results.removed).toEqualTypeOf<RunResult | undefined>();
            expectTypeOf(results.renamed).toEqualTypeOf<Task[] | undefined>();
            expectTypeOf(results.counted).toEqualTypeOf<RunResult | undefined>();
            expectTypeOf(results.flagged).toEqualTypeOf<RunResult | undefined>();
            // @ts-expect-error — not a slot of this effect
            void results.nope;
            state.list = results.task;
          },
        }),
      }),
    });

    expectTypeOf(slice.actions.save.commit.unpack).returns.toHaveProperty('results').toEqualTypeOf<{
      task: Task[];
      removed: RunResult | undefined;
      renamed: Task[] | undefined;
      counted: RunResult | undefined;
      flagged: RunResult | undefined;
    }>();
  });

  it('types a record that a helper returns as an interface', () => {
    interface SaveEffects {
      task: ReturnType<typeof insertTask>;
      seed: ReturnType<typeof run> | undefined;
    }
    const saveEffects = (task: Task): SaveEffects => ({ task: insertTask(task), seed: undefined });

    const slice = createFireflySlice({
      name: 'helped',
      initialState,
      reducers: (fireflyReducer) => ({
        save: fireflyReducer({
          prepare: (task: Task) => ({ payload: task }),
          effect: (payload) => saveEffects(payload),
          commit: (state, { results }) => {
            expectTypeOf(results).not.toBeAny();
            expectTypeOf(results).toEqualTypeOf<{ task: Task[]; seed: RunResult | undefined }>();
            state.list = results.task;
          },
        }),
      }),
    });

    expectTypeOf(slice.actions.save.commit.unpack).returns.toHaveProperty('results').not.toBeAny();
  });

  it('rejects a slot that is not a statement, instead of typing the results as any', () => {
    createFireflySlice({
      name: 'rejected',
      initialState,
      reducers: (fireflyReducer) => ({
        promiseSlot: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — a Promise is not a statement
          effect: () => ({ task: Promise.resolve([] as Task[]), seed: run() }),
        }),
        builderSlot: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — a query builder that was not called
          effect: () => ({ task: insertTask, seed: run() }),
        }),
        stringSlot: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — SQL goes in a SQL effect, { sql }
          effect: () => ({ task: 'DELETE FROM tasks', seed: run() }),
        }),
        truthySlot: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — a guard that can leave `true` behind
          effect: (payload) => ({ task: payload.id === 't1' || run() }),
        }),
        skippedInList: fireflyReducer({
          prepare: (flag: boolean) => ({ payload: { flag } }),
          // @ts-expect-error — a list slot holds statements only; skip the whole slot instead
          effect: (payload) => ({ links: [payload.flag && run(), run()] }),
        }),
        staticRecord: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — checked for a static effect too
          effect: { task: Promise.resolve([] as Task[]), seed: run() },
        }),
        slotNamedSql: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — an object with a `sql` key is a SQL effect
          effect: () => ({ sql: run(), seed: run() }),
        }),
      }),
    });
  });

  it('rejects an effect that is a Promise', () => {
    createFireflySlice({
      name: 'awaited',
      initialState,
      reducers: (fireflyReducer) => ({
        asyncEffect: fireflyReducer({
          prepare: (task: Task) => ({ payload: task }),
          // @ts-expect-error — return the query itself, not a Promise of it
          effect: async (payload) => insertTask(payload),
        }),
        ranEffect: fireflyReducer({
          prepare: (task: Task) => ({ payload: task }),
          // @ts-expect-error — the query was run: this is a Promise of its result
          effect: (payload) => Promise.resolve(insertTask(payload)).then((rows) => rows.length),
        }),
      }),
    });
  });

  it('leaves the other effect forms as 1.x typed them', () => {
    createFireflySlice({
      name: 'lenient',
      initialState,
      reducers: (fireflyReducer) => ({
        // A SQL effect written inline, alone and in a record.
        rawWithParams: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: (payload) => ({ sql: 'DELETE FROM tasks WHERE id = ?', params: [payload.id] }),
        }),
        rawRecord: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: (payload) => ({
            removed: { sql: 'DELETE FROM tasks WHERE id = ?', params: [payload.id] },
            touched: [{ sql: 'UPDATE lists SET n = n - 1' }],
          }),
        }),
        // An array is positional: its entries are not checked as slots.
        guardedArray: fireflyReducer({
          prepare: (flag: boolean) => ({ payload: { flag } }),
          effect: (payload) => [payload.flag && run(), run()],
          commit: (_state, { results }) => {
            expectTypeOf(results).toBeAny();
          },
        }),
        // An effect that may be absent, or falsy.
        guardedQuery: fireflyReducer({
          prepare: (ids: string[]) => ({ payload: { ids } }),
          effect: (payload) => payload.ids.length && run(),
        }),
        // An effect whose type is not known.
        untyped: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: (): unknown => run(),
          commit: (_state, { results }) => {
            expectTypeOf(results).toBeAny();
          },
        }),
        untypedAny: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: (): any => run(),
        }),
      }),
    });
  });
});

describe('the slice createFireflySlice returns', () => {
  it('is assignable to a Redux Toolkit Slice', () => {
    const asSlice: Slice<TasksState> = tasksSlice;
    const named: Slice<TasksState, SliceCaseReducers<TasksState>, 'tasks'> = tasksSlice;
    expect(asSlice).toBe(named);

    // Generic code written against Slice infers the case reducers through it.
    function actionsOf<State, CR extends SliceCaseReducers<State>, Name extends string>(
      slice: Slice<State, CR, Name>
    ): Slice<State, CR, Name>['actions'] {
      return slice.actions;
    }
    const actions = actionsOf(tasksSlice);
    expectTypeOf(actions.addTask).parameters.toEqualTypeOf<[task: Task, level: number]>();
    expectTypeOf(actions.counted).parameters.toEqualTypeOf<[payload: number]>();
    expectTypeOf(actions.addTask.type).toEqualTypeOf<'tasks/addTask'>();
  });

  it('keeps the rest of the slice typed as before', () => {
    expectTypeOf(tasksSlice.name).toEqualTypeOf<'tasks'>();
    expectTypeOf(tasksSlice.reducerPath).toEqualTypeOf<'tasks'>();
    expectTypeOf(tasksSlice.getInitialState()).toEqualTypeOf<TasksState>();
    expectTypeOf(tasksSlice.reducer).returns.toEqualTypeOf<TasksState>();
    expectTypeOf(tasksSlice.reducer).parameter(0).toEqualTypeOf<TasksState | undefined>();
    expectTypeOf(tasksSlice.selectSlice({ tasks: initialState })).toEqualTypeOf<TasksState>();
    expectTypeOf(tasksSlice.caseReducers.counted).toBeFunction();
    expectTypeOf(tasksSlice.caseReducers.addTask).toBeFunction();
    expectTypeOf(tasksSlice.caseReducers.addTask).parameter(1).toEqualTypeOf<PayloadAction<NewTaskPayload>>();

    // The reducer can still carry hydration metadata.
    const reducer: HydratedReducer<TasksState> = tasksSlice.reducer;
    expect(typeof reducer).toBe('function');
  });

  it('fits configureStore and combineSlices', () => {
    const store = configureStore({
      reducer: { tasks: tasksSlice.reducer },
      // meta.firefly.effect holds query objects.
      middleware: (getDefault) => getDefault({ serializableCheck: false }),
    });
    expectTypeOf(store.getState()).toEqualTypeOf<{ tasks: TasksState }>();
    expectTypeOf(store.dispatch(addTask({ id: 't1', title: 'Sweep' }, 1)).payload).toEqualTypeOf<NewTaskPayload>();

    const rootReducer = combineSlices(tasksSlice);
    expectTypeOf(rootReducer(undefined, { type: 'init' }).tasks).toEqualTypeOf<TasksState>();
  });
});

describe('createFireflySlice hydration and applyRows types', () => {
  const reducers = () => ({});

  it('types the transform of a single drizzle query', () => {
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<Task[]>([]),
        transform: (rows) => {
          expectTypeOf(rows).toEqualTypeOf<Task[]>();
          return { list: rows, count: rows.length };
        },
      },
    });
  });

  it('types the transform of a tuple of drizzle queries', () => {
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: [fakeStatement<Task[]>([]), fakeStatement<{ n: number }[]>([])],
        transform: (results) => {
          expectTypeOf(results).toEqualTypeOf<
            readonly [OperationResult<Task[]>, OperationResult<{ n: number }[]>]
          >();
          return { list: results[0].rows ?? [], count: results[1].rows?.[0].n ?? 0 };
        },
      },
    });
  });

  it('accepts fireflyHydration, eager or lazy', () => {
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: fireflyHydration(
        () => [fakeStatement<Task[]>([]), fakeStatement<{ n: number }[]>([])],
        (results): TasksState => {
          expectTypeOf(results[1]).toEqualTypeOf<OperationResult<{ n: number }[]>>();
          return { list: results[0].rows ?? [], count: 0 };
        }
      ),
    });
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: fireflyHydration(fakeStatement<Task[]>([]), (rows): TasksState => ({ list: rows, count: 0 })),
    });
  });

  it('accepts a SQL hydration, and none', () => {
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: { query: 'SELECT * FROM tasks', params: [1, 'a', null], transform: (rows) => ({ list: rows, count: 0 }) },
    });
    createFireflySlice({ name: 'tasks', initialState, reducers });
  });

  it('rejects a hydration that does not give the slice state', () => {
    // @ts-expect-error — the transform does not return the slice's state
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<Task[]>([]),
        transform: (rows) => ({ list: rows, count: 'many' }),
      },
    });
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      // @ts-expect-error — neither SQL nor a drizzle query
      hydration: { query: 42 },
    });
  });

  it('rejects a drizzle transform annotated with rows the query does not return', () => {
    // No overload takes it: not the typed one, and not the one a wrapper forwards through.
    // @ts-expect-error — the query returns TaskEvent[], not Task[]
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<TaskEvent[]>([]),
        transform: (rows: Task[]) => ({ list: rows, count: rows.length }),
      },
    });
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: [fakeStatement<Task[]>([]), fakeStatement<TaskEvent[]>([])],
        // @ts-expect-error — nor does the second query of the tuple
        transform: (results: readonly [OperationResult<Task[]>, OperationResult<Task[]>]) => ({
          list: results[1].rows ?? [],
          count: 0,
        }),
      },
    });

    // Annotated with what the query does return, it is fine.
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<Task[]>([]),
        transform: (rows: Task[]) => ({ list: rows, count: rows.length }),
      },
    });
  });

  it('types applyRows by the slice state', () => {
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      applyRows: {
        table: 'tasks',
        apply: (state, changes) => {
          expectTypeOf(state).toEqualTypeOf<TasksState>();
          return { ...state, count: state.count + changes.upserts.length };
        },
      },
    });
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      applyRows: {
        table: 'tasks',
        apply: listApply<Task, TasksState>({
          toItem: (row) => ({ id: String(row.key), title: '' }),
          getId: (task) => task.id,
          listKey: 'list',
        }),
      },
    });
    createFireflySlice({
      name: 'tasks',
      initialState,
      reducers,
      applyRows: {
        table: 'tasks',
        // @ts-expect-error — apply returns the slice's state
        apply: (state) => state.list,
      },
    });
  });
});

describe('a slice written for 1.x', () => {
  // As the README and the example app wrote them: reducer first, handlers
  // reading the dispatched action, raw SQL with params, arrays of effects.
  interface Todo {
    id: number | string;
    text: string;
    completed: boolean;
    syncing?: boolean;
  }

  const todosSlice = createFireflySlice({
    name: 'todos',
    initialState: [] as Todo[],
    hydration: {
      query: 'SELECT * FROM todos ORDER BY created_at DESC',
      transform: (rows: any[]): Todo[] =>
        rows.map((row) => ({ id: row.id, text: row.text, completed: Boolean(row.completed) })),
    },
    reducers: (fireflyReducer) => ({
      addTodo: fireflyReducer({
        reducer: (state, action) => {
          state.push(action.payload);
        },
        prepare: (text: string) => ({
          payload: { id: `temp_${text}`, text, completed: false, syncing: true } as Todo,
        }),
        effect: (payload) => ({
          sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)',
          params: [payload.text, 0],
        }),
        commit: (state, action) => {
          const todo = state.find((t) => t.id === action.payload.id);
          if (todo) {
            todo.id = action.meta.firefly.result?.lastInsertRowId ?? todo.id;
            todo.syncing = false;
          }
        },
        rollback: (state, action) => {
          return state.filter((t) => t.id !== action.payload.id);
        },
      }),
      toggleTodo: fireflyReducer({
        reducer: (state, action) => {
          const todo = state.find((t) => t.id === action.payload.id);
          if (todo) todo.completed = !todo.completed;
        },
        prepare: (id: number | string, currentCompleted: boolean) => ({
          payload: { id, currentCompleted },
        }),
        effect: (payload) => fakeStatement<Todo[]>([{ id: payload.id, text: '', completed: !payload.currentCompleted }]),
        commit: (state, action) => {
          const todo = state.find((t) => t.id === action.payload.id);
          if (todo) {
            const row = action.meta.firefly.result[0];
            todo.completed = row.completed;
          }
        },
      }),
      deleteTodo: fireflyReducer({
        reducer: (state, action) => {
          return state.filter((t) => t.id !== action.payload.id);
        },
        prepare: (id: number | string, deletedTodo: Todo) => ({
          payload: { id, deletedTodo },
        }),
        effect: (payload) => ({ sql: 'DELETE FROM todos WHERE id = ?', params: [payload.id] }),
        rollback: (state, action) => {
          state.push(action.payload.deletedTodo);
        },
      }),
      reorderTodos: fireflyReducer({
        reducer: (_state, action) => {
          return action.payload;
        },
        prepare: (todos: Todo[]) => ({ payload: todos.map((todo) => ({ ...todo })) }),
        effect: (payload) => payload.map((todo) => fakeStatement<RunResult>({ changes: Number(todo.id) })),
        commit: (_state, action) => {
          expectTypeOf(action.meta.firefly.result).toEqualTypeOf<OperationResult<RunResult>[]>();
        },
      }),
    }),
  });

  it('still compiles, with the same action creators', () => {
    const { addTodo, toggleTodo, deleteTodo, reorderTodos } = todosSlice.actions;

    expectTypeOf(addTodo).parameters.toEqualTypeOf<[text: string]>();
    expectTypeOf(addTodo('x').payload).toEqualTypeOf<Todo>();
    expectTypeOf(toggleTodo).parameters.toEqualTypeOf<[id: number | string, currentCompleted: boolean]>();
    expectTypeOf(deleteTodo).parameters.toEqualTypeOf<[id: number | string, deletedTodo: Todo]>();
    expectTypeOf(reorderTodos).parameters.toEqualTypeOf<[todos: Todo[]]>();
    expectTypeOf(todosSlice.reducer).returns.toEqualTypeOf<Todo[]>();

    // A raw SQL literal with params keeps `any` results, as in 1.x.
    expectTypeOf(addTodo.commit.unpack).returns.toHaveProperty('results').toBeAny();
    expectTypeOf(toggleTodo.commit.unpack).returns.toHaveProperty('results').toEqualTypeOf<Todo[]>();
  });
});

describe('a commit-only write without prepare', () => {
  it('takes its payload type from the annotated effect parameter', () => {
    const slice = createFireflySlice({
      name: 'counter',
      initialState: { total: 0 },
      reducers: (fireflyReducer) => ({
        bump: fireflyReducer({
          effect: (_payload: { by: number }) => ({ row: run() }),
          commit: (state, { payload, results }) => {
            expectTypeOf(payload).toEqualTypeOf<{ by: number }>();
            expectTypeOf(results).toEqualTypeOf<{ row: RunResult }>();
            state.total += payload.by;
          },
        }),
      }),
    });

    expectTypeOf(slice.actions.bump).parameters.toEqualTypeOf<[payload: { by: number }]>();
    expect(slice.actions.bump({ by: 2 }).payload).toEqual({ by: 2 });
    // @ts-expect-error — the payload is required
    slice.actions.bump();
  });
});
