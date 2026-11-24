import type { DriverMutationResult, DrizzleDatabaseLike, DrizzleQuery, FireflyDriver } from '../../src';

/**
 * What happened, in order. Statements and databases built over the same log
 * push to it, so a test can assert the whole sequence at once:
 * `['begin', 'profile', 'slot-1', 'commit']`.
 */
export type EventLog = string[];

export interface FakeStatementOptions {
  /** Name the statement logs when awaited. Default `'statement'`. */
  label?: string;
  /** Log to push the label to, each time the statement is awaited. */
  events?: EventLog;
}

/**
 * A fake drizzle statement: a thenable with `toSQL`, as redux-firefly detects
 * one, typed by the result it resolves to.
 */
export interface FakeStatement<T> extends DrizzleQuery<T> {
  readonly label: string;
  /** How many times the statement was awaited (i.e. ran). */
  readonly awaited: number;
}

function createStatement<T>(
  settle: () => Promise<T>,
  { label = 'statement', events }: FakeStatementOptions
): FakeStatement<T> {
  let awaited = 0;
  return {
    label,
    get awaited() {
      return awaited;
    },
    then(onFulfilled, onRejected) {
      awaited += 1;
      events?.push(label);
      return settle().then(onFulfilled, onRejected);
    },
    toSQL: () => ({ sql: `-- ${label}`, params: [] }),
  };
}

/** A statement that resolves to `result`. */
export function fakeStatement<T>(result: T, options: FakeStatementOptions = {}): FakeStatement<T> {
  return createStatement(() => Promise.resolve(result), options);
}

/** A statement that rejects with `error`. `T` is the result it would have had. */
export function failingStatement<T = unknown>(
  error: unknown,
  options: FakeStatementOptions = {}
): FakeStatement<T> {
  return createStatement<T>(() => Promise.reject(error), options);
}

type TransactionWork = (tx: any) => Promise<any>;

/** A fake drizzle database whose only real method is `transaction`. */
export interface FakeDrizzleDatabase extends DrizzleDatabaseLike {
  transaction: jest.Mock<Promise<any>, [TransactionWork]>;
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
}

function notImplemented(method: string): jest.Mock {
  return jest.fn(() => {
    throw new Error(`fake drizzle database: ${method}() is not implemented, only transaction() is`);
  });
}

function fakeDatabaseOver(transaction: (work: TransactionWork) => Promise<any>): FakeDrizzleDatabase {
  return {
    transaction: jest.fn(transaction),
    select: notImplemented('select'),
    insert: notImplemented('insert'),
    update: notImplemented('update'),
    delete: notImplemented('delete'),
  };
}

/** Runs `work` between `begin` and `commit` / `rollback` events. */
async function runTransaction(
  work: TransactionWork,
  events: EventLog | undefined,
  suffix = ''
): Promise<any> {
  events?.push(`begin${suffix}`);
  try {
    const result = await work(undefined);
    events?.push(`commit${suffix}`);
    return result;
  } catch (error) {
    events?.push(`rollback${suffix}`);
    throw error;
  }
}

/**
 * A fake `DrizzleDatabaseLike`: `transaction(work)` is a `jest.fn` that runs
 * `work(undefined)` and logs `begin`, then `commit` or `rollback`. The query
 * builders throw — the library must only ever call `transaction`.
 */
export function fakeDrizzleDatabase(options: { events?: EventLog } = {}): FakeDrizzleDatabase {
  return fakeDatabaseOver((work) => runTransaction(work, options.events));
}

export interface GatedDrizzleDatabase {
  /** `transaction(work)` waits its turn: transactions run one at a time. */
  database: FakeDrizzleDatabase;
  events: EventLog;
  /**
   * Opens a transaction of somebody else's (not counted in
   * `database.transaction`'s calls) and holds it open. It logs
   * `begin:<label>` when it opens and `commit:<label>` when it closes. Call the
   * returned function to close it; the promise resolves once it has closed.
   */
  hold(label?: string): () => Promise<void>;
}

/**
 * A fake drizzle database over a single-connection runner: transactions queue
 * and run one at a time, as on SQLite. With `hold()` keeping one open, a write
 * that goes through `database.transaction` WAITS until it closes — whereas a
 * statement awaited directly runs straight away, inside the open transaction.
 */
export function gatedDrizzleDatabase(options: { events?: EventLog } = {}): GatedDrizzleDatabase {
  const events = options.events ?? [];
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = (work: TransactionWork, suffix = ''): Promise<any> => {
    const run = tail.then(() => runTransaction(work, events, suffix));
    tail = run.catch(() => {});
    return run;
  };

  return {
    database: fakeDatabaseOver((work) => enqueue(work)),
    events,
    hold(label = 'held') {
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const transaction: Promise<void> = enqueue(() => closed, `:${label}`);
      return () => {
        close();
        return transaction;
      };
    },
  };
}

/**
 * A fake drizzle database whose `transaction()` is synchronous and refuses an
 * async callback, as drizzle's better-sqlite3 driver does: it calls the
 * callback, rolls back and THROWS (it does not reject) when the callback
 * returns a promise. It logs `begin`, then `rollback`.
 */
export function synchronousDrizzleDatabase(options: { events?: EventLog } = {}): FakeDrizzleDatabase {
  const { events } = options;
  return fakeDatabaseOver((work) => {
    events?.push('begin');
    const result: unknown = work(undefined);
    if (typeof (result as { then?: unknown } | null)?.then === 'function') {
      events?.push('rollback');
      throw new TypeError('Transaction function cannot return a promise');
    }
    events?.push('commit');
    return result as Promise<any>;
  });
}

/**
 * A fake drizzle database whose `transaction()` does not wait for its callback:
 * it calls it, drops the promise it returns and is over at once. It logs
 * `begin`, then `commit`.
 *
 * By default it RETURNS `{}`, not a promise, as drizzle's durable-sqlite driver
 * does. With `async: true` it returns a promise that is already resolved.
 */
export function unawaitingDrizzleDatabase(
  options: { events?: EventLog; async?: boolean } = {}
): FakeDrizzleDatabase {
  const { events } = options;
  return fakeDatabaseOver((work) => {
    events?.push('begin');
    void work(undefined);
    events?.push('commit');
    return (options.async ? Promise.resolve({}) : {}) as Promise<any>;
  });
}

/** A fake raw-SQL driver; every method is a `jest.fn`. */
export interface FakeDriver extends FireflyDriver {
  runAsync: jest.Mock<Promise<DriverMutationResult>, [string, any[]?]>;
  getAllAsync: jest.Mock<Promise<any[]>, [string, any[]?]>;
  withTransactionAsync: jest.Mock<Promise<void>, [() => Promise<void>]>;
}

export interface FakeDriverOptions {
  /** Logs `begin`, `run:<sql>`, `all:<sql>`, then `commit` or `rollback`. */
  events?: EventLog;
  /** Result of a mutation. Default: `{ lastInsertRowId: 1, changes: 1 }`. May throw. */
  run?: (sql: string, params: any[]) => DriverMutationResult;
  /** Rows of a SELECT. Default: `[]`. May throw. */
  all?: (sql: string, params: any[]) => any[];
}

/** A fake `FireflyDriver` (the raw-SQL path), with a real `withTransactionAsync`. */
export function fakeDriver(options: FakeDriverOptions = {}): FakeDriver {
  const { events, run, all } = options;
  return {
    runAsync: jest.fn(async (sql: string, params: any[] = []) => {
      events?.push(`run:${sql}`);
      return run ? run(sql, params) : { lastInsertRowId: 1, changes: 1 };
    }),
    getAllAsync: jest.fn(async (sql: string, params: any[] = []) => {
      events?.push(`all:${sql}`);
      return all ? all(sql, params) : [];
    }),
    withTransactionAsync: jest.fn(async (work: () => Promise<void>) => {
      await runTransaction(work, events);
    }),
  };
}
