import { executeOperation } from '../src/executor';
import {
  createTestStore,
  failingStatement,
  fakeDriver,
  fakeDrizzleDatabase,
  fakeStatement,
  fireflyAction,
  flush,
  gatedDrizzleDatabase,
  synchronousDrizzleDatabase,
  unawaitingDrizzleDatabase,
  type EventLog,
} from './helpers';

describe('single drizzle statement', () => {
  it('goes through database.transaction exactly once', async () => {
    const events: EventLog = [];
    const database = fakeDrizzleDatabase({ events });
    const { store } = await createTestStore({ database });

    store.dispatch(fireflyAction('todo/add', null, fakeStatement({ changes: 1 }, { label: 'insert', events })));
    await flush();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'insert', 'commit']);
  });

  it("commits the statement's own result, not wrapped", async () => {
    const database = fakeDrizzleDatabase();
    const { store, types, find } = await createTestStore({ database });
    const rows = [{ id: 't1', text: 'Buy milk' }];
    const payload = { text: 'Buy milk' };

    store.dispatch(fireflyAction('todo/add', payload, fakeStatement(rows)));
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    const commit = find('todo/add/commit');
    expect(commit.payload).toEqual(payload);
    expect(commit.meta.firefly.result).toBe(rows);
  });

  it('waits behind a transaction already open on the database, instead of running inside it', async () => {
    const { database, events, hold } = gatedDrizzleDatabase();
    const { store, types } = await createTestStore({ database });
    const insert = fakeStatement({ changes: 1 }, { label: 'insert', events });

    const close = hold('sync');
    store.dispatch(fireflyAction('todo/add', null, insert));
    await flush();

    // The other transaction is still open: the write has asked for its own and
    // is waiting for it. Nothing ran.
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(insert.awaited).toBe(0);
    expect(events).toEqual(['begin:sync']);
    expect(types()).toEqual(['todo/add']);

    await close();
    await flush();

    expect(insert.awaited).toBe(1);
    expect(events).toEqual(['begin:sync', 'commit:sync', 'begin', 'insert', 'commit']);
    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
  });

  it('rolls back when the statement fails', async () => {
    const events: EventLog = [];
    const database = fakeDrizzleDatabase({ events });
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('UNIQUE constraint failed');

    const action = fireflyAction('todo/add', { text: 'x' }, failingStatement(error, { label: 'insert', events }));
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
    expect(events).toEqual(['begin', 'insert', 'rollback']);
  });

  it('rolls back when the transaction resolves without having run its callback', async () => {
    const database = fakeDrizzleDatabase();
    database.transaction.mockImplementation(async () => undefined);
    const { store, types, find, onError } = await createTestStore({ database });
    const insert = fakeStatement({ changes: 1 });

    const action = fireflyAction('todo/add', { text: 'x' }, insert);
    store.dispatch(action);
    await flush();

    // The statement never ran: that is not a commit.
    expect(insert.awaited).toBe(0);
    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    const { error } = find('todo/add/rollback').meta.firefly;
    expect(error.message).toMatch(/resolved before the statement ran/);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });

  it('rolls back when the transaction swallows the failure of the statement', async () => {
    const database = fakeDrizzleDatabase();
    database.transaction.mockImplementation(async (work) => {
      try {
        await work(undefined);
      } catch {
        // A runner that does not rethrow.
      }
    });
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('UNIQUE constraint failed');

    store.dispatch(fireflyAction('todo/add', null, failingStatement(error)));
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('commits the result of the run that went through when the transaction retries its callback', async () => {
    const database = fakeDrizzleDatabase();
    database.transaction.mockImplementation(async (work) => {
      try {
        return await work(undefined);
      } catch {
        return await work(undefined);
      }
    });
    const { store, types, find, onError } = await createTestStore({ database });
    let runs = 0;
    const busyOnce = {
      then: (onFulfilled?: (value: { changes: number }) => any, onRejected?: (reason: any) => any) => {
        runs += 1;
        const run = runs === 1 ? Promise.reject(new Error('SQLITE_BUSY')) : Promise.resolve({ changes: runs });
        return run.then(onFulfilled, onRejected);
      },
      toSQL: () => ({ sql: '-- busy once', params: [] }),
    };

    store.dispatch(fireflyAction('todo/add', null, busyOnce));
    await flush();

    expect(runs).toBe(2);
    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    expect(find('todo/add/commit').meta.firefly.result).toEqual({ changes: 2 });
    expect(onError).not.toHaveBeenCalled();
  });

  // drizzle's better-sqlite3 driver: transaction() throws "Transaction function
  // cannot return a promise" while the statement is still to run.
  describe('on a database whose transaction() is synchronous and refuses an async callback', () => {
    it('awaits the statement directly, once, and commits its result', async () => {
      const events: EventLog = [];
      const database = synchronousDrizzleDatabase({ events });
      const { store, types, find, onError } = await createTestStore({ database });
      const insert = fakeStatement({ changes: 1 }, { label: 'insert', events });

      store.dispatch(fireflyAction('todo/add', { text: 'x' }, insert));
      await flush();

      // The refused transaction is over before the statement runs, on its own.
      expect(events).toEqual(['begin', 'rollback', 'insert']);
      expect(insert.awaited).toBe(1);
      expect(types()).toEqual(['todo/add', 'todo/add/commit']);
      expect(find('todo/add/commit').meta.firefly.result).toEqual({ changes: 1 });
      expect(onError).not.toHaveBeenCalled();
    });

    it("rolls back with the statement's own error when it fails", async () => {
      const database = synchronousDrizzleDatabase();
      const { store, types, find, onError } = await createTestStore({ database });
      const error = new Error('UNIQUE constraint failed');
      const insert = failingStatement(error);

      const action = fireflyAction('todo/add', { text: 'x' }, insert);
      store.dispatch(action);
      await flush();

      expect(insert.awaited).toBe(1);
      expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
      expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error, action);
    });

    it('returns the result as rows from executeOperation', async () => {
      const database = synchronousDrizzleDatabase();
      const insert = fakeStatement([{ id: 't1' }]);

      expect(await executeOperation(database, insert)).toEqual({ success: true, rows: [{ id: 't1' }] });
      expect(insert.awaited).toBe(1);
    });
  });

  // drizzle's durable-sqlite driver: transaction() calls the callback, drops its
  // promise and returns `{}`. The statement runs after it, on its own, and its
  // outcome is the write's, as in 1.x.
  describe.each([
    ['returns', false],
    ['resolves', true],
  ])('on a database whose transaction() %s before its callback finishes', (_, async) => {
    it('commits the result of the statement, which ran once', async () => {
      const events: EventLog = [];
      const database = unawaitingDrizzleDatabase({ events, async });
      const { store, types, find, onError } = await createTestStore({ database });
      const insert = fakeStatement({ changes: 1 }, { label: 'insert', events });

      store.dispatch(fireflyAction('todo/add', { text: 'x' }, insert));
      await flush();

      expect(events).toEqual(['begin', 'commit', 'insert']);
      expect(insert.awaited).toBe(1);
      expect(types()).toEqual(['todo/add', 'todo/add/commit']);
      expect(find('todo/add/commit').meta.firefly.result).toEqual({ changes: 1 });
      expect(onError).not.toHaveBeenCalled();
    });

    it("rolls back with the statement's own error when it fails", async () => {
      const database = unawaitingDrizzleDatabase({ async });
      const { store, types, find, onError } = await createTestStore({ database });
      const error = new Error('UNIQUE constraint failed');
      const insert = failingStatement(error);

      const action = fireflyAction('todo/add', { text: 'x' }, insert);
      store.dispatch(action);
      await flush();

      expect(insert.awaited).toBe(1);
      expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
      expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error, action);
    });

    it('returns the result as rows from executeOperation', async () => {
      const database = unawaitingDrizzleDatabase({ async });
      const insert = fakeStatement([{ id: 't1' }]);

      expect(await executeOperation(database, insert)).toEqual({ success: true, rows: [{ id: 't1' }] });
      expect(insert.awaited).toBe(1);
    });
  });

  it('rolls back without running the statement when transaction() throws before calling back', async () => {
    const database = fakeDrizzleDatabase();
    const error = new Error('cannot start a transaction within a transaction');
    database.transaction.mockImplementation(() => {
      throw error;
    });
    const { store, types, find, onError } = await createTestStore({ database });
    const insert = fakeStatement({ changes: 1 });

    store.dispatch(fireflyAction('todo/add', null, insert));
    await flush();

    expect(insert.awaited).toBe(0);
    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns the result as rows from executeOperation', async () => {
    const database = fakeDrizzleDatabase();
    const rows = [{ id: 't1' }];

    expect(await executeOperation(database, fakeStatement(rows))).toEqual({ success: true, rows });
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  describe('with transactionalSingleStatements: false', () => {
    it('awaits the statement directly, as 1.x did', async () => {
      const { database, events, hold } = gatedDrizzleDatabase();
      const { store, types, find } = await createTestStore({
        database,
        config: { transactionalSingleStatements: false },
      });
      const insert = fakeStatement({ changes: 1 }, { label: 'insert', events });

      const close = hold('sync');
      store.dispatch(fireflyAction('todo/add', null, insert));
      await flush();

      // No transaction of its own: it ran while the other one was still open.
      expect(database.transaction).not.toHaveBeenCalled();
      expect(insert.awaited).toBe(1);
      expect(events).toEqual(['begin:sync', 'insert']);
      expect(types()).toEqual(['todo/add', 'todo/add/commit']);
      expect(find('todo/add/commit').meta.firefly.result).toEqual({ changes: 1 });

      await close();
    });

    it('still runs arrays and records in a transaction', async () => {
      const database = fakeDrizzleDatabase();
      const { store, types } = await createTestStore({
        database,
        config: { transactionalSingleStatements: false },
      });

      store.dispatch(fireflyAction('todo/addMany', null, [fakeStatement(1)]));
      store.dispatch(fireflyAction('todo/save', null, { todo: fakeStatement(2) }));
      await flush();

      expect(database.transaction).toHaveBeenCalledTimes(2);
      expect(types()).toEqual(['todo/addMany', 'todo/save', 'todo/addMany/commit', 'todo/save/commit']);
    });
  });

  it('is awaited directly when the configured database has no transaction function', async () => {
    const driver = fakeDriver();
    const { store, types, find, onError } = await createTestStore({ database: driver });
    const insert = fakeStatement({ changes: 1 });

    store.dispatch(fireflyAction('todo/add', null, insert));
    await flush();

    expect(insert.awaited).toBe(1);
    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    expect(find('todo/add/commit').meta.firefly.result).toEqual({ changes: 1 });
    expect(onError).not.toHaveBeenCalled();
    expect(driver.withTransactionAsync).not.toHaveBeenCalled();
    expect(driver.runAsync).not.toHaveBeenCalled();
  });
});
