import type { FireflyDriver } from './driver';
import type { FireflyEffect, FireflyEffectRecord, FireflyMeta, OperationResult } from './types';
import type { DrizzleQuery, DrizzleDatabaseLike } from './drizzle/types';
import { isDrizzleQuery } from './drizzle/detect';

/** Options for {@link executeOperation}. */
export interface ExecuteOperationOptions {
  /**
   * Run a bare single drizzle query through `database.transaction`.
   * See `FireflyConfig.transactionalSingleStatements`.
   * @default true
   */
  transactionalSingleStatements?: boolean;
}

/** One named slot of a record effect, as read at runtime. */
interface RecordSlot {
  name: string;
  /** A list slot commits an array (also when empty); a single slot, one result. */
  list: boolean;
  /** Unvalidated: `executeRecord` rejects anything that is not a statement. */
  statements: unknown[];
}

function isRawEffect(value: unknown): value is FireflyEffect {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sql?: unknown }).sql === 'string'
  );
}

/** An object literal (or `Object.create(null)`), as opposed to a class instance: a Promise, a Date, a Map. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  // The root prototype, whichever realm the object comes from.
  let root = prototype;
  while (Object.getPrototypeOf(root) !== null) root = Object.getPrototypeOf(root);
  return prototype === root;
}

/**
 * Whether an effect is a record of named slots: a plain object that is neither
 * a drizzle query nor a SQL effect. An object with a `sql` key is always read
 * as a SQL effect, so a record cannot name a slot `sql`.
 */
function isRecordEffect(value: unknown): value is FireflyEffectRecord {
  return isPlainObject(value) && !isDrizzleQuery(value) && !('sql' in value);
}

/** Why an effect that is none of the supported forms cannot run. */
function invalidEffectError(effect: unknown): Error {
  if (isPlainObject(effect) && 'sql' in effect) {
    return new Error(
      '[Firefly] A SQL effect needs a `sql` string. An object with a `sql` key is always read as a SQL effect, so a record effect cannot name a slot "sql"'
    );
  }
  if (typeof (effect as { then?: unknown } | null)?.then === 'function') {
    return new Error(
      '[Firefly] The effect is a Promise, not a drizzle query: return the query itself from `effect`, without awaiting or running it'
    );
  }
  return new Error(
    '[Firefly] The effect is not a drizzle query, a SQL effect, an array of them or a record of named slots'
  );
}

/**
 * Reads a record effect's slots in record order, dropping the skipped ones
 * (`undefined` / `null` / `false`, or any other falsy value). Record order is
 * `Object.keys` order.
 */
function readRecordSlots(record: FireflyEffectRecord): RecordSlot[] {
  const slots: RecordSlot[] = [];
  for (const [name, slot] of Object.entries(record)) {
    if (!slot) continue;
    if (Array.isArray(slot)) {
      slots.push({ name, list: true, statements: [...slot] });
    } else {
      slots.push({ name, list: false, statements: [slot] });
    }
  }
  return slots;
}

/**
 * Whether an effect has nothing to run: `undefined`, `null`, `[]`, `{}`, or a
 * record whose slots are all skipped or empty lists. The middleware treats such
 * a write as a no-op — no database work, no commit, no rollback.
 *
 * Arrays are positional, so only a zero-length array is empty. Only a record
 * can be empty: anything that is not an effect at all (a Promise, a Date, a
 * `{ sql }` object without a SQL string) is not, and fails when it runs.
 */
export function isEmptyEffect(effect: unknown): boolean {
  if (effect === null || effect === undefined) return true;
  if (Array.isArray(effect)) return effect.length === 0;
  if (!isRecordEffect(effect)) return false;
  return readRecordSlots(effect).every((slot) => slot.statements.length === 0);
}

/**
 * Executes a database operation or transaction.
 * Supports raw SQL effects and drizzle query objects — single, as an array, or
 * as a record of named slots.
 */
export async function executeOperation(
  db: FireflyDriver | DrizzleDatabaseLike,
  effect: FireflyMeta['effect'],
  options: ExecuteOperationOptions = {}
): Promise<OperationResult> {
  try {
    // Nothing to run. The middleware never gets here (it skips empty writes);
    // this keeps a direct caller off the database too.
    if (isEmptyEffect(effect)) {
      return { success: true };
    }

    // Array of effects — transaction
    if (Array.isArray(effect)) {
      const hasDrizzle = effect.some(isDrizzleQuery);
      if (hasDrizzle) {
        return await executeDrizzleTransaction(db as DrizzleDatabaseLike, effect as DrizzleQuery[]);
      }
      return await executeTransaction(db as FireflyDriver, effect as FireflyEffect[]);
    }

    // Single drizzle query
    if (isDrizzleQuery(effect)) {
      return await executeDrizzleQuery(
        db,
        effect,
        options.transactionalSingleStatements !== false
      );
    }

    // Single raw SQL effect
    if (isRawEffect(effect)) {
      return await executeRawEffect(db as FireflyDriver, effect);
    }

    // Record of named slots — transaction, results by name
    if (isRecordEffect(effect)) {
      return await executeRecord(db, effect);
    }

    // Not an effect: fail like any other write that cannot run, rather than
    // read a Promise or a Date as a record with no slots.
    throw invalidEffectError(effect);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Executes a single raw SQL effect, routing to the appropriate driver method.
 */
async function executeRawEffect(
  db: FireflyDriver,
  effect: FireflyEffect
): Promise<OperationResult> {
  const { sql, params = [] } = effect;
  const isQuery = sql.trim().toUpperCase().startsWith('SELECT');

  if (isQuery) {
    const rows = await db.getAllAsync(sql, params);
    return { success: true, rows };
  } else {
    const result = await db.runAsync(sql, params);
    return { success: true, rows: result };
  }
}

/**
 * Executes a single drizzle query.
 *
 * It goes through `db.transaction` like a list does, so on a database whose
 * transactions are queued it waits behind one that is already open instead of
 * running inside it. The query is self-contained (it carries its own db
 * reference), so it is awaited directly when no transaction can hold it: there
 * is no `transaction` function (a raw driver is configured), `transactional` is
 * off, or `transaction()` is synchronous and refuses an async callback.
 */
async function executeDrizzleQuery(
  db: FireflyDriver | DrizzleDatabaseLike,
  query: DrizzleQuery,
  transactional: boolean
): Promise<OperationResult> {
  if (transactional && hasTransaction(db)) {
    let rows: unknown;
    let ran = false;
    const refusal = await runDrizzleTransaction(db, async (run) => {
      // A runner may call this more than once (a retry): the last run counts.
      ran = false;
      rows = await run(query);
      ran = true;
    });
    if (!refusal) {
      // A transaction that resolves although its callback was never called did
      // not run the statement: that is no commit.
      if (!ran) {
        throw new Error('[Firefly] The transaction resolved before the statement ran');
      }
      return { success: true, rows };
    }
    // Refused, and the statement has not run: await it directly, as 1.x did.
  }

  const result = await query;
  return {
    success: true,
    rows: result,
  };
}

function hasTransaction(db: unknown): db is Pick<DrizzleDatabaseLike, 'transaction'> {
  return typeof (db as { transaction?: unknown } | null)?.transaction === 'function';
}

/** Starts one statement of a transaction, unless that transaction has already failed. */
type RunStatement = (statement: DrizzleQuery) => PromiseLike<any>;

/** `transaction()` threw with its callback still pending: it is synchronous. */
interface TransactionRefusal {
  /** What `transaction()` threw. */
  thrown: unknown;
}

/**
 * Runs `work` through `db.transaction`. `work` starts each of its statements
 * with the `run` it is given.
 *
 * A `transaction()` that is synchronous and refuses an async callback — drizzle's
 * better-sqlite3 driver: "Transaction function cannot return a promise" — throws
 * while the callback is still waiting to start its first statement. Left alone,
 * the statements would then run one by one outside any transaction, after the
 * write was reported as failed. So from that throw on `run` starts nothing, and
 * the refusal is returned once the callback has stopped: no statement ran.
 *
 * Any other failure is thrown as is, whether `transaction()` rejected or threw
 * before it called back.
 *
 * A `transaction()` that resolves is not the end of the write: the callback is.
 * A runner that does not wait for its callback — drizzle's durable-sqlite driver
 * drops its promise and returns `{}` — is over while the statements are still
 * running, on their own. They cannot be taken back, so their outcome is the
 * write's, as it is with a synchronous `transaction()` that returns the
 * callback's promise (drizzle's expo-sqlite driver). Likewise a runner that
 * resolves although its callback failed has not run the write.
 */
async function runDrizzleTransaction(
  db: Pick<DrizzleDatabaseLike, 'transaction'>,
  work: (run: RunStatement) => Promise<void>
): Promise<TransactionRefusal | undefined> {
  let refused = false;
  let pending: Promise<void> | undefined;

  // `await` calls `then` a microtask later, like it does on the statement
  // itself: by then a synchronous `transaction()` has thrown.
  const run: RunStatement = (statement) => ({
    then: (onFulfilled, onRejected) =>
      refused
        ? Promise.reject(new Error('[Firefly] The transaction has already failed')).then(onFulfilled, onRejected)
        : statement.then(onFulfilled ?? undefined, onRejected ?? undefined),
  });

  let transaction: Promise<void>;
  try {
    transaction = db.transaction(() => (pending = work(run)));
  } catch (thrown) {
    // Thrown before the callback was called: nothing is waiting to run.
    if (!pending) throw thrown;
    refused = true;
    // Nobody else holds the callback's promise: let it stop at `run`.
    await pending.catch(() => {});
    return { thrown };
  }
  await transaction;
  // The callback's last call: its statements have all run, or one has failed.
  await pending;
  return undefined;
}

/** Why an array or a record cannot run on a database that gave a {@link TransactionRefusal}. */
function synchronousTransactionError(refusal: TransactionRefusal): Error {
  const reason = refusal.thrown instanceof Error ? refusal.thrown.message : String(refusal.thrown);
  return new Error(
    `[Firefly] database.transaction() is synchronous and did not take an async callback (${reason}): an array or a record effect cannot run in one transaction on this database. No statement was run`
  );
}

/**
 * Executes multiple drizzle queries in a single transaction.
 */
async function executeDrizzleTransaction(
  db: DrizzleDatabaseLike,
  queries: DrizzleQuery[]
): Promise<OperationResult> {
  try {
    const results: OperationResult[] = [];

    const refusal = await runDrizzleTransaction(db, async (run) => {
      // A runner may call this more than once (a retry): keep the last run's results only.
      results.length = 0;
      for (const query of queries) {
        const result = await run(query);
        results.push({
          success: true,
          rows: result,
        });
      }
    });
    if (refusal) throw synchronousTransactionError(refusal);

    return { success: true, results };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Executes multiple raw SQL effects in a single transaction.
 * All operations must succeed, or all will be rolled back.
 */
async function executeTransaction(
  db: FireflyDriver,
  effects: FireflyEffect[]
): Promise<OperationResult> {
  try {
    let transactionResults: OperationResult[] = [];

    await db.withTransactionAsync(async () => {
      const opResults: OperationResult[] = [];

      for (const effect of effects) {
        const result = await executeRawEffect(db, effect);

        if (!result.success) {
          throw result.error || new Error('Operation failed');
        }

        opResults.push(result);
      }

      transactionResults = opResults;
    });

    return {
      success: true,
      results: transactionResults,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Executes a record effect: every slot's statements in ONE transaction, in
 * record order, with the results regrouped under the slot names — a single
 * slot's result as is, a list slot's as an array.
 *
 * Everything is checked before the transaction opens, so a malformed record
 * fails without running anything. A failing statement throws out of the
 * transaction, so there are never partial results.
 */
async function executeRecord(
  db: FireflyDriver | DrizzleDatabaseLike,
  record: FireflyEffectRecord
): Promise<OperationResult> {
  const slots = readRecordSlots(record);

  let drizzle = 0;
  let raw = 0;
  for (const slot of slots) {
    for (const statement of slot.statements) {
      if (isDrizzleQuery(statement)) drizzle++;
      else if (isRawEffect(statement)) raw++;
      else {
        throw new Error(
          `[Firefly] Record effect slot "${slot.name}" is not a drizzle query, a SQL effect, or a list of them`
        );
      }
    }
  }

  if (drizzle > 0 && raw > 0) {
    throw new Error(
      '[Firefly] A record effect cannot mix drizzle queries and raw SQL effects: they cannot share one transaction'
    );
  }

  // One result per statement, in the order they ran.
  const values: unknown[] = [];

  if (drizzle > 0) {
    if (!hasTransaction(db)) {
      throw new Error(
        '[Firefly] A record effect of drizzle queries needs a database with a transaction() method'
      );
    }
    const refusal = await runDrizzleTransaction(db, async (run) => {
      // A runner may call this more than once (a retry): keep the last run's results only.
      values.length = 0;
      for (const slot of slots) {
        for (const statement of slot.statements) {
          values.push(await run(statement as DrizzleQuery));
        }
      }
    });
    if (refusal) throw synchronousTransactionError(refusal);
  } else {
    const driver = db as FireflyDriver;
    if (typeof driver.withTransactionAsync !== 'function') {
      throw new Error(
        '[Firefly] A record effect of raw SQL effects needs a FireflyDriver (withTransactionAsync)'
      );
    }
    await driver.withTransactionAsync(async () => {
      values.length = 0;
      for (const slot of slots) {
        for (const statement of slot.statements) {
          values.push((await executeRawEffect(driver, statement as FireflyEffect)).rows);
        }
      }
    });
  }

  // A transaction that resolves before its callback finished would regroup the
  // wrong results under the wrong names.
  if (values.length !== drizzle + raw) {
    throw new Error('[Firefly] The transaction resolved before every statement of the record effect ran');
  }

  const named: Record<string, unknown> = {};
  let next = 0;
  for (const slot of slots) {
    const results = values.slice(next, next + slot.statements.length);
    next += slot.statements.length;
    named[slot.name] = slot.list ? results : results[0];
  }

  return { success: true, rows: named };
}
