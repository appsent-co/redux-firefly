import { configureStore, createListenerMiddleware, type PayloadAction } from '@reduxjs/toolkit';
import { expectTypeOf } from 'expect-type';
import { createReduxFirefly, fireflyHydration } from '../src';
import {
  buildCreateFireflySlice,
  createFireflySlice,
  onWriteCommit,
  onWriteRollback,
  runWrite,
  type WriteOutcome,
} from '../src/toolkit';
import {
  createTestStore,
  failingStatement,
  fakeDrizzleDatabase,
  fakeStatement,
  flush,
} from './helpers';

interface FailureCopy {
  titleKey: string;
  messageKey: string;
}

interface Item {
  id: string;
  name: string;
}

const createAppSlice = buildCreateFireflySlice<{ failure?: FailureCopy }>({
  meta: ({ failure }) => (failure ? { failure } : undefined),
});

describe('buildCreateFireflySlice', () => {
  const ADD_FAILED: FailureCopy = { titleKey: 'items.add.title', messageKey: 'items.add.message' };

  it('attaches derived meta, keeps prepare meta, and preserves hydration and effect types', async () => {
    const slice = createAppSlice({
      name: 'items',
      initialState: { list: [] as Item[] },
      hydration: fireflyHydration(
        () => [fakeStatement<Item[]>([{ id: 'seed', name: 'Seed' }])],
        (results) => ({ list: results[0].rows ?? [] })
      ),
      reducers: (fireflyReducer) => ({
        clear: (state) => {
          state.list = [];
        },
        add: fireflyReducer({
          prepare: (item: Item, fail?: Error) => ({ payload: { item, fail }, meta: { tag: item.id } }),
          effect: ({ item, fail }) => ({
            row: fail
              ? failingStatement<Item[]>(fail)
              : fakeStatement<Item[]>([{ ...item, name: item.name.toUpperCase() }]),
          }),
          commit: (state, { results }) => {
            expectTypeOf(results).toEqualTypeOf<{ row: Item[] }>();
            state.list.push(results.row[0]);
          },
          failure: ADD_FAILED,
        }),
        rename: fireflyReducer({
          reducer: (state, action: PayloadAction<{ id: string; name: string }>) => {
            const target = state.list.find((item) => item.id === action.payload.id);
            if (target) target.name = action.payload.name;
          },
          effect: ({ id, name }) => fakeStatement<Item[]>([{ id, name }]),
          failure: ADD_FAILED,
        }),
        touch: fireflyReducer({
          prepare: (id: string) => ({ payload: { id } }),
          effect: () => fakeStatement({ changes: 1 }),
        }),
      }),
    });

    const { store, find, onError } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { items: slice.reducer },
    });

    expect(store.getState().items.list).toEqual([{ id: 'seed', name: 'Seed' }]);

    store.dispatch(slice.actions.add({ id: '1', name: 'Soap' }));
    store.dispatch(slice.actions.rename({ id: 'seed', name: 'Renamed' }));
    store.dispatch(slice.actions.touch('1'));
    await flush();

    const added = find('items/add');
    expect(added.meta.failure).toBe(ADD_FAILED);
    expect(added.meta.tag).toBe('1');
    expect(find('items/rename').meta.failure).toBe(ADD_FAILED);
    expect(Object.keys(find('items/touch').meta)).toEqual(['firefly']);
    expect(store.getState().items.list).toEqual([
      { id: 'seed', name: 'Renamed' },
      { id: '1', name: 'SOAP' },
    ]);

    const boom = new Error('disk full');
    store.dispatch(slice.actions.add({ id: '2', name: 'Mop' }, boom));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1].meta.failure).toBe(ADD_FAILED);
  });

  it('rejects invalid extra fields and bad hydration transforms at compile time', () => {
    createAppSlice({
      name: 'strict',
      initialState: { list: [] as Item[] },
      reducers: (fireflyReducer) => ({
        badFailure: fireflyReducer({
          effect: () => fakeStatement(1),
          // @ts-expect-error — missing messageKey
          failure: { titleKey: 'only.title' },
        }),
        unknownField: fireflyReducer({
          effect: () => fakeStatement(1),
          // @ts-expect-error — not declared in Extra
          retries: 3,
        }),
      }),
    });

    // @ts-expect-error — transform parameter does not match query result
    createAppSlice({
      name: 'badHydration',
      initialState: { list: [] as Item[] },
      reducers: () => ({}),
      hydration: {
        query: fakeStatement<number[]>([]),
        transform: (rows: Item[]) => ({ list: rows }),
      },
    });
  });
});

describe('runWrite', () => {
  const createItemsSlice = () =>
    createFireflySlice({
      name: 'items',
      initialState: { list: [] as Item[] },
      reducers: (fireflyReducer) => ({
        add: fireflyReducer({
          prepare: (name: string, fail?: Error) => ({ payload: name, meta: { fail } }),
          effect: (name) => ({
            rows: name === 'FAIL'
              ? failingStatement<Item[]>(new Error('write failed'))
              : fakeStatement<Item[]>([{ id: `id:${name}`, name }]),
          }),
          commit: (state, { results }) => {
            state.list.push(results.rows[0]);
          },
        }),
        maybeWrite: fireflyReducer({
          prepare: (items: string[]) => ({ payload: items }),
          effect: (items) => ({
            rows: items.map((name) => fakeStatement<Item>({ id: `id:${name}`, name })),
          }),
        }),
      }),
    });

  it('resolves with typed results after commit reducers have run (without listenerMiddleware)', async () => {
    const slice = createItemsSlice();
    const { store } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { items: slice.reducer },
    });

    const outcome = await store.dispatch(runWrite(slice.actions.add, 'Brush'));
    expectTypeOf(outcome).toEqualTypeOf<WriteOutcome<{ rows: Item[] }>>();

    expect(outcome).toEqual({
      committed: true,
      results: { rows: [{ id: 'id:Brush', name: 'Brush' }] },
    });
    // State already reflects the commit handler when runWrite resolves.
    expect(store.getState().items.list).toEqual([{ id: 'id:Brush', name: 'Brush' }]);
  });

  it('resolves with { committed: false, error } on rollback', async () => {
    const slice = createItemsSlice();
    const { store, onError } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { items: slice.reducer },
    });

    const outcome = await store.dispatch(runWrite(slice.actions.add, 'FAIL'));
    expect(outcome.committed).toBe(false);
    if (!outcome.committed) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe('write failed');
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.getState().items.list).toEqual([]);
  });

  it('resolves immediately for an empty write without running a transaction', async () => {
    const slice = createItemsSlice();
    const database = fakeDrizzleDatabase();
    const { store, types } = await createTestStore({
      database,
      reducers: { items: slice.reducer },
    });

    const outcome = await store.dispatch(runWrite(slice.actions.maybeWrite, []));
    expect(outcome).toEqual({ committed: true, results: {} });
    expect(database.transaction).not.toHaveBeenCalled();
    expect(types()).toEqual(['items/maybeWrite']);
  });

  it('tracks concurrent writes with identical primitive payloads independently', async () => {
    let call = 0;
    const slice = createFireflySlice({
      name: 'counter',
      initialState: { values: [] as number[] },
      reducers: (fireflyReducer) => ({
        bump: fireflyReducer({
          prepare: (label: string) => ({ payload: label }),
          effect: () => {
            const n = ++call;
            return n === 1
              ? failingStatement<{ n: number }>(new Error('first failed'))
              : fakeStatement<{ n: number }>({ n });
          },
          commit: (state, { results }) => {
            state.values.push(results.n);
          },
        }),
      }),
    });

    const { store } = await createTestStore({
      database: fakeDrizzleDatabase(),
      reducers: { counter: slice.reducer },
    });

    const [first, second] = await Promise.all([
      store.dispatch(runWrite(slice.actions.bump, 'same')),
      store.dispatch(runWrite(slice.actions.bump, 'same')),
    ]);

    expect(first.committed).toBe(false);
    expect(second).toEqual({ committed: true, results: { n: 2 } });
    expect(store.getState().counter.values).toEqual([2]);
  });

  it('rejects with a clear error when the firefly middleware is not registered', async () => {
    const slice = createItemsSlice();
    const store = configureStore({
      reducer: { items: slice.reducer },
      middleware: (getDefault) => getDefault({ serializableCheck: false }),
    });

    await expect(store.dispatch(runWrite(slice.actions.add, 'Brush'))).rejects.toThrow(
      /firefly middleware did not handle this action/i
    );
  });
});

describe('onWriteCommit and onWriteRollback', () => {
  it('unpacks commit and rollback payloads/results/errors with typed listener api', async () => {
    const slice = createFireflySlice({
      name: 'items',
      initialState: { list: [] as Item[] },
      reducers: (fireflyReducer) => ({
        add: fireflyReducer({
          prepare: (name: string, fail?: Error) => ({ payload: { name, fail } }),
          effect: ({ name, fail }) => ({
            row: fail
              ? failingStatement<Item[]>(fail)
              : fakeStatement<Item[]>([{ id: `id:${name}`, name }]),
          }),
          commit: (state, { results }) => {
            state.list.push(results.row[0]);
          },
        }),
      }),
    });

    const listener = createListenerMiddleware<{ items: { list: Item[] } }>();
    const committed: Array<{ name: string; id: string; count: number }> = [];
    const rolledBack: Array<{ name: string; message: string }> = [];

    const unsubscribeCommit = onWriteCommit(listener.startListening, slice.actions.add, ({ payload, results }, api) => {
      expectTypeOf(payload).toEqualTypeOf<{ name: string; fail: Error | undefined }>();
      expectTypeOf(results).toEqualTypeOf<{ row: Item[] }>();
      expectTypeOf(api.getState()).toEqualTypeOf<{ items: { list: Item[] } }>();
      committed.push({ name: payload.name, id: results.row[0].id, count: api.getState().items.list.length });
    });

    const unsubscribeRollback = onWriteRollback(listener.startListening, slice.actions.add, ({ payload, error }, api) => {
      expectTypeOf(payload).toEqualTypeOf<{ name: string; fail: Error | undefined }>();
      expectTypeOf(error).toEqualTypeOf<Error>();
      expectTypeOf(api.getState()).toEqualTypeOf<{ items: { list: Item[] } }>();
      rolledBack.push({ name: payload.name, message: error.message });
    });

    const { middleware, enhanceReducer, enhanceStore } = createReduxFirefly({
      database: fakeDrizzleDatabase(),
    });
    const store = configureStore({
      reducer: enhanceReducer({ items: slice.reducer }),
      middleware: (getDefault) =>
        getDefault({ serializableCheck: false, immutableCheck: false }).concat(middleware, listener.middleware),
      enhancers: (getDefault) => getDefault().concat(enhanceStore),
    });

    await store.dispatch(runWrite(slice.actions.add, 'Soap'));
    await store.dispatch(runWrite(slice.actions.add, 'Mop', new Error('locked')));

    expect(committed).toEqual([{ name: 'Soap', id: 'id:Soap', count: 1 }]);
    expect(rolledBack).toEqual([{ name: 'Mop', message: 'locked' }]);

    unsubscribeCommit();
    unsubscribeRollback();

    await store.dispatch(runWrite(slice.actions.add, 'Broom'));
    await store.dispatch(runWrite(slice.actions.add, 'Bucket', new Error('locked again')));

    expect(committed).toHaveLength(1);
    expect(rolledBack).toHaveLength(1);
  });
});
