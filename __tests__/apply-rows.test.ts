import { configureStore, type Store } from '@reduxjs/toolkit';
import { createFirefly } from '../src/createFirefly';
import { withHydration, applyRows as attachApplyRows } from '../src/withHydration';
import { listApply } from '../src/apply-rows';
import type {
  ApplyRowsChanges,
  FireflyChangeEvent,
  FireflyDriver,
  FireflyStore,
  MergedRow,
} from '../src';

interface Todo {
  id: string;
  text: string;
}

/** Build a MergedRow with a single-column string pk and text column. */
function todoRow(id: string, text: string, deleted = false): MergedRow {
  return {
    table: 'todos',
    key: id,
    pk: new Uint8Array([0]),
    columns: deleted ? {} : { id, text },
    deleted,
  };
}

// ---------------------------------------------------------------------------
// listApply (pure builder) unit tests
// ---------------------------------------------------------------------------

describe('listApply', () => {
  const apply = listApply<Todo>({
    toItem: (row) => ({ id: String(row.key), text: String(row.columns.text ?? '') }),
    getId: (t) => t.id,
    listKey: 'items',
  });

  const noChanges = (): ApplyRowsChanges => ({ upserts: [], deletes: [] });

  it('appends a new item by id', () => {
    const state = { items: [{ id: 'a', text: 'A' }] as Todo[] };
    const next = apply(state, { upserts: [todoRow('b', 'B')], deletes: [] });
    expect(next.items).toEqual([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ]);
  });

  it('replaces an existing item by id (in place, order preserved)', () => {
    const state = {
      items: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ] as Todo[],
    };
    const next = apply(state, { upserts: [todoRow('a', 'A2')], deletes: [] });
    expect(next.items).toEqual([
      { id: 'a', text: 'A2' },
      { id: 'b', text: 'B' },
    ]);
  });

  it('removes a deleted item by id', () => {
    const state = {
      items: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ] as Todo[],
    };
    const next = apply(state, { upserts: [], deletes: [todoRow('a', '', true)] });
    expect(next.items).toEqual([{ id: 'b', text: 'B' }]);
  });

  it('upsert + delete in one batch: upsert wins over delete for the same id', () => {
    const state = { items: [{ id: 'a', text: 'A' }] as Todo[] };
    const next = apply(state, {
      upserts: [todoRow('a', 'A2')],
      deletes: [todoRow('a', '', true)],
    });
    expect(next.items).toEqual([{ id: 'a', text: 'A2' }]);
  });

  it('returns the same state reference when nothing changed', () => {
    const state = { items: [{ id: 'a', text: 'A' }] as Todo[] };
    expect(apply(state, noChanges())).toBe(state);
  });

  it('operates on the state itself when listKey is omitted', () => {
    const arrayApply = listApply<Todo>({
      toItem: (row) => ({ id: String(row.key), text: String(row.columns.text ?? '') }),
      getId: (t) => t.id,
    });
    const state = [{ id: 'a', text: 'A' }] as Todo[];
    const next = arrayApply(state, { upserts: [todoRow('b', 'B')], deletes: [] });
    expect(next).toEqual([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ]);
  });

  it('honors a custom rowId for matching', () => {
    const customApply = listApply<Todo>({
      toItem: (row) => ({ id: String(row.columns.id), text: String(row.columns.text ?? '') }),
      getId: (t) => t.id,
      rowId: (row) => String(row.columns.id),
      listKey: 'items',
    });
    const row: MergedRow = {
      table: 'todos',
      key: 'pk-not-id',
      pk: new Uint8Array([0]),
      columns: { id: 'a', text: 'A2' },
      deleted: false,
    };
    const state = { items: [{ id: 'a', text: 'A' }] as Todo[] };
    const next = customApply(state, { upserts: [row], deletes: [] });
    expect(next.items).toEqual([{ id: 'a', text: 'A2' }]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: FireflyClient change events through createFirefly + configureStore
// ---------------------------------------------------------------------------

function fakeDriver() {
  const selects: string[] = [];
  const driver: FireflyDriver = {
    async runAsync() {
      return { lastInsertRowId: 0, changes: 0 };
    },
    async getAllAsync(sql: string) {
      selects.push(sql);
      if (sql.includes('todos')) return [{ id: 'seed', text: 'Seed' }];
      return [];
    },
    async withTransactionAsync(cb) {
      await cb();
    },
  };
  return { driver, selects };
}

/** Fake FireflyClient: just the change subscription. */
function fakeClient() {
  const handlers = new Set<(event: FireflyChangeEvent) => void>();
  return {
    subscribeToChanges(handler: (event: FireflyChangeEvent) => void) {
      handlers.add(handler);
      return { remove: () => handlers.delete(handler) };
    },
    emit(event: FireflyChangeEvent) {
      handlers.forEach((h) => h(event));
    },
    get subscriberCount() {
      return handlers.size;
    },
  };
}

function idReducer<S>(initial: S) {
  return (state: S = initial): S => state;
}

function setup() {
  const { driver, selects } = fakeDriver();
  const client = fakeClient();

  const todos = attachApplyRows(
    withHydration(idReducer<{ items: Todo[] }>({ items: [] }), {
      query: 'SELECT * FROM todos',
      transform: (rows: any[]) => ({ items: rows }),
    }),
    {
      table: 'todos',
      apply: listApply<Todo>({
        toItem: (row) => ({ id: String(row.key), text: String(row.columns.text ?? '') }),
        getId: (t) => t.id,
        listKey: 'items',
      }),
    },
  );

  const { middleware, enhanceReducer, enhanceStore } = createFirefly({
    database: driver,
    changes: client,
  });
  const store = configureStore({
    reducer: enhanceReducer({ todos }),
    middleware: (g) => g({ serializableCheck: false }).concat(middleware),
    enhancers: (g) => g().concat(enhanceStore),
  }) as unknown as Store<{ todos: { items: Todo[] } }> & FireflyStore;

  return { store, selects, client };
}

describe('merged rows from change events', () => {
  it('hydrates the slice from the database on launch', async () => {
    const { store, selects } = setup();
    await store.hydrated;
    expect(store.getState().todos.items).toEqual([{ id: 'seed', text: 'Seed' }]);
    expect(selects.some((s) => s.includes('todos'))).toBe(true);
  });

  it('applies merged rows directly into the slice with NO SQL read', async () => {
    const { store, selects, client } = setup();
    await store.hydrated;
    selects.length = 0; // reset after initial hydrate

    client.emit({ source: 'remote', merged: [todoRow('t1', 'First'), todoRow('t2', 'Second')] });

    // Applied synchronously — appended after the seed, no re-hydration.
    expect(store.getState().todos.items).toEqual([
      { id: 'seed', text: 'Seed' },
      { id: 't1', text: 'First' },
      { id: 't2', text: 'Second' },
    ]);
    expect(selects).toHaveLength(0);
  });

  it('replaces an existing row by id and removes a deleted row, no SQL', async () => {
    const { store, selects, client } = setup();
    await store.hydrated;
    selects.length = 0;

    client.emit({ source: 'remote', merged: [todoRow('t1', 'First')] });
    client.emit({
      source: 'remote',
      merged: [todoRow('t1', 'First-edited'), todoRow('seed', '', true)],
    });

    expect(store.getState().todos.items).toEqual([{ id: 't1', text: 'First-edited' }]);
    expect(selects).toHaveLength(0);
  });

  it('ignores rows for tables without an applyRows slice', async () => {
    const { store, selects, client } = setup();
    await store.hydrated;
    selects.length = 0;
    const before = store.getState();

    client.emit({
      source: 'remote',
      merged: [{ table: 'homes', key: 'h1', pk: new Uint8Array([0]), columns: { id: 'h1' }, deleted: false }],
    });

    expect(store.getState()).toBe(before);
    expect(selects).toHaveLength(0);
  });

  it('ignores events that carry no merged rows', async () => {
    const { store, selects, client } = setup();
    await store.hydrated;
    selects.length = 0;
    const before = store.getState();

    client.emit({ source: 'local' });
    client.emit({ source: 'remote', merged: [] });

    expect(store.getState()).toBe(before);
    expect(selects).toHaveLength(0);
  });

  it('buffers rows that arrive during hydration and applies them after', async () => {
    const { store, client } = setup();

    // Emitted before `hydrated` resolves — must not be lost.
    client.emit({ source: 'remote', merged: [todoRow('t1', 'Early')] });
    await store.hydrated;

    expect(store.getState().todos.items).toEqual([
      { id: 'seed', text: 'Seed' },
      { id: 't1', text: 'Early' },
    ]);
  });

  it('dispose() unsubscribes from the change source', async () => {
    const { store, client } = setup();
    await store.hydrated;
    expect(client.subscriberCount).toBe(1);

    store.dispose();
    expect(client.subscriberCount).toBe(0);

    client.emit({ source: 'remote', merged: [todoRow('t1', 'First')] });
    expect(store.getState().todos.items).toEqual([{ id: 'seed', text: 'Seed' }]);
  });

  it('refreshAll() re-runs hydration', async () => {
    const { store, selects, client } = setup();
    await store.hydrated;
    selects.length = 0;

    // Drift state away from the DB, then refresh back to it.
    client.emit({ source: 'remote', merged: [todoRow('t1', 'First')] });
    await store.refreshAll();

    expect(selects.some((s) => s.includes('todos'))).toBe(true);
    expect(store.getState().todos.items).toEqual([{ id: 'seed', text: 'Seed' }]);
  });
});
