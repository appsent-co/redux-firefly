import {
  createTestStore,
  failingStatement,
  fakeDriver,
  fakeDrizzleDatabase,
  fakeStatement,
  flush,
  fireflyAction,
  synchronousDrizzleDatabase,
  unawaitingDrizzleDatabase,
  type EventLog,
} from './helpers';

// The 1.x effect forms: their commit results keep their shapes.

describe('array of drizzle queries', () => {
  it('commits one { success, rows } per query, in order, from one transaction', async () => {
    const events: EventLog = [];
    const database = fakeDrizzleDatabase({ events });
    const { store, types, find } = await createTestStore({ database });
    const payload = { id: 't1' };

    store.dispatch(
      fireflyAction('todo/move', payload, [
        fakeStatement([{ id: 't1' }], { label: 'select', events }),
        fakeStatement({ changes: 1 }, { label: 'update', events }),
      ])
    );
    await flush();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'select', 'update', 'commit']);
    expect(types()).toEqual(['todo/move', 'todo/move/commit']);
    const commit = find('todo/move/commit');
    expect(commit.payload).toEqual(payload);
    expect(commit.meta.firefly.result).toEqual([
      { success: true, rows: [{ id: 't1' }] },
      { success: true, rows: { changes: 1 } },
    ]);
  });

  it('rolls back as a whole when one query fails', async () => {
    const events: EventLog = [];
    const database = fakeDrizzleDatabase({ events });
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('constraint');
    const last = fakeStatement(3, { label: 'last', events });

    store.dispatch(
      fireflyAction('todo/move', null, [
        fakeStatement(1, { label: 'first', events }),
        failingStatement(error, { label: 'broken', events }),
        last,
      ])
    );
    await flush();

    expect(types()).toEqual(['todo/move', 'todo/move/rollback']);
    expect(find('todo/move/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'first', 'broken', 'rollback']);
    expect(last.awaited).toBe(0);
  });
});

describe('array of drizzle queries on a database whose transaction() refuses an async callback', () => {
  it('rolls back without running any statement after the transaction that failed', async () => {
    const events: EventLog = [];
    const database = synchronousDrizzleDatabase({ events });
    const { store, types, find, onError } = await createTestStore({ database });
    const first = fakeStatement(1, { label: 'first', events });
    const second = fakeStatement(2, { label: 'second', events });

    const action = fireflyAction('todo/move', null, [first, second]);
    store.dispatch(action);
    await flush();

    // 1.x reported the rollback and then ran the statements anyway, one by one.
    expect(events).toEqual(['begin', 'rollback']);
    expect(first.awaited).toBe(0);
    expect(second.awaited).toBe(0);
    expect(types()).toEqual(['todo/move', 'todo/move/rollback']);
    const { error } = find('todo/move/rollback').meta.firefly;
    expect(error.message).toMatch(/transaction\(\) is synchronous/);
    expect(error.message).toMatch(/Transaction function cannot return a promise/);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });
});

// drizzle's durable-sqlite driver: transaction() calls the callback, drops its
// promise and returns `{}`. The statements run after it, on their own.
describe.each([
  ['returns', false],
  ['resolves', true],
])('array of drizzle queries on a database whose transaction() %s before its callback finishes', (_, async) => {
  /** A statement that takes a macrotask to settle, as a real one does. */
  function slowStatement<T>(label: string, result: T, events: EventLog) {
    return {
      then: (onFulfilled?: (value: T) => any, onRejected?: (reason: any) => any) => {
        events.push(label);
        return new Promise<T>((resolve) => setImmediate(() => resolve(result))).then(onFulfilled, onRejected);
      },
      toSQL: () => ({ sql: `-- ${label}`, params: [] }),
    };
  }

  it('commits once every statement has run, with all their results', async () => {
    const events: EventLog = [];
    const database = unawaitingDrizzleDatabase({ events, async });
    const { store, types, find, onError } = await createTestStore({ database });

    store.dispatch(
      fireflyAction('todo/move', null, [slowStatement('first', 1, events), slowStatement('second', 2, events)])
    );
    await flush();

    // 1.x committed here, with no result, while the statements were running.
    expect(types()).toEqual(['todo/move']);

    await flush();
    await flush();

    expect(events).toEqual(['begin', 'commit', 'first', 'second']);
    expect(types()).toEqual(['todo/move', 'todo/move/commit']);
    expect(find('todo/move/commit').meta.firefly.result).toEqual([
      { success: true, rows: 1 },
      { success: true, rows: 2 },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("rolls back with the statement's own error when one fails, and runs none after it", async () => {
    const events: EventLog = [];
    const database = unawaitingDrizzleDatabase({ events, async });
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('constraint');
    const last = fakeStatement(3, { label: 'last', events });

    const action = fireflyAction('todo/move', null, [
      fakeStatement(1, { label: 'first', events }),
      failingStatement(error, { label: 'broken', events }),
      last,
    ]);
    store.dispatch(action);
    await flush();

    // 1.x committed, and left the failure as an unhandled rejection.
    expect(events).toEqual(['begin', 'commit', 'first', 'broken']);
    expect(last.awaited).toBe(0);
    expect(types()).toEqual(['todo/move', 'todo/move/rollback']);
    expect(find('todo/move/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });
});

describe('array of drizzle queries on a database whose transaction() swallows the failure of its callback', () => {
  it('rolls back with the error of the statement that failed', async () => {
    const database = fakeDrizzleDatabase();
    database.transaction.mockImplementation(async (work) => {
      try {
        await work(undefined);
      } catch {
        // A runner that does not rethrow.
      }
    });
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('constraint');
    const last = fakeStatement(3);

    store.dispatch(fireflyAction('todo/move', null, [fakeStatement(1), failingStatement(error), last]));
    await flush();

    // 1.x committed the results of the statements that ran before the failure.
    expect(last.awaited).toBe(0);
    expect(types()).toEqual(['todo/move', 'todo/move/rollback']);
    expect(find('todo/move/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('single raw SQL effect', () => {
  it('runs a mutation with runAsync, outside any transaction, and commits its result', async () => {
    const driver = fakeDriver({ run: () => ({ lastInsertRowId: 42, changes: 1 }) });
    const { store, types, find } = await createTestStore({ database: driver });

    store.dispatch(
      fireflyAction('todo/add', { text: 'Buy milk' }, {
        sql: 'INSERT INTO todos (text) VALUES (?)',
        params: ['Buy milk'],
      })
    );
    await flush();

    expect(driver.runAsync).toHaveBeenCalledTimes(1);
    expect(driver.runAsync).toHaveBeenCalledWith('INSERT INTO todos (text) VALUES (?)', ['Buy milk']);
    expect(driver.withTransactionAsync).not.toHaveBeenCalled();
    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    expect(find('todo/add/commit').meta.firefly.result).toEqual({ lastInsertRowId: 42, changes: 1 });
  });

  it('runs a SELECT with getAllAsync and commits its rows', async () => {
    const driver = fakeDriver({ all: () => [{ id: 1 }, { id: 2 }] });
    const { store, find } = await createTestStore({ database: driver });

    store.dispatch(fireflyAction('todo/load', null, { sql: '  select * from todos' }));
    await flush();

    expect(driver.getAllAsync).toHaveBeenCalledWith('  select * from todos', []);
    expect(driver.runAsync).not.toHaveBeenCalled();
    expect(find('todo/load/commit').meta.firefly.result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('rolls back when it fails', async () => {
    const error = new Error('no such table: todos');
    const driver = fakeDriver({
      run: () => {
        throw error;
      },
    });
    const { store, types, find, onError } = await createTestStore({ database: driver });

    const action = fireflyAction('todo/add', { text: 'x' }, { sql: 'INSERT INTO todos DEFAULT VALUES' });
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
    expect(find('todo/add/rollback').payload).toEqual({ text: 'x' });
    expect(onError).toHaveBeenCalledWith(error, action);
  });
});

describe('array of raw SQL effects', () => {
  it('commits one { success, rows } per effect from one withTransactionAsync', async () => {
    const events: EventLog = [];
    const driver = fakeDriver({
      events,
      run: () => ({ lastInsertRowId: 5, changes: 1 }),
      all: () => [{ id: 5 }],
    });
    const { store, types, find } = await createTestStore({ database: driver });

    store.dispatch(
      fireflyAction('todo/add', null, [
        { sql: 'INSERT INTO todos DEFAULT VALUES' },
        { sql: 'SELECT * FROM todos' },
      ])
    );
    await flush();

    expect(driver.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'begin',
      'run:INSERT INTO todos DEFAULT VALUES',
      'all:SELECT * FROM todos',
      'commit',
    ]);
    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    expect(find('todo/add/commit').meta.firefly.result).toEqual([
      { success: true, rows: { lastInsertRowId: 5, changes: 1 } },
      { success: true, rows: [{ id: 5 }] },
    ]);
  });
});

describe('hand-built meta without commit or rollback', () => {
  const bare = (effect: unknown) => ({ type: 'todo/add', payload: null, meta: { firefly: { effect } } });

  it('runs the effect and dispatches nothing on success', async () => {
    const database = fakeDrizzleDatabase();
    const insert = fakeStatement({ changes: 1 });
    const { store, types, onError } = await createTestStore({ database });

    store.dispatch(bare(insert));
    await flush();

    expect(insert.awaited).toBe(1);
    expect(types()).toEqual(['todo/add']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('dispatches nothing on failure, and still reports to onError', async () => {
    const database = fakeDrizzleDatabase();
    const error = new Error('nope');
    const { store, types, onError } = await createTestStore({ database });

    const action = bare(failingStatement(error));
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['todo/add']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });
});

describe('writes dispatched together', () => {
  it('run one after the other, in dispatch order', async () => {
    const events: EventLog = [];
    const database = fakeDrizzleDatabase({ events });
    const { store, types } = await createTestStore({ database });

    store.dispatch(fireflyAction('a', null, { one: fakeStatement(1, { label: 'a-1', events }) }));
    store.dispatch(fireflyAction('b', null, [fakeStatement(2, { label: 'b-1', events })]));
    store.dispatch(fireflyAction('c', null, fakeStatement(3, { label: 'c-1', events })));
    await flush();

    expect(events).toEqual([
      'begin', 'a-1', 'commit',
      'begin', 'b-1', 'commit',
      'begin', 'c-1', 'commit',
    ]);
    expect(types()).toEqual(['a', 'b', 'c', 'a/commit', 'b/commit', 'c/commit']);
  });
});

describe('a commit dispatch that throws', () => {
  // As in 1.x, the middleware answers a commit dispatch that throws (a reducer
  // or a subscriber failing on it) with the rollback and onError. What 2.0
  // adds: both always get an Error, whatever was thrown.
  async function storeFailingOnCommit(thrown: unknown) {
    return createTestStore<{ touched: number }>({
      database: fakeDrizzleDatabase(),
      reducers: {
        touched: (state = 0, action) => {
          if (action.type === 'todo/add/commit') throw thrown;
          return state;
        },
      },
    });
  }

  it('hands the Error that was thrown to the rollback and to onError', async () => {
    const thrown = new Error('reducer blew up');
    const { store, types, find, onError } = await storeFailingOnCommit(thrown);

    const action = fireflyAction('todo/add', { id: 1 }, fakeStatement({ changes: 1 }));
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/commit', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(thrown);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(thrown, action);
  });

  it('wraps anything else in an Error first', async () => {
    const { store, types, find, onError } = await storeFailingOnCommit('reducer blew up');

    const action = fireflyAction('todo/add', { id: 1 }, fakeStatement({ changes: 1 }));
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/commit', 'todo/add/rollback']);
    const { error } = find('todo/add/rollback').meta.firefly;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('reducer blew up');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });
});
