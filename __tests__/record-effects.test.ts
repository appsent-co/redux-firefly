import { executeOperation } from '../src/executor';
import type { FireflyEffectRecord } from '../src';
import {
  createTestStore,
  failingStatement,
  fakeDriver,
  fakeDrizzleDatabase,
  fakeStatement,
  fireflyAction,
  flush,
  synchronousDrizzleDatabase,
  unawaitingDrizzleDatabase,
  type EventLog,
} from './helpers';

/** A fake drizzle database and a statement factory sharing one event log. */
function drizzle() {
  const events: EventLog = [];
  const database = fakeDrizzleDatabase({ events });
  return {
    events,
    database,
    statement: <T>(label: string, result: T) => fakeStatement(result, { label, events }),
    failing: (label: string, error: unknown) => failingStatement(error, { label, events }),
  };
}

describe('record effect of drizzle queries', () => {
  it('commits each slot result under its name, whatever the slot shape', async () => {
    const { database, statement } = drizzle();
    const { store, types, find, onError } = await createTestStore({ database });
    const payload = { id: 'p1' };

    store.dispatch(
      fireflyAction('profile/save', payload, {
        profile: statement('profile', [{ id: 'p1', name: 'Ada' }]),
        slots: [statement('slot-1', { changes: 1 }), statement('slot-2', { changes: 2 })],
        noSlots: [],
        skippedUndefined: undefined,
        skippedNull: null,
        skippedFalse: false,
        deleted: statement('deleted', { changes: 3 }),
      })
    );
    await flush();

    expect(types()).toEqual(['profile/save', 'profile/save/commit']);
    const commit = find('profile/save/commit');
    expect(commit.payload).toEqual(payload);

    const results = commit.meta.firefly.result;
    // single slot → that statement's result
    expect(results.profile).toEqual([{ id: 'p1', name: 'Ada' }]);
    expect(results.deleted).toEqual({ changes: 3 });
    // list slot → one result per statement, an array even when the list is empty
    expect(results.slots).toEqual([{ changes: 1 }, { changes: 2 }]);
    expect(results.noSlots).toEqual([]);
    // skipped slot → undefined
    expect(results.skippedUndefined).toBeUndefined();
    expect(results.skippedNull).toBeUndefined();
    expect(results.skippedFalse).toBeUndefined();

    expect(onError).not.toHaveBeenCalled();
  });

  it('skips a slot that a guard left falsy, whatever the falsy value', async () => {
    const { database, events, statement } = drizzle();
    const { store, types, find } = await createTestStore({ database });
    const ids: string[] = [];
    const name = '';

    store.dispatch(
      fireflyAction('profile/save', null, {
        profile: statement('profile', { changes: 1 }),
        // `count && query` and `text && query` leave 0 and '' behind, not false.
        removed: ids.length && statement('removed', { changes: 2 }),
        renamed: name && statement('renamed', { changes: 3 }),
        counted: 0n,
      })
    );
    await flush();

    expect(events).toEqual(['begin', 'profile', 'commit']);
    expect(types()).toEqual(['profile/save', 'profile/save/commit']);
    const results = find('profile/save/commit').meta.firefly.result;
    expect(results).toEqual({ profile: { changes: 1 } });
    expect(results.removed).toBeUndefined();
    expect(results.renamed).toBeUndefined();
    expect(results.counted).toBeUndefined();
  });

  it('runs every statement in record order inside exactly one transaction', async () => {
    const { database, events, statement } = drizzle();
    const { store } = await createTestStore({ database });

    store.dispatch(
      fireflyAction('profile/save', null, {
        first: statement('first', 1),
        list: [statement('list-1', 2), statement('list-2', 3)],
        skipped: false,
        last: statement('last', 4),
      })
    );
    await flush();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'first', 'list-1', 'list-2', 'last', 'commit']);
  });

  it('runs a one-statement record through the transaction too', async () => {
    const { database, events, statement } = drizzle();
    const { store, find } = await createTestStore({ database });

    store.dispatch(fireflyAction('task/add', null, { task: statement('task', [{ id: 't1' }]) }));
    await flush();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['begin', 'task', 'commit']);
    expect(find('task/add/commit').meta.firefly.result).toEqual({ task: [{ id: 't1' }] });
  });

  it('only ever touches the database through transaction()', async () => {
    const { database, statement } = drizzle();
    const { store } = await createTestStore({ database });

    store.dispatch(fireflyAction('task/add', null, { task: statement('task', 1), more: [statement('more', 2)] }));
    await flush();

    expect(database.select).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.delete).not.toHaveBeenCalled();
    // The callback is called with no transaction handle to rely on.
    expect(database.transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('fails as a whole when one statement fails: rollback, one onError, no commit, no partial results', async () => {
    const { database, events, statement, failing } = drizzle();
    const { store, types, find, onError } = await createTestStore({ database });
    const error = new Error('UNIQUE constraint failed');
    const payload = { id: 'p1' };
    const afterFailure = statement('after', 3);

    const action = fireflyAction('profile/save', payload, {
      before: statement('before', 1),
      broken: failing('broken', error),
      after: afterFailure,
    });
    store.dispatch(action);
    await flush();

    expect(types()).toEqual(['profile/save', 'profile/save/rollback']);
    const rollback = find('profile/save/rollback');
    expect(rollback.payload).toEqual(payload);
    expect(rollback.meta.firefly.error).toBe(error);
    expect(rollback.meta.firefly).not.toHaveProperty('result');

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);

    // The transaction was abandoned at the failing statement.
    expect(events).toEqual(['begin', 'before', 'broken', 'rollback']);
    expect(afterFailure.awaited).toBe(0);
  });

  it('rolls back with an Error even when a statement rejects with something else', async () => {
    const { database, failing } = drizzle();
    const { store, find, onError } = await createTestStore({ database });

    store.dispatch(fireflyAction('profile/save', null, { broken: failing('broken', 'disk full') }));
    await flush();

    const { error } = find('profile/save/rollback').meta.firefly;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('disk full');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("hands the action's own meta to onError", async () => {
    const { database, failing } = drizzle();
    const { store, onError } = await createTestStore({ database });
    const failure = { titleKey: 'errors.save.title', messageKey: 'errors.save.message' };

    store.dispatch(
      fireflyAction('profile/save', null, { broken: failing('broken', new Error('nope')) }, { failure })
    );
    await flush();

    expect(onError.mock.calls[0][1].meta.failure).toEqual(failure);
  });

  it('fails cleanly, without opening a transaction, when the database cannot run one', async () => {
    const { statement } = drizzle();
    const driver = fakeDriver();
    const task = statement('task', 1);
    const { store, types, find } = await createTestStore({ database: driver });

    store.dispatch(fireflyAction('task/add', null, { task }));
    await flush();

    expect(types()).toEqual(['task/add', 'task/add/rollback']);
    expect(find('task/add/rollback').meta.firefly.error.message).toMatch(/transaction\(\)/);
    expect(task.awaited).toBe(0);
    expect(driver.withTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('record effect over a transaction runner that misbehaves, or retries', () => {
  /** A statement that fails the first time it runs and resolves to `result` after that. */
  function busyOnce<T>(label: string, result: T, events: EventLog) {
    let runs = 0;
    return {
      then: (onFulfilled?: (value: T) => any, onRejected?: (reason: any) => any) => {
        runs += 1;
        events.push(`${label}#${runs}`);
        const run = runs === 1 ? Promise.reject(new Error('SQLITE_BUSY')) : Promise.resolve(result);
        return run.then(onFulfilled, onRejected);
      },
      toSQL: () => ({ sql: `-- ${label}`, params: [] }),
    };
  }

  /** Runs the callback again, once, when it fails. */
  function retryOnce(database: ReturnType<typeof fakeDrizzleDatabase>) {
    database.transaction.mockImplementation(async (work) => {
      try {
        return await work(undefined);
      } catch {
        return await work(undefined);
      }
    });
  }

  it('commits the results of the run that went through when the transaction retries its callback', async () => {
    const { database, events, statement } = drizzle();
    retryOnce(database);
    const { store, types, find, onError } = await createTestStore({ database });

    store.dispatch(
      fireflyAction('profile/save', null, {
        profile: statement('profile', [{ id: 'p1' }]),
        slots: [statement('slot', { changes: 1 }), busyOnce('busy', { changes: 2 }, events)],
      })
    );
    await flush();

    // The first run failed at the last statement; the second went through.
    expect(events).toEqual(['profile', 'slot', 'busy#1', 'profile', 'slot', 'busy#2']);
    expect(types()).toEqual(['profile/save', 'profile/save/commit']);
    // Nothing of the abandoned run is left in the results.
    expect(find('profile/save/commit').meta.firefly.result).toEqual({
      profile: [{ id: 'p1' }],
      slots: [{ changes: 1 }, { changes: 2 }],
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the results of an array positional when the transaction retries its callback', async () => {
    const { database, events, statement } = drizzle();
    retryOnce(database);
    const { store, find } = await createTestStore({ database });

    store.dispatch(
      fireflyAction('profile/save', null, [statement('first', 1), busyOnce('busy', 2, events)])
    );
    await flush();

    expect(find('profile/save/commit').meta.firefly.result).toEqual([
      { success: true, rows: 1 },
      { success: true, rows: 2 },
    ]);
  });

  it('rolls back when the transaction resolves without having run its callback', async () => {
    const { database, statement } = drizzle();
    database.transaction.mockImplementation(async () => undefined);
    const { store, types, find, onError } = await createTestStore({ database });
    const profile = statement('profile', 1);

    store.dispatch(fireflyAction('profile/save', null, { profile }));
    await flush();

    expect(profile.awaited).toBe(0);
    expect(types()).toEqual(['profile/save', 'profile/save/rollback']);
    expect(find('profile/save/rollback').meta.firefly.error.message).toMatch(/resolved before every statement/);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rolls back without running any statement when transaction() is synchronous and refuses the async callback', async () => {
    const events: EventLog = [];
    const database = synchronousDrizzleDatabase({ events });
    const { store, types, find, onError } = await createTestStore({ database });
    const profile = fakeStatement(1, { label: 'profile', events });
    const slots = [fakeStatement(2, { label: 'slot-1', events }), fakeStatement(3, { label: 'slot-2', events })];

    const action = fireflyAction('profile/save', null, { profile, slots });
    store.dispatch(action);
    await flush();

    // Nothing may run once its transaction has failed: the rollback would lie.
    expect(events).toEqual(['begin', 'rollback']);
    expect(profile.awaited).toBe(0);
    expect(slots.map((slot) => slot.awaited)).toEqual([0, 0]);
    expect(types()).toEqual(['profile/save', 'profile/save/rollback']);
    const { error } = find('profile/save/rollback').meta.firefly;
    expect(error.message).toMatch(/transaction\(\) is synchronous/);
    expect(error.message).toMatch(/Transaction function cannot return a promise/);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, action);
  });

  // drizzle's durable-sqlite driver: transaction() calls the callback, drops its
  // promise and returns `{}`. The statements run after it, on their own.
  describe.each([
    ['returns', false],
    ['resolves', true],
  ])('when transaction() %s before its callback finishes', (_, async) => {
    it('commits once every statement has run, with the results under their names', async () => {
      const events: EventLog = [];
      const database = unawaitingDrizzleDatabase({ events, async });
      const { store, types, find, onError } = await createTestStore({ database });

      store.dispatch(
        fireflyAction('profile/save', null, {
          profile: fakeStatement([{ id: 'p1' }], { label: 'profile', events }),
          slots: [
            fakeStatement({ changes: 1 }, { label: 'slot-1', events }),
            fakeStatement({ changes: 2 }, { label: 'slot-2', events }),
          ],
        })
      );
      await flush();

      expect(events).toEqual(['begin', 'commit', 'profile', 'slot-1', 'slot-2']);
      expect(types()).toEqual(['profile/save', 'profile/save/commit']);
      expect(find('profile/save/commit').meta.firefly.result).toEqual({
        profile: [{ id: 'p1' }],
        slots: [{ changes: 1 }, { changes: 2 }],
      });
      expect(onError).not.toHaveBeenCalled();
    });

    it("rolls back with the statement's own error when one fails, and runs none after it", async () => {
      const events: EventLog = [];
      const database = unawaitingDrizzleDatabase({ events, async });
      const { store, types, find, onError } = await createTestStore({ database });
      const error = new Error('constraint');
      const last = fakeStatement(3, { label: 'last', events });

      const action = fireflyAction('profile/save', null, {
        profile: fakeStatement(1, { label: 'profile', events }),
        slots: [failingStatement(error, { label: 'broken', events }), last],
      });
      store.dispatch(action);
      await flush();

      expect(events).toEqual(['begin', 'commit', 'profile', 'broken']);
      expect(last.awaited).toBe(0);
      expect(types()).toEqual(['profile/save', 'profile/save/rollback']);
      expect(find('profile/save/rollback').meta.firefly.error).toBe(error);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error, action);
    });
  });

  it('commits a record of raw SQL effects once when withTransactionAsync retries its callback', async () => {
    const driver = fakeDriver();
    let attempts = 0;
    driver.runAsync.mockImplementation(async (sql: string) => {
      attempts += 1;
      if (attempts === 2) throw new Error('SQLITE_BUSY');
      return { lastInsertRowId: attempts, changes: sql.length };
    });
    driver.withTransactionAsync.mockImplementation(async (work) => {
      try {
        await work();
      } catch {
        await work();
      }
    });
    const { store, find } = await createTestStore({ database: driver });

    store.dispatch(fireflyAction('todo/add', null, { a: { sql: 'A' }, b: { sql: 'BB' } }));
    await flush();

    // Attempts 1 and 2 were the abandoned run, 3 and 4 the one that committed.
    expect(find('todo/add/commit').meta.firefly.result).toEqual({
      a: { lastInsertRowId: 3, changes: 1 },
      b: { lastInsertRowId: 4, changes: 2 },
    });
  });
});

describe('record effect of raw SQL effects', () => {
  it('runs in one withTransactionAsync and commits results by name', async () => {
    const events: EventLog = [];
    const driver = fakeDriver({
      events,
      run: (sql) => ({ lastInsertRowId: sql.startsWith('INSERT') ? 7 : 0, changes: 1 }),
      all: () => [{ id: 7, text: 'Buy milk' }],
    });
    const { store, types, find, onError } = await createTestStore({ database: driver });

    store.dispatch(
      fireflyAction('todo/add', { text: 'Buy milk' }, {
        created: { sql: 'INSERT INTO todos (text) VALUES (?)', params: ['Buy milk'] },
        todos: { sql: 'SELECT * FROM todos' },
        touched: [{ sql: 'UPDATE lists SET n = n + 1' }, { sql: 'UPDATE stats SET n = n + 1' }],
        none: [],
        skipped: null,
      })
    );
    await flush();

    expect(driver.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'begin',
      'run:INSERT INTO todos (text) VALUES (?)',
      'all:SELECT * FROM todos',
      'run:UPDATE lists SET n = n + 1',
      'run:UPDATE stats SET n = n + 1',
      'commit',
    ]);
    expect(driver.runAsync).toHaveBeenCalledWith('INSERT INTO todos (text) VALUES (?)', ['Buy milk']);

    expect(types()).toEqual(['todo/add', 'todo/add/commit']);
    const results = find('todo/add/commit').meta.firefly.result;
    expect(results.created).toEqual({ lastInsertRowId: 7, changes: 1 });
    expect(results.todos).toEqual([{ id: 7, text: 'Buy milk' }]);
    expect(results.touched).toEqual([
      { lastInsertRowId: 0, changes: 1 },
      { lastInsertRowId: 0, changes: 1 },
    ]);
    expect(results.none).toEqual([]);
    expect(results.skipped).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails as a whole when one effect fails', async () => {
    const events: EventLog = [];
    const error = new Error('no such table: stats');
    const driver = fakeDriver({
      events,
      run: (sql) => {
        if (sql.includes('stats')) throw error;
        return { lastInsertRowId: 1, changes: 1 };
      },
    });
    const { store, types, find, onError } = await createTestStore({ database: driver });

    store.dispatch(
      fireflyAction('todo/add', null, {
        created: { sql: 'INSERT INTO todos DEFAULT VALUES' },
        stats: { sql: 'UPDATE stats SET n = n + 1' },
        never: { sql: 'UPDATE lists SET n = n + 1' },
      })
    );
    await flush();

    expect(types()).toEqual(['todo/add', 'todo/add/rollback']);
    expect(find('todo/add/rollback').meta.firefly.error).toBe(error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'begin',
      'run:INSERT INTO todos DEFAULT VALUES',
      'run:UPDATE stats SET n = n + 1',
      'rollback',
    ]);
  });
});

describe('malformed record effect', () => {
  it('refuses a record mixing drizzle queries and raw effects, before running anything', async () => {
    const { database, events, statement } = drizzle();
    const driver = fakeDriver({ events });
    const query = statement('query', 1);
    const { store, types, find, onError } = await createTestStore({
      // A database able to run either kind: the mix itself is the error.
      database: { ...database, ...driver },
    });

    store.dispatch(
      fireflyAction('profile/save', null, {
        query,
        raw: { sql: 'UPDATE profiles SET seen = 1' },
      })
    );
    await flush();

    expect(types()).toEqual(['profile/save', 'profile/save/rollback']);
    expect(find('profile/save/rollback').meta.firefly.error.message).toMatch(/mix/);
    expect(onError).toHaveBeenCalledTimes(1);

    expect(events).toEqual([]);
    expect(query.awaited).toBe(0);
    expect(database.transaction).not.toHaveBeenCalled();
    expect(driver.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('refuses a mix hidden inside a list slot', async () => {
    const { database, statement } = drizzle();
    const query = statement('query', 1);

    const result = await executeOperation(database, {
      list: [query, { sql: 'UPDATE profiles SET seen = 1' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/mix/);
    expect(query.awaited).toBe(0);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('refuses a slot that is not a statement, naming it, before running anything', async () => {
    const { database, statement } = drizzle();
    const query = statement('query', 1);
    const record = { query, oops: 'DELETE FROM profiles' } as unknown as FireflyEffectRecord;

    const result = await executeOperation(database, record);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/"oops"/);
    expect(result.rows).toBeUndefined();
    expect(query.awaited).toBe(0);
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

describe('executeOperation with a record effect', () => {
  it('returns the named results as rows', async () => {
    const { database, statement } = drizzle();

    const result = await executeOperation(database, {
      task: statement('task', [{ id: 't1' }]),
      assignees: [statement('assignee-1', { changes: 1 })],
      seed: undefined,
    });

    expect(result).toEqual({
      success: true,
      rows: { task: [{ id: 't1' }], assignees: [{ changes: 1 }] },
    });
  });

  it('returns no rows when a statement fails', async () => {
    const { database, statement, failing } = drizzle();
    const error = new Error('boom');

    const result = await executeOperation(database, {
      task: statement('task', [{ id: 't1' }]),
      broken: failing('broken', error),
    });

    expect(result).toEqual({ success: false, error });
  });
});
