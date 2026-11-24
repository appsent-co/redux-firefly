import { expectTypeOf } from 'expect-type';
import type { Draft, PayloadAction, Slice } from '@reduxjs/toolkit';
import { listApply, onCommit, onRollback } from '../src/toolkit';
import type { CommitMatcher, RollbackMatcher } from '../src/toolkit';
import { fireflyHydration, isApplyRowsReducer, isHydratedReducer } from '../src';
import type { HydratedReducer, OperationResult } from '../src';
import { createFailureSlice, failureCopyOf, type FailureCopy } from './fixtures/failure-slice';
import {
  createTestStore,
  failingStatement,
  fakeDrizzleDatabase,
  fakeStatement,
  flush,
  type EventLog,
} from './helpers';

// createFireflySlice wrapped by an app (fixtures/failure-slice.ts): every
// reducer may carry `failure` copy, which the wrapper strips and puts on the
// dispatched action as `meta.failure`. The slices below are written against the
// wrapper, with no cast and no type annotation beyond prepare's arguments.

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
  log: string[];
}

const initialState: TasksState = { list: [], log: [] };

const ADD_FAILED: FailureCopy = { titleKey: 'tasks.add.failed.title', messageKey: 'tasks.add.failed.message' };
const REMOVE_FAILED: FailureCopy = { titleKey: 'tasks.remove.failed.title', messageKey: 'tasks.remove.failed.message' };

type NewTaskPayload = { task: Task; event: TaskEvent; assignees: string[]; fail: unknown };
type AddTaskResults = { task: Task[]; seed: RunResult; assignees: RunResult[]; flagged: RunResult | undefined };

function createSlices(events: EventLog = []) {
  const statement = <T>(label: string, result: T, fail?: unknown) =>
    fail === undefined
      ? fakeStatement(result, { label, events })
      : failingStatement<T>(fail, { label, events });

  const tasks = createFailureSlice({
    name: 'tasks',
    initialState,
    hydration: fireflyHydration(
      () => [fakeStatement<Task[]>([{ id: 'seed', title: 'Seed' }]), fakeStatement<{ n: number }[]>([{ n: 1 }])],
      (results): TasksState => {
        expectTypeOf(results).toEqualTypeOf<readonly [OperationResult<Task[]>, OperationResult<{ n: number }[]>]>();
        return { list: results[0].rows ?? [], log: [`hydrated:${results[1].rows?.[0].n}`] };
      }
    ),
    applyRows: {
      table: 'tasks',
      apply: listApply<Task, TasksState>({
        toItem: (row) => ({ id: String(row.key), title: String(row.columns.title ?? '') }),
        getId: (task) => task.id,
        listKey: 'list',
      }),
    },
    reducers: (fireflyReducer) => ({
      // A plain case reducer goes through the wrapper untouched.
      cleared: (state, action: PayloadAction<string>) => {
        state.list = [];
        state.log.push(`cleared:${action.payload}`);
      },

      // A record effect, with failure copy.
      addTask: fireflyReducer({
        prepare: (task: Task, level: number, fail?: unknown) => ({
          payload: { task, event: { taskId: task.id, level }, assignees: ['ada', 'bo'], fail },
        }),
        reducer: (state, action) => {
          expectTypeOf(state).toEqualTypeOf<Draft<TasksState>>();
          expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
          state.list.push(action.payload.task);
        },
        effect: (payload) => {
          expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
          return {
            task: statement<Task[]>('task', [{ ...payload.task, title: payload.task.title.toUpperCase() }], payload.fail),
            seed: statement<RunResult>('seed', { changes: payload.event.level }),
            assignees: payload.assignees.map((name) => statement<RunResult>(`assignee:${name}`, { changes: 1 })),
            flagged: payload.event.level > 5 ? statement<RunResult>('flagged', { changes: 1 }) : undefined,
          };
        },
        commit: (state, { payload, results }) => {
          expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
          expectTypeOf(results).toEqualTypeOf<AddTaskResults>();
          // @ts-expect-error — not a slot of this effect
          void results.nope;
          state.list = state.list.map((task) => (task.id === payload.task.id ? results.task[0] : task));
          state.log.push(`added:${results.seed.changes}:${results.assignees.length}:${String(results.flagged)}`);
        },
        rollback: (state, action) => {
          expectTypeOf(action.payload).toEqualTypeOf<NewTaskPayload>();
          expectTypeOf(action.error).toEqualTypeOf<Error>();
          state.list = state.list.filter((task) => task.id !== action.payload.task.id);
        },
        failure: ADD_FAILED,
      }),

      // Commit-only (no reducer), failure copy, 1.x-style handler.
      removeTask: fireflyReducer({
        prepare: (id: string, fail?: unknown) => ({ payload: { id, fail } }),
        effect: (payload) => statement<RunResult>('remove', { changes: 1 }, payload.fail),
        commit: (state, action) => {
          expectTypeOf(action.meta.firefly.result).toEqualTypeOf<RunResult>();
          expectTypeOf(action.results).toEqualTypeOf<RunResult>();
          state.list = state.list.filter((task) => task.id !== action.payload.id);
        },
        failure: REMOVE_FAILED,
      }),

      // No failure copy, no handlers: fails silently.
      touchTask: fireflyReducer({
        prepare: (id: string, fail?: unknown) => ({ payload: { id, fail } }),
        effect: (payload) => ({ touched: statement<RunResult>('touch', { changes: 1 }, payload.fail) }),
      }),

      // No prepare: the wrapper adds meta.failure to the identity prepare the library fills in.
      renameTask: fireflyReducer({
        reducer: (state, action: PayloadAction<Task & { fail?: unknown }>) => {
          const task = state.list.find((candidate) => candidate.id === action.payload.id);
          if (task) task.title = action.payload.title;
        },
        effect: (payload) => statement<RunResult>('rename', { changes: 1 }, payload.fail),
        failure: { titleKey: 'tasks.rename.failed.title', messageKey: 'tasks.rename.failed.message' },
      }),

      // The wrapper keeps a meta of prepare's own that it does not replace.
      tagTask: fireflyReducer({
        prepare: (id: string, fail?: unknown) => ({ payload: { id, fail }, meta: { requestId: `request-${id}` } }),
        effect: (payload) => statement<RunResult>('tag', { changes: 1 }, payload.fail),
      }),
    }),
  });

  // Another slice, also through the wrapper, reacting to the first one's writes.
  const feed = createFailureSlice({
    name: 'feed',
    initialState: { lines: [] as string[] },
    reducers: () => ({}),
    extraReducers: (builder) => {
      onCommit(builder, tasks.actions.addTask, (state, { payload, results }) => {
        expectTypeOf(state).toEqualTypeOf<Draft<{ lines: string[] }>>();
        expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(results).toEqualTypeOf<AddTaskResults>();
        state.lines.push(`added ${results.task[0].title}`);
      });
      onRollback(builder, tasks.actions.addTask, (state, { payload, error }) => {
        expectTypeOf(payload).toEqualTypeOf<NewTaskPayload>();
        expectTypeOf(error).toEqualTypeOf<Error>();
        state.lines.push(`could not add ${payload.task.title}: ${error.message}`);
      });
      onCommit(builder, tasks.actions.touchTask, (state, { payload, results }) => {
        expectTypeOf(results).toEqualTypeOf<{ touched: RunResult }>();
        state.lines.push(`touched ${payload.id}`);
      });
    },
  });

  return { tasks, feed };
}

async function setup() {
  const events: EventLog = [];
  const slices = createSlices(events);
  const database = fakeDrizzleDatabase({ events });
  const harness = await createTestStore({
    database,
    reducers: { tasks: slices.tasks.reducer, feed: slices.feed.reducer },
  });
  return { ...harness, ...slices, events, database };
}

const sweep: Task = { id: 't1', title: 'Sweep' };

describe('createFireflySlice through a wrapper: types', () => {
  const { tasks } = createSlices();
  const { addTask, removeTask, touchTask, renameTask, cleared } = tasks.actions;

  it('keeps the action creators typed', () => {
    expectTypeOf(addTask).parameters.toEqualTypeOf<[task: Task, level: number, fail?: unknown]>();
    expectTypeOf(addTask(sweep, 1).payload).toEqualTypeOf<NewTaskPayload>();
    expectTypeOf(addTask.type).toEqualTypeOf<'tasks/addTask'>();
    expectTypeOf(removeTask).parameters.toEqualTypeOf<[id: string, fail?: unknown]>();
    expectTypeOf(renameTask).parameters.toEqualTypeOf<[payload: Task & { fail?: unknown }]>();
    expectTypeOf(cleared).parameters.toEqualTypeOf<[payload: string]>();

    // @ts-expect-error — level is missing
    addTask(sweep);
    // @ts-expect-error — the id is a string
    removeTask(1);
  });

  it('keeps the commit and rollback matchers typed, with per-slot results', () => {
    expectTypeOf(addTask.commit).toEqualTypeOf<CommitMatcher<NewTaskPayload, AddTaskResults>>();
    expectTypeOf(addTask.rollback).toEqualTypeOf<RollbackMatcher<NewTaskPayload>>();
    expectTypeOf(removeTask.commit).toEqualTypeOf<CommitMatcher<{ id: string; fail: unknown }, RunResult>>();
    expectTypeOf(touchTask.commit).toEqualTypeOf<CommitMatcher<{ id: string; fail: unknown }, { touched: RunResult }>>();
    expectTypeOf(renameTask.rollback).toEqualTypeOf<RollbackMatcher<Task & { fail?: unknown }>>();

    expectTypeOf(addTask.commit.unpack).returns.toEqualTypeOf<{ payload: NewTaskPayload; results: AddTaskResults }>();
    expectTypeOf(addTask.rollback.unpack).returns.toEqualTypeOf<{ payload: NewTaskPayload; error: Error }>();

    expectTypeOf(cleared).not.toHaveProperty('commit');
    // @ts-expect-error — a plain case reducer has no commit
    void cleared.commit;
  });

  it('keeps the slice typed', () => {
    expectTypeOf(tasks.name).toEqualTypeOf<'tasks'>();
    expectTypeOf(tasks.getInitialState()).toEqualTypeOf<TasksState>();
    expectTypeOf(tasks.reducer).returns.toEqualTypeOf<TasksState>();
    expectTypeOf(tasks.caseReducers.addTask).parameter(1).toEqualTypeOf<PayloadAction<NewTaskPayload>>();

    const asSlice: Slice<TasksState> = tasks;
    const reducer: HydratedReducer<TasksState> = tasks.reducer;
    expect(asSlice.reducer).toBe(reducer);
  });

  it('types the extra field, and nothing else', () => {
    createFailureSlice({
      name: 'strict',
      initialState,
      reducers: (fireflyReducer) => ({
        wrongCopy: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: () => fakeStatement(1),
          // @ts-expect-error — failure copy needs a messageKey
          failure: { titleKey: 'a' },
        }),
        unknownField: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: () => fakeStatement(1),
          // @ts-expect-error — not a field of this wrapper's reducers
          retries: 3,
        }),
      }),
    });
  });

  it('keeps the checks on record effect slots', () => {
    const run = () => fakeStatement<RunResult>({ changes: 1 });

    createFailureSlice({
      name: 'checked',
      initialState,
      reducers: (fireflyReducer) => ({
        guarded: fireflyReducer({
          prepare: (ids: string[]) => ({ payload: { ids } }),
          effect: (payload) => ({ touched: run(), removed: payload.ids.length && run() }),
          commit: (_state, { results }) => {
            expectTypeOf(results).toEqualTypeOf<{ touched: RunResult; removed: RunResult | undefined }>();
          },
          failure: ADD_FAILED,
        }),
        promiseSlot: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — a Promise is not a statement
          effect: () => ({ touched: Promise.resolve(1), removed: run() }),
          failure: ADD_FAILED,
        }),
        asyncEffect: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          // @ts-expect-error — return the query itself, not a Promise of it
          effect: async () => run(),
        }),
      }),
    });
  });

  it('keeps the hydration overloads', () => {
    const reducers = () => ({});

    createFailureSlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<Task[]>([]),
        transform: (rows) => {
          expectTypeOf(rows).toEqualTypeOf<Task[]>();
          return { list: rows, log: [] };
        },
      },
    });
    createFailureSlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: { query: 'SELECT * FROM tasks', transform: (rows) => ({ list: rows, log: [] }) },
    });
    createFailureSlice({ name: 'tasks', initialState, reducers });
    createFailureSlice({
      name: 'tasks',
      initialState,
      reducers,
      // @ts-expect-error — neither SQL nor a drizzle query
      hydration: { query: 42 },
    });
    // @ts-expect-error — the query returns TaskEvent[], not Task[]
    createFailureSlice({
      name: 'tasks',
      initialState,
      reducers,
      hydration: {
        query: fakeStatement<TaskEvent[]>([]),
        transform: (rows: Task[]) => ({ list: rows, log: [] }),
      },
    });
  });
});

describe('createFireflySlice through a wrapper: behaviour', () => {
  it('hydrates and attaches applyRows, passed through unchanged', async () => {
    const { store, tasks } = await setup();

    expect(isHydratedReducer(tasks.reducer)).toBe(true);
    expect(isApplyRowsReducer(tasks.reducer)).toBe(true);
    expect((tasks.reducer as HydratedReducer<TasksState>)._fireflyApplyRows?.table).toBe('tasks');
    expect(store.getState().tasks).toEqual({ list: [{ id: 'seed', title: 'Seed' }], log: ['hydrated:1'] });
  });

  it('puts the failure copy on the dispatched action, next to meta.firefly', async () => {
    const { store, tasks, find } = await setup();

    store.dispatch(tasks.actions.addTask(sweep, 2));
    await flush();

    const dispatched = find('tasks/addTask');
    expect(dispatched.meta.failure).toBe(ADD_FAILED);
    expect(failureCopyOf(dispatched)).toEqual(ADD_FAILED);
    expect(dispatched.meta.firefly).toMatchObject({
      originalPayload: dispatched.payload,
      commit: { type: 'tasks/addTask/commit' },
      rollback: { type: 'tasks/addTask/rollback' },
    });
    expect(Object.keys(dispatched.meta.firefly.effect)).toEqual(['task', 'seed', 'assignees', 'flagged']);
  });

  it('commits the record effect by name, in one transaction', async () => {
    const { store, tasks, find, types, events, database, onError } = await setup();

    store.dispatch(tasks.actions.addTask(sweep, 2));
    await flush();

    expect(types()).toEqual(['tasks/addTask', 'tasks/addTask/commit']);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'task', 'seed', 'assignee:ada', 'assignee:bo', 'commit']);

    // The reducer's own commit handler...
    expect(store.getState().tasks).toEqual({
      list: [{ id: 'seed', title: 'Seed' }, { id: 't1', title: 'SWEEP' }],
      log: ['hydrated:1', 'added:2:2:undefined'],
    });
    // ...another slice's onCommit...
    expect(store.getState().feed.lines).toEqual(['added SWEEP']);
    // ...and unpack all read the same named results.
    const { payload, results } = tasks.actions.addTask.commit.unpack(find('tasks/addTask/commit'));
    expect(payload.task).toBe(sweep);
    expect(results).toEqual({
      task: [{ id: 't1', title: 'SWEEP' }],
      seed: { changes: 2 },
      assignees: [{ changes: 1 }, { changes: 1 }],
    });
    expect(results.flagged).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('hands the failed action, with its failure copy, to onError', async () => {
    const { store, tasks, find, types, onError } = await setup();

    const error = new Error('disk full');
    store.dispatch(tasks.actions.addTask(sweep, 2, error));
    await flush();

    expect(types()).toEqual(['tasks/addTask', 'tasks/addTask/rollback']);
    expect(onError).toHaveBeenCalledTimes(1);
    const [reported, action] = onError.mock.calls[0];
    expect(reported).toBe(error);
    expect(action).toBe(find('tasks/addTask'));
    expect(action.meta.failure).toBe(ADD_FAILED);
    expect(failureCopyOf(action)).toEqual(ADD_FAILED);

    // The rollback reached the reducer's own handler and the other slice's.
    expect(store.getState().tasks.list).toEqual([{ id: 'seed', title: 'Seed' }]);
    expect(store.getState().feed.lines).toEqual(['could not add Sweep: disk full']);
    expect(tasks.actions.addTask.rollback.unpack(find('tasks/addTask/rollback')).error).toBe(error);
  });

  it("keeps the meta of a reducer's own prepare next to the failure copy", async () => {
    const slice = createFailureSlice({
      name: 'tagged',
      initialState,
      reducers: (fireflyReducer) => ({
        tag: fireflyReducer({
          prepare: (id: string) => ({ payload: { id }, meta: { requestId: `request-${id}` } }),
          effect: () => failingStatement<RunResult>(new Error('read only')),
          failure: ADD_FAILED,
        }),
      }),
    });
    const { store, onError } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { tagged: slice.reducer },
    });

    const dispatched = store.dispatch(slice.actions.tag('t1')) as unknown as { meta: Record<string, unknown> };
    await flush();

    expect(dispatched.meta).toEqual({
      requestId: 'request-t1',
      failure: ADD_FAILED,
      firefly: expect.any(Object),
    });
    const failed = onError.mock.calls[0][1];
    expect(failed.meta.requestId).toBe('request-t1');
    expect(failureCopyOf(failed)).toEqual(ADD_FAILED);
  });

  it('gives each reducer its own failure copy', async () => {
    const { store, tasks, onError } = await setup();

    store.dispatch(tasks.actions.removeTask('seed', 'locked'));
    store.dispatch(tasks.actions.renameTask({ id: 'seed', title: 'Renamed', fail: 'read only' }));
    await flush();

    expect(onError).toHaveBeenCalledTimes(2);
    expect(failureCopyOf(onError.mock.calls[0][1])).toEqual(REMOVE_FAILED);
    expect(onError.mock.calls[0][0]).toEqual(new Error('locked'));
    // The reducer without a prepare: its payload is the creator's argument.
    const renameAction = onError.mock.calls[1][1] as unknown as { payload: unknown };
    expect(failureCopyOf(renameAction)).toEqual({
      titleKey: 'tasks.rename.failed.title',
      messageKey: 'tasks.rename.failed.message',
    });
    expect(renameAction.payload).toEqual({ id: 'seed', title: 'Renamed', fail: 'read only' });
  });

  it('leaves a reducer without failure copy as the library made it', async () => {
    const { store, tasks, find, onError } = await setup();

    store.dispatch(tasks.actions.touchTask('seed', 'nope'));
    store.dispatch(tasks.actions.tagTask('seed', 'nope'));
    await flush();

    const touched = find('tasks/touchTask');
    expect(Object.keys(touched.meta)).toEqual(['firefly']);
    expect(failureCopyOf(touched)).toBeUndefined();
    // A meta of prepare's own still passes through.
    expect(find('tasks/tagTask').meta.requestId).toBe('request-seed');
    expect(onError).toHaveBeenCalledTimes(2);
    expect(failureCopyOf(onError.mock.calls[0][1])).toBeUndefined();
  });

  it('runs a commit-only write and a handler-less one', async () => {
    const { store, tasks, types } = await setup();

    store.dispatch(tasks.actions.removeTask('seed'));
    // Commit-only: nothing changes until the write has landed.
    expect(store.getState().tasks.list).toEqual([{ id: 'seed', title: 'Seed' }]);
    store.dispatch(tasks.actions.touchTask('seed'));
    await flush();

    expect(store.getState().tasks.list).toEqual([]);
    expect(types()).toEqual([
      'tasks/removeTask',
      'tasks/touchTask',
      'tasks/removeTask/commit',
      'tasks/touchTask/commit',
    ]);
    // The handler-less write's commit is still dispatched, for the other slice to fold.
    expect(store.getState().feed.lines).toEqual(['touched seed']);
  });

  it('carries the matchers on every firefly action creator', () => {
    const { tasks } = createSlices();

    for (const key of ['addTask', 'removeTask', 'touchTask', 'renameTask', 'tagTask'] as const) {
      expect(tasks.actions[key].commit.type).toBe(`tasks/${key}/commit`);
      expect(tasks.actions[key].rollback.type).toBe(`tasks/${key}/rollback`);
    }
    expect('commit' in tasks.actions.cleared).toBe(false);
  });
});
