import type { PayloadAction } from '@reduxjs/toolkit';
import { createFireflySlice, onCommit, onRollback } from '../src/toolkit';
import { isApplyRowsReducer, isEmptyEffect, isFireflyAction, isHydratedReducer, listApply } from '../src';
import type { FireflyChangeEvent, HydratedReducer, MergedRow } from '../src';
import {
  createTestStore,
  failingStatement,
  fakeDriver,
  fakeDrizzleDatabase,
  fakeStatement,
  flush,
  type EventLog,
} from './helpers';

interface Task {
  id: string;
  title: string;
  saved?: boolean;
}

interface RunResult {
  changes: number;
}

interface TasksState {
  list: Task[];
  /** What the handlers saw, in order. */
  log: string[];
}

const initialState: TasksState = { list: [], log: [] };

/** A write's statement: resolves to `result`, or rejects with `fail` when it is given. */
function statement<T>(result: T, options: { fail?: unknown; label?: string; events?: EventLog } = {}) {
  const { fail, ...rest } = options;
  return fail === undefined ? fakeStatement(result, rest) : failingStatement<T>(fail, rest);
}

/**
 * A slice of writes with no handlers at all, next to a plain case reducer:
 * what the matchers do must not depend on the reducer defining anything.
 */
function createBareSlice() {
  return createFireflySlice({
    name: 'bare',
    initialState,
    reducers: (fireflyReducer) => ({
      // A plain Redux Toolkit case reducer, mixed into the same map.
      cleared: (state, action: PayloadAction<string>) => {
        state.list = [];
        state.log.push(`cleared:${action.payload}`);
      },
      touch: fireflyReducer({
        prepare: (id: string, fail?: unknown) => ({ payload: { id, fail } }),
        effect: (payload) => statement<RunResult>({ changes: 1 }, { fail: payload.fail }),
      }),
      rename: fireflyReducer({
        reducer: (state, action: PayloadAction<Task>) => {
          state.list.push(action.payload);
        },
        effect: (payload) => statement<Task[]>([{ ...payload, saved: true }]),
      }),
      wipe: fireflyReducer({
        reducer: (state) => {
          state.list = [];
        },
        // A static effect: a value, not a function of the payload.
        effect: fakeStatement<RunResult>({ changes: 3 }),
      }),
    }),
  });
}

describe('commit and rollback matchers', () => {
  it('exist on every firefly action creator, named after the slice and the reducer', () => {
    const { actions } = createBareSlice();

    expect(actions.touch.commit.type).toBe('bare/touch/commit');
    expect(actions.touch.rollback.type).toBe('bare/touch/rollback');
    expect(actions.rename.commit.type).toBe('bare/rename/commit');
    expect(actions.rename.rollback.type).toBe('bare/rename/rollback');
    expect(actions.wipe.commit.type).toBe('bare/wipe/commit');
    expect(actions.wipe.rollback.type).toBe('bare/wipe/rollback');

    for (const creator of [actions.touch, actions.rename, actions.wipe]) {
      for (const matcher of [creator.commit, creator.rollback]) {
        expect(typeof matcher.match).toBe('function');
        expect(typeof matcher.unpack).toBe('function');
      }
    }
  });

  it('leave the action creator itself as Redux Toolkit made it', () => {
    const { actions } = createBareSlice();

    expect(actions.touch.type).toBe('bare/touch');
    expect(actions.touch.match(actions.touch('t1'))).toBe(true);
    expect(actions.touch('t1').payload).toEqual({ id: 't1', fail: undefined });
    expect(String(actions.touch)).toBe('bare/touch');
  });

  it('are not added to a plain case reducer', () => {
    const { actions } = createBareSlice();

    expect(actions.cleared('now')).toEqual({ type: 'bare/cleared', payload: 'now' });
    expect('commit' in actions.cleared).toBe(false);
    expect('rollback' in actions.cleared).toBe(false);
  });

  it('name the commit and the rollback on every dispatched write, handler or not', () => {
    const { actions } = createBareSlice();

    const action = actions.touch('t1') as unknown as { meta: { firefly: Record<string, unknown> } };

    expect(action.meta.firefly.commit).toEqual({ type: 'bare/touch/commit' });
    expect(action.meta.firefly.rollback).toEqual({ type: 'bare/touch/rollback' });
    expect(action.meta.firefly.originalPayload).toEqual({ id: 't1', fail: undefined });
  });

  it('fire a commit for a reducer with no handlers', async () => {
    const slice = createBareSlice();
    const database = fakeDrizzleDatabase();
    const { store, types, find, onError } = await createTestStore<{ bare: TasksState }>({
      database,
      reducers: { bare: slice.reducer },
    });

    const dispatched = store.dispatch(slice.actions.touch('t1'));
    await flush();

    expect(types()).toEqual(['bare/touch', 'bare/touch/commit']);
    const commit = find(slice.actions.touch.commit.type);
    expect(slice.actions.touch.commit.match(commit)).toBe(true);
    // The commit hands back the very payload the write was dispatched with.
    expect(commit.payload).toBe(dispatched.payload);
    // Nobody handles it: the state is as the (absent) reducer left it.
    expect(store.getState().bare).toEqual(initialState);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fire a rollback for a reducer with no handlers', async () => {
    const slice = createBareSlice();
    const { store, types, find, onError } = await createTestStore<{ bare: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { bare: slice.reducer },
    });

    const failure = new Error('disk full');
    const dispatched = store.dispatch(slice.actions.touch('t1', failure));
    await flush();

    expect(types()).toEqual(['bare/touch', 'bare/touch/rollback']);
    const rollback = find(slice.actions.touch.rollback.type);
    expect(slice.actions.touch.rollback.match(rollback)).toBe(true);
    expect(rollback.payload).toBe(dispatched.payload);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(failure);
  });

  it('match only their own action', async () => {
    const slice = createBareSlice();
    const other = createFireflySlice({
      name: 'other',
      initialState,
      reducers: (fireflyReducer) => ({
        touch: fireflyReducer({ effect: () => statement<RunResult>({ changes: 1 }) }),
      }),
    });
    const { store, find } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { bare: slice.reducer, other: other.reducer },
    });

    store.dispatch(slice.actions.touch('ok'));
    store.dispatch(slice.actions.touch('ko', new Error('no')));
    await flush();

    const write = find('bare/touch');
    const commit = find('bare/touch/commit');
    const rollback = find('bare/touch/rollback');
    const { touch, rename } = slice.actions;

    expect(touch.commit.match(commit)).toBe(true);
    expect(touch.commit.match(rollback)).toBe(false);
    expect(touch.commit.match(write)).toBe(false);
    expect(touch.rollback.match(rollback)).toBe(true);
    expect(touch.rollback.match(commit)).toBe(false);
    expect(touch.rollback.match(write)).toBe(false);

    // Not another reducer's, not another slice's reducer of the same name.
    expect(rename.commit.match(commit)).toBe(false);
    expect(rename.rollback.match(rollback)).toBe(false);
    expect(other.actions.touch.commit.match(commit)).toBe(false);
    expect(other.actions.touch.rollback.match(rollback)).toBe(false);

    // Not something that is no action at all.
    for (const notAnAction of [undefined, null, 'bare/touch/commit', 42, {}, { type: undefined }]) {
      expect(touch.commit.match(notAnAction)).toBe(false);
      expect(touch.rollback.match(notAnAction)).toBe(false);
    }
  });

  it('unpack a commit into its payload and results', async () => {
    const slice = createBareSlice();
    const { store, find } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { bare: slice.reducer },
    });

    const task: Task = { id: 't1', title: 'Sweep' };
    store.dispatch(slice.actions.rename(task));
    store.dispatch(slice.actions.wipe());
    await flush();

    const renamed = slice.actions.rename.commit.unpack(find('bare/rename/commit'));
    expect(renamed).toEqual({ payload: task, results: [{ ...task, saved: true }] });
    // No prepare: the payload is the creator's argument, untouched.
    expect(renamed.payload).toBe(task);

    const wiped = slice.actions.wipe.commit.unpack(find('bare/wipe/commit'));
    expect(wiped).toEqual({ payload: undefined, results: { changes: 3 } });
  });

  it('unpack a rollback into its payload and an Error', async () => {
    const slice = createBareSlice();
    const { store, find } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { bare: slice.reducer },
    });

    const failure = new Error('disk full');
    const dispatched = store.dispatch(slice.actions.touch('t1', failure));
    await flush();

    const unpacked = slice.actions.touch.rollback.unpack(find('bare/touch/rollback'));
    expect(Object.keys(unpacked).sort()).toEqual(['error', 'payload']);
    expect(unpacked.payload).toBe(dispatched.payload);
    expect(unpacked.error).toBe(failure);
  });

  it.each([
    ['a string', 'boom', 'boom'],
    ['an object', { code: 13 }, '[object Object]'],
    ['a number', 0, '0'],
  ])('unpack an Error when %s was thrown', async (_name, thrown, message) => {
    const slice = createBareSlice();
    const { store, find, onError } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { bare: slice.reducer },
    });

    store.dispatch(slice.actions.touch('t1', thrown));
    await flush();

    const { error } = slice.actions.touch.rollback.unpack(find('bare/touch/rollback'));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('unpack an Error from a rollback action that carries none', () => {
    const { touch } = createBareSlice().actions;
    const payload = { id: 't1', fail: undefined };

    // Hand-built, as a test or a replayed log might dispatch one.
    const withString = { type: touch.rollback.type, payload, meta: { firefly: { error: 'boom' } } };
    const withNothing = { type: touch.rollback.type, payload };

    expect(touch.rollback.unpack(withString).error).toEqual(new Error('boom'));
    expect(touch.rollback.unpack(withString).payload).toBe(payload);
    expect(touch.rollback.unpack(withNothing).error).toBeInstanceOf(Error);
    // A commit action with no meta unpacks without throwing, too.
    expect(touch.commit.unpack({ type: touch.commit.type })).toEqual({ payload: undefined, results: undefined });
  });
});

describe('a firefly reducer own handlers', () => {
  /** Every argument a handler was called with, by handler. */
  type Seen = Record<string, unknown[]>;

  function createHandledSlice(seen: Seen = {}) {
    const see = (name: string, action: unknown) => {
      // The handler gets a plain object, not a draft: safe to keep.
      (seen[name] ??= []).push(action);
    };

    return createFireflySlice({
      name: 'tasks',
      initialState,
      reducers: (fireflyReducer) => ({
        // The 2.0 style: the handler destructures what it needs.
        add: fireflyReducer({
          prepare: (title: string, fail?: unknown) => ({ payload: { id: `id-${title}`, title, fail } }),
          reducer: (state, { payload }) => {
            state.list.push({ id: payload.id, title: payload.title });
          },
          effect: (payload) =>
            statement<Task[]>([{ id: payload.id, title: payload.title.toUpperCase(), saved: true }], {
              fail: payload.fail,
            }),
          commit: (state, { payload, results }) => {
            const index = state.list.findIndex((task) => task.id === payload.id);
            state.list[index] = results[0];
            state.log.push(`committed:${payload.id}`);
          },
          rollback: (state, { payload, error }) => {
            state.list = state.list.filter((task) => task.id !== payload.id);
            state.log.push(`rolled back:${payload.id}:${error.message}`);
          },
        }),
        // The 1.x style: the handler reads the dispatched action.
        addLegacy: fireflyReducer({
          reducer: (state, action) => {
            state.list.push({ id: action.payload.id, title: action.payload.title });
          },
          prepare: (title: string, fail?: unknown) => ({ payload: { id: `id-${title}`, title, fail } }),
          effect: (payload) =>
            statement<Task[]>([{ id: payload.id, title: payload.title.toUpperCase(), saved: true }], {
              fail: payload.fail,
            }),
          commit: (state, action) => {
            see('addLegacy.commit', action);
            const index = state.list.findIndex((task) => task.id === action.payload.id);
            state.list[index] = action.meta.firefly.result[0];
            state.log.push(`committed:${action.payload.id}`);
          },
          rollback: (state, action) => {
            see('addLegacy.rollback', action);
            // Returning the next state works as in any case reducer.
            return {
              list: state.list.filter((task) => task.id !== action.payload.id),
              log: [...state.log, `rolled back:${action.payload.id}:${action.meta.firefly.error.message}`],
            };
          },
        }),
        // Commit-only: no reducer, state changes only once the write landed.
        archive: fireflyReducer({
          prepare: (id: string, fail?: unknown) => ({ payload: { id, fail } }),
          effect: (payload) => statement<RunResult>({ changes: 1 }, { fail: payload.fail }),
          commit: (state, { payload, results }) => {
            state.list = state.list.filter((task) => task.id !== payload.id);
            state.log.push(`archived:${payload.id}:${results.changes}`);
          },
        }),
      }),
    });
  }

  async function setup() {
    const seen: Seen = {};
    const slice = createHandledSlice(seen);
    const database = fakeDrizzleDatabase();
    const harness = await createTestStore<{ tasks: TasksState }>({ database, reducers: { tasks: slice.reducer } });
    return { ...harness, slice, seen, database, tasks: () => harness.store.getState().tasks };
  }

  it('commit: (state, { payload, results }) gets the payload and the results', async () => {
    const { store, slice, tasks, types } = await setup();

    store.dispatch(slice.actions.add('sweep'));
    // Optimistic, before the write lands.
    expect(tasks().list).toEqual([{ id: 'id-sweep', title: 'sweep' }]);
    await flush();

    expect(types()).toEqual(['tasks/add', 'tasks/add/commit']);
    expect(tasks().list).toEqual([{ id: 'id-sweep', title: 'SWEEP', saved: true }]);
    expect(tasks().log).toEqual(['committed:id-sweep']);
  });

  it('commit: (state, action) still reads action.meta.firefly.result, as in 1.x', async () => {
    const { store, slice, tasks, seen, find } = await setup();

    store.dispatch(slice.actions.addLegacy('mop'));
    await flush();

    expect(tasks().list).toEqual([{ id: 'id-mop', title: 'MOP', saved: true }]);
    expect(tasks().log).toEqual(['committed:id-mop']);

    // The handler got the dispatched action, plus `results`.
    const dispatched = find('tasks/addLegacy/commit');
    const result = [{ id: 'id-mop', title: 'MOP', saved: true }];
    expect(seen['addLegacy.commit']).toEqual([{ ...dispatched, results: result }]);
    expect(dispatched).toEqual({
      type: 'tasks/addLegacy/commit',
      payload: { id: 'id-mop', title: 'mop', fail: undefined },
      meta: { firefly: { result } },
    });
  });

  it('rollback: (state, { payload, error }) gets the payload and the error', async () => {
    const { store, slice, tasks, types, onError } = await setup();

    store.dispatch(slice.actions.add('sweep', new Error('disk full')));
    expect(tasks().list).toHaveLength(1);
    await flush();

    expect(types()).toEqual(['tasks/add', 'tasks/add/rollback']);
    expect(tasks().list).toEqual([]);
    expect(tasks().log).toEqual(['rolled back:id-sweep:disk full']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rollback: (state, action) still reads action.meta.firefly.error, as in 1.x', async () => {
    const { store, slice, tasks, seen, find } = await setup();

    const failure = new Error('disk full');
    store.dispatch(slice.actions.addLegacy('mop', failure));
    await flush();

    expect(tasks().list).toEqual([]);
    expect(tasks().log).toEqual(['rolled back:id-mop:disk full']);

    // The handler got the dispatched action, plus `error`.
    const dispatched = find('tasks/addLegacy/rollback');
    expect(seen['addLegacy.rollback']).toEqual([{ ...dispatched, error: failure }]);
    expect((seen['addLegacy.rollback'][0] as { error: unknown }).error).toBe(failure);
  });

  it('rollback handler gets an Error when something else was thrown', async () => {
    const { store, slice, tasks } = await setup();

    store.dispatch(slice.actions.add('sweep', 'boom'));
    await flush();

    expect(tasks().log).toEqual(['rolled back:id-sweep:boom']);
  });

  it('a commit-only write changes state only once it has landed', async () => {
    const { store, slice, tasks, types } = await setup();
    store.dispatch(slice.actions.add('sweep'));
    await flush();
    const landed = tasks();

    store.dispatch(slice.actions.archive('id-sweep'));
    // No reducer: dispatching the write changes nothing by itself.
    expect(tasks()).toBe(landed);
    await flush();

    expect(types().slice(-2)).toEqual(['tasks/archive', 'tasks/archive/commit']);
    expect(tasks().list).toEqual([]);
    expect(tasks().log).toEqual(['committed:id-sweep', 'archived:id-sweep:1']);
  });

  it('a commit-only write that fails never changes state', async () => {
    const { store, slice, tasks, types, onError } = await setup();
    store.dispatch(slice.actions.add('sweep'));
    await flush();
    const landed = tasks();

    store.dispatch(slice.actions.archive('id-sweep', new Error('locked')));
    await flush();

    // The rollback is dispatched (nothing handles it here) and the error reported.
    expect(types().slice(-2)).toEqual(['tasks/archive', 'tasks/archive/rollback']);
    expect(tasks()).toBe(landed);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('leaves the definitions as they were written', () => {
    const prepare = (id: string) => ({ payload: { id } });
    const reducer = jest.fn();
    const commit = jest.fn();
    const definition = { prepare, reducer, effect: () => fakeStatement(1), commit };
    const snapshot = { ...definition };
    let returned: object | undefined;

    const slice = createFireflySlice({
      name: 'kept',
      initialState,
      reducers: (fireflyReducer) => {
        const caseReducer = fireflyReducer(definition);
        returned = caseReducer;
        return { save: caseReducer };
      },
    });

    // Neither what the caller wrote nor what fireflyReducer returned is edited.
    expect(definition).toEqual(snapshot);
    expect(returned).toMatchObject(snapshot);
    // The slice's creator still runs the caller's prepare, with meta.firefly added.
    expect(slice.actions.save('k1')).toMatchObject({ payload: { id: 'k1' }, meta: { firefly: {} } });
  });

  it('runs a definition that was built by hand, keyed on its effect', async () => {
    // What a wrapper that never calls `fireflyReducer` returns: no prepare, no reducer.
    const byHand = {
      effect: (payload: { id: string }) => fakeStatement<RunResult>({ changes: payload.id.length }),
      commit: (state: TasksState, action: { results: RunResult }) => {
        state.log.push(`by hand:${action.results.changes}`);
      },
    };
    const slice = createFireflySlice({
      name: 'manual',
      initialState,
      reducers: () => ({ save: byHand }) as never,
    });
    const { store, types } = await createTestStore<{ manual: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { manual: slice.reducer },
    });

    const save = (slice.actions as Record<string, (payload: unknown) => { type: string }>).save;
    store.dispatch(save({ id: 'abc' }));
    await flush();

    expect(types()).toEqual(['manual/save', 'manual/save/commit']);
    expect(store.getState().manual.log).toEqual(['by hand:3']);
  });
});

describe('onCommit and onRollback', () => {
  function createSlices() {
    const rooms = createFireflySlice({
      name: 'rooms',
      initialState: { names: [] as string[] },
      reducers: (fireflyReducer) => ({
        addRoom: fireflyReducer({
          prepare: (name: string, fail?: unknown) => ({ payload: { name, fail } }),
          reducer: (state, { payload }) => {
            state.names.push(payload.name);
          },
          effect: (payload) => statement<{ id: number }[]>([{ id: payload.name.length }], { fail: payload.fail }),
          rollback: (state, { payload }) => {
            state.names = state.names.filter((name) => name !== payload.name);
          },
        }),
      }),
    });

    // Another slice reacts to the rooms slice's write.
    const slots = createFireflySlice({
      name: 'slots',
      initialState: { byRoom: {} as Record<string, number>, failed: [] as string[] },
      reducers: () => ({}),
      extraReducers: (builder) => {
        onCommit(builder, rooms.actions.addRoom, (state, { payload, results }) => {
          state.byRoom[payload.name] = results[0].id;
        });
        onRollback(builder, rooms.actions.addRoom, (state, { payload, error }) => {
          state.failed.push(`${payload.name}:${error.message}`);
        });
      },
    });

    // A slice reacts to its own handler-less write.
    const audit = createFireflySlice({
      name: 'audit',
      initialState: { entries: [] as string[] },
      reducers: (fireflyReducer) => ({
        record: fireflyReducer({
          prepare: (what: string, fail?: unknown) => ({ payload: { what, fail } }),
          effect: (payload) => statement<RunResult>({ changes: 1 }, { fail: payload.fail }),
        }),
      }),
      extraReducers: (builder) => {
        onCommit(builder, audit.actions.record, (state, { payload, results }) => {
          state.entries.push(`${payload.what}:${results.changes}`);
        });
        onRollback(builder, audit.actions.record, (state, { payload, error }) => {
          state.entries.push(`${payload.what}:failed:${error.message}`);
        });
      },
    });

    return { rooms, slots, audit };
  }

  async function setup() {
    const slices = createSlices();
    const harness = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: {
        rooms: slices.rooms.reducer,
        slots: slices.slots.reducer,
        audit: slices.audit.reducer,
      },
    });
    return { ...harness, ...slices };
  }

  it('onCommit handles another slice commit, with its payload and results', async () => {
    const { store, rooms } = await setup();

    store.dispatch(rooms.actions.addRoom('kitchen'));
    expect(store.getState().slots.byRoom).toEqual({});
    await flush();

    expect(store.getState().slots).toEqual({ byRoom: { kitchen: 7 }, failed: [] });
  });

  it('onRollback handles another slice rollback, next to that slice own handler', async () => {
    const { store, rooms } = await setup();

    store.dispatch(rooms.actions.addRoom('attic', 'no room'));
    await flush();

    // The rooms slice's own rollback handler ran...
    expect(store.getState().rooms.names).toEqual([]);
    // ...and so did the slots slice's, with an Error.
    expect(store.getState().slots).toEqual({ byRoom: {}, failed: ['attic:no room'] });
  });

  it('onCommit handles the slice own write when the reducer has no commit handler', async () => {
    const { store, audit, types } = await setup();

    store.dispatch(audit.actions.record('login'));
    await flush();

    expect(types()).toEqual(['audit/record', 'audit/record/commit']);
    expect(store.getState().audit.entries).toEqual(['login:1']);
  });

  it('onRollback handles the slice own write when the reducer has no rollback handler', async () => {
    const { store, audit } = await setup();

    store.dispatch(audit.actions.record('login', new Error('offline')));
    await flush();

    expect(store.getState().audit.entries).toEqual(['login:failed:offline']);
  });

  it('a slice can return the next state from the handler', async () => {
    const { rooms } = createSlices();
    const counter = createFireflySlice({
      name: 'counter',
      initialState: 0 as number,
      reducers: () => ({}),
      extraReducers: (builder) => {
        onCommit(builder, rooms.actions.addRoom, (state) => state + 1);
        onRollback(builder, rooms.actions.addRoom, (state) => state - 1);
      },
    });
    const { store } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { rooms: rooms.reducer, counter: counter.reducer },
    });

    store.dispatch(rooms.actions.addRoom('hall'));
    store.dispatch(rooms.actions.addRoom('den'));
    store.dispatch(rooms.actions.addRoom('attic', 'no room'));
    await flush();

    expect(store.getState().counter).toBe(1);
  });
});

describe('record effect through a slice', () => {
  interface Profile {
    id: string;
    name: string;
  }

  function createSlices(events: EventLog) {
    const profiles = createFireflySlice({
      name: 'profiles',
      initialState: { list: [] as Profile[], slotChanges: 0, deleted: 'not run' as string },
      reducers: (fireflyReducer) => ({
        save: fireflyReducer({
          prepare: (profile: Profile, slots: string[], removeOld: boolean) => ({
            payload: { profile, slots, removeOld },
          }),
          effect: (payload) => ({
            profile: statement<Profile[]>([payload.profile], { label: 'profile', events }),
            slots: payload.slots.map((slot, index) =>
              statement<RunResult>({ changes: index + 1 }, { label: `slot:${slot}`, events })
            ),
            deleted: payload.removeOld && statement<RunResult>({ changes: 9 }, { label: 'deleted', events }),
            skipped: undefined,
          }),
          commit: (state, { results }) => {
            state.list.push(...results.profile);
            state.slotChanges = results.slots.reduce((sum, result) => sum + result.changes, 0);
            state.deleted = results.deleted ? `deleted ${results.deleted.changes}` : 'kept';
          },
        }),
      }),
    });

    const mirror = createFireflySlice({
      name: 'mirror',
      initialState: { seen: [] as unknown[] },
      reducers: () => ({}),
      extraReducers: (builder) => {
        onCommit(builder, profiles.actions.save, (state, { payload, results }) => {
          state.seen.push({
            id: payload.profile.id,
            profile: results.profile,
            slots: results.slots,
            deleted: results.deleted,
            skipped: results.skipped,
          });
        });
      },
    });

    return { profiles, mirror };
  }

  async function setup() {
    const events: EventLog = [];
    const slices = createSlices(events);
    const database = fakeDrizzleDatabase({ events });
    const harness = await createTestStore({
      database,
      reducers: { profiles: slices.profiles.reducer, mirror: slices.mirror.reducer },
    });
    return { ...harness, ...slices, events, database };
  }

  const ada: Profile = { id: 'p1', name: 'Ada' };

  it('gives the results by name to the commit handler, to onCommit and to unpack', async () => {
    const { store, profiles, find, onError } = await setup();

    store.dispatch(profiles.actions.save(ada, ['a', 'b'], true));
    await flush();

    // In the reducer's own commit handler.
    expect(store.getState().profiles).toEqual({ list: [ada], slotChanges: 3, deleted: 'deleted 9' });

    // In another slice's onCommit.
    expect(store.getState().mirror.seen).toEqual([
      { id: 'p1', profile: [ada], slots: [{ changes: 1 }, { changes: 2 }], deleted: { changes: 9 }, skipped: undefined },
    ]);

    // In unpack: a single slot gives its result, a list slot an array, a skipped slot undefined.
    const { payload, results } = profiles.actions.save.commit.unpack(find('profiles/save/commit'));
    expect(payload).toEqual({ profile: ada, slots: ['a', 'b'], removeOld: true });
    expect(results.profile).toEqual([ada]);
    expect(results.slots).toEqual([{ changes: 1 }, { changes: 2 }]);
    expect(results.deleted).toEqual({ changes: 9 });
    expect(results.skipped).toBeUndefined();

    expect(onError).not.toHaveBeenCalled();
  });

  it('gives an empty list slot an empty array and a skipped slot undefined', async () => {
    const { store, profiles, find } = await setup();

    store.dispatch(profiles.actions.save(ada, [], false));
    await flush();

    expect(store.getState().profiles).toEqual({ list: [ada], slotChanges: 0, deleted: 'kept' });
    const { results } = profiles.actions.save.commit.unpack(find('profiles/save/commit'));
    expect(results.slots).toEqual([]);
    expect(results.deleted).toBeUndefined();
  });

  it('runs the statements in record order in one transaction', async () => {
    const { store, profiles, events, database } = await setup();

    store.dispatch(profiles.actions.save(ada, ['a', 'b'], true));
    await flush();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'profile', 'slot:a', 'slot:b', 'deleted', 'commit']);
  });
});

describe('empty write through a slice', () => {
  const EMPTY_EFFECTS: Array<[name: string, effect: () => unknown]> = [
    ['an empty record', () => ({})],
    ['a record whose slots are all skipped', () => ({ a: undefined, b: null, c: false })],
    ['a record of empty lists', () => ({ list: [], skipped: undefined })],
    ['an empty array', () => []],
    ['undefined', () => undefined],
    ['null', () => null],
  ];

  describe.each(EMPTY_EFFECTS)('when the effect is %s', (_name, effect) => {
    it('runs the optimistic reducer and dispatches nothing else', async () => {
      const handled = jest.fn();
      const slice = createFireflySlice({
        name: 'tasks',
        initialState,
        reducers: (fireflyReducer) => ({
          touch: fireflyReducer({
            prepare: (id: string) => ({ payload: { id } }),
            reducer: (state, { payload }) => {
              state.log.push(`touched:${payload.id}`);
            },
            effect,
            commit: () => handled('commit'),
            rollback: () => handled('rollback'),
          }),
        }),
      });
      const database = { ...fakeDrizzleDatabase(), ...fakeDriver() };
      const { store, types, onError } = await createTestStore<{ tasks: TasksState }>({
        database,
        reducers: { tasks: slice.reducer },
      });

      const dispatched = store.dispatch(slice.actions.touch('t1')) as unknown as {
        meta: { firefly: { effect: unknown } };
      };
      await flush();

      // The write says so itself: whoever waits for its commit can tell that none will come.
      // The slice drops an empty effect from the action, so `effect != null` and
      // `isFireflyAction` answer it too.
      expect(dispatched.meta.firefly.effect).toBeUndefined();
      expect(isEmptyEffect(dispatched.meta.firefly.effect)).toBe(true);
      expect(isFireflyAction(dispatched)).toBe(false);
      // The optimistic reducer ran...
      expect(store.getState().tasks.log).toEqual(['touched:t1']);
      // ...and nothing followed: no commit, no rollback, no error, no database call.
      expect(types()).toEqual(['tasks/touch']);
      expect(handled).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      for (const method of Object.values(database)) {
        expect(method).not.toHaveBeenCalled();
      }
    });
  });

  it('does not take an effect that is a Promise for an empty write: it rolls back', async () => {
    const insert = fakeStatement<RunResult>({ changes: 1 });
    const slice = createFireflySlice({
      name: 'tasks',
      initialState,
      reducers: (fireflyReducer) => ({
        add: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          reducer: (state, { payload }) => {
            state.log.push(`adding:${payload.id}`);
          },
          // @ts-expect-error — an async effect returns a Promise, not the query
          effect: async () => insert,
          commit: (state) => {
            state.log.push('added');
          },
          rollback: (state, { error }) => {
            state.log.push(`rolled back:${error.message}`);
          },
        }),
      }),
    });
    const { store, types, onError } = await createTestStore<{ tasks: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { tasks: slice.reducer },
    });

    const dispatched = store.dispatch(slice.actions.add('t1'));
    await flush();

    // The Promise stays on the action, so the write is seen, and fails loudly.
    expect(isFireflyAction(dispatched)).toBe(true);
    expect(types()).toEqual(['tasks/add', 'tasks/add/rollback']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/is a Promise, not a drizzle query/);
    expect(store.getState().tasks.log).toEqual([
      'adding:t1',
      expect.stringMatching(/^rolled back:.*is a Promise/),
    ]);
  });

  it('writes when the same reducer does have statements', async () => {
    const slice = createFireflySlice({
      name: 'tasks',
      initialState,
      reducers: (fireflyReducer) => ({
        assign: fireflyReducer({
          prepare: (ids: string[]) => ({ payload: { ids } }),
          effect: ({ ids }) => ({
            rows: ids.map((id) => fakeStatement<RunResult>({ changes: id.length })),
          }),
          commit: (state, { results }) => {
            state.log.push(`assigned:${results.rows.length}`);
          },
        }),
      }),
    });
    const { store, types } = await createTestStore<{ tasks: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { tasks: slice.reducer },
    });

    const empty = store.dispatch(slice.actions.assign([])) as unknown as { meta: { firefly: { effect: unknown } } };
    const full = store.dispatch(slice.actions.assign(['a', 'b'])) as unknown as typeof empty;
    await flush();

    expect(isEmptyEffect(empty.meta.firefly.effect)).toBe(true);
    expect(isEmptyEffect(full.meta.firefly.effect)).toBe(false);

    // Only the second write had anything to run.
    expect(types()).toEqual(['tasks/assign', 'tasks/assign', 'tasks/assign/commit']);
    expect(store.getState().tasks.log).toEqual(['assigned:2']);
  });
});

describe('meta returned by prepare', () => {
  const failure = { titleKey: 'tasks.add.failed.title', messageKey: 'tasks.add.failed.message' };

  function createSlice() {
    return createFireflySlice({
      name: 'tasks',
      initialState,
      reducers: (fireflyReducer) => ({
        add: fireflyReducer({
          prepare: (id: string, fail?: unknown) => ({
            payload: { id, fail },
            meta: { failure, requestId: `request-${id}` },
          }),
          effect: (payload) => statement<RunResult>({ changes: 1 }, { fail: payload.fail }),
        }),
        // A meta that is no object cannot be merged with meta.firefly.
        odd: fireflyReducer({
          prepare: (id: string) => ({ payload: { id }, meta: 'not an object' }),
          effect: () => fakeStatement<RunResult>({ changes: 1 }),
        }),
      }),
    });
  }

  it('stays on the dispatched action, next to meta.firefly', async () => {
    const slice = createSlice();
    const { store, find } = await createTestStore<{ tasks: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { tasks: slice.reducer },
    });

    store.dispatch(slice.actions.add('t1'));
    await flush();

    const dispatched = find('tasks/add');
    expect(dispatched.meta.failure).toBe(failure);
    expect(dispatched.meta.requestId).toBe('request-t1');
    expect(dispatched.meta.firefly).toMatchObject({
      originalPayload: { id: 't1', fail: undefined },
      commit: { type: 'tasks/add/commit' },
      rollback: { type: 'tasks/add/rollback' },
    });
    expect(dispatched.payload).toEqual({ id: 't1', fail: undefined });
  });

  it('reaches onError on the failed action', async () => {
    const slice = createSlice();
    const { store, find, onError } = await createTestStore<{ tasks: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { tasks: slice.reducer },
    });

    const error = new Error('disk full');
    store.dispatch(slice.actions.add('t1', error));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    const [reported, action] = onError.mock.calls[0];
    expect(reported).toBe(error);
    expect(action).toBe(find('tasks/add'));
    expect(action.meta.failure).toBe(failure);
    expect(action.meta.requestId).toBe('request-t1');
  });

  it('is replaced by { firefly } when it is not an object', () => {
    const action = createSlice().actions.odd('t1') as unknown as { meta: Record<string, unknown> };

    expect(Object.keys(action.meta)).toEqual(['firefly']);
  });
});

describe('hydration and applyRows', () => {
  const apply = listApply<Task, TasksState>({
    toItem: (row) => ({ id: String(row.key), title: String(row.columns.title ?? '') }),
    getId: (task) => task.id,
    listKey: 'list',
  });

  it('attach a SQL hydration and an applyRows config to slice.reducer', () => {
    const hydration = {
      query: 'SELECT * FROM tasks',
      transform: (rows: Task[]): TasksState => ({ list: rows, log: [] }),
    };
    const applyRows = { table: 'tasks', apply };
    const slice = createFireflySlice({
      name: 'tasks',
      initialState,
      hydration,
      applyRows,
      reducers: () => ({}),
    });

    const reducer: HydratedReducer<TasksState> = slice.reducer;
    expect(isHydratedReducer(slice.reducer)).toBe(true);
    expect(reducer._fireflyHydration).toBe(hydration);
    expect(isApplyRowsReducer(slice.reducer)).toBe(true);
    expect(reducer._fireflyApplyRows).toBe(applyRows);
  });

  it('attach nothing when neither is given', () => {
    const slice = createFireflySlice({ name: 'tasks', initialState, reducers: () => ({}) });

    expect(isHydratedReducer(slice.reducer)).toBe(false);
    expect(isApplyRowsReducer(slice.reducer)).toBe(false);
  });

  it('hydrate the slice from SQL, then apply merged rows, around a firefly write', async () => {
    const slice = createFireflySlice({
      name: 'tasks',
      initialState,
      hydration: {
        query: 'SELECT * FROM tasks',
        transform: (rows: Task[]): TasksState => ({ list: rows, log: ['hydrated'] }),
      },
      applyRows: { table: 'tasks', apply },
      reducers: (fireflyReducer) => ({
        add: fireflyReducer({
          prepare: (id: string, title: string) => ({ payload: { id, title } }),
          reducer: (state, { payload }) => {
            state.list.push(payload);
          },
          effect: (payload) => ({ sql: 'INSERT INTO tasks (id, title) VALUES (?, ?)', params: [payload.id, payload.title] }),
          commit: (state, { payload }) => {
            state.log.push(`saved:${payload.id}`);
          },
        }),
      }),
    });

    let emit: (event: FireflyChangeEvent) => void = () => {};
    const database = fakeDriver({ all: () => [{ id: 'seed', title: 'Seed' }] });
    const { store } = await createTestStore<{ tasks: TasksState }>({
      database,
      reducers: { tasks: slice.reducer },
      config: {
        changes: {
          subscribeToChanges: (handler) => {
            emit = handler;
            return { remove: () => {} };
          },
        },
      },
    });

    expect(database.getAllAsync).toHaveBeenCalledWith('SELECT * FROM tasks', []);
    expect(store.getState().tasks).toEqual({ list: [{ id: 'seed', title: 'Seed' }], log: ['hydrated'] });

    store.dispatch(slice.actions.add('t1', 'Sweep'));
    await flush();
    expect(database.runAsync).toHaveBeenCalledWith('INSERT INTO tasks (id, title) VALUES (?, ?)', ['t1', 'Sweep']);
    expect(store.getState().tasks.log).toEqual(['hydrated', 'saved:t1']);

    const row: MergedRow = { table: 'tasks', key: 'r1', pk: new Uint8Array([0]), columns: { title: 'Remote' }, deleted: false };
    emit({ source: 'remote', merged: [row] });
    expect(store.getState().tasks.list).toEqual([
      { id: 'seed', title: 'Seed' },
      { id: 't1', title: 'Sweep' },
      { id: 'r1', title: 'Remote' },
    ]);
  });

  it('hydrate the slice from drizzle queries', async () => {
    const tasksQuery = fakeStatement<Task[]>([{ id: 'seed', title: 'Seed' }]);
    const countQuery = fakeStatement<{ n: number }[]>([{ n: 1 }]);
    const slice = createFireflySlice({
      name: 'tasks',
      initialState,
      hydration: {
        query: [tasksQuery, countQuery],
        transform: (results) => ({
          list: results[0].rows ?? [],
          log: [`count:${results[1].rows?.[0].n}`],
        }),
      },
      reducers: () => ({}),
    });

    const { store } = await createTestStore<{ tasks: TasksState }>({
      database: fakeDrizzleDatabase(),
      reducers: { tasks: slice.reducer },
    });

    expect(isHydratedReducer(slice.reducer)).toBe(true);
    expect(store.getState().tasks).toEqual({ list: [{ id: 'seed', title: 'Seed' }], log: ['count:1'] });
  });
});
