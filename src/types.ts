import type { Action } from 'redux';
import type { ReactReduxContextValue } from 'react-redux';
import type { FireflyDriver, DriverMutationResult } from './driver';
import type { DrizzleQuery, DrizzleDatabaseLike, DrizzleHydrationQuery, MapDrizzleResults } from './drizzle/types';

/**
 * A plain SQL effect.
 */
export interface FireflyEffect {
  sql: string;
  params?: any[];
}

/**
 * One named slot of a record effect: a single statement, a list of statements,
 * or nothing when the write does not need it. "Nothing" is `undefined`, `null`
 * or `false`, and the other falsy values a guard leaves behind: `0`, `0n` and
 * `''`, as in `ids.length && query` or `name && query`.
 */
export type FireflyEffectSlot =
  | DrizzleQuery
  | FireflyEffect
  | readonly (DrizzleQuery | FireflyEffect)[]
  | null
  | undefined
  | false
  | 0
  | 0n
  | '';

/**
 * A record effect: named statements that all run in one transaction, in record
 * order (slot order, then order inside a list slot). The commit carries the
 * results under the same names — see {@link FireflyRecordResults}.
 *
 * A slot cannot be named `sql`: an object with a `sql` key is always read as a
 * SQL effect.
 *
 * @example
 * effect: (p) => ({
 *   profile: db.update(profiles).set(p.profile).returning(),
 *   slots: p.slots.map((slot) => db.insert(slots).values(slot)),
 *   deleted: p.removeOld && db.delete(profiles).where(...),
 * })
 */
export type FireflyEffectRecord = { readonly [name: string]: FireflyEffectSlot } & { readonly sql?: never };

/**
 * Firefly metadata attached to Redux actions
 */
export interface FireflyMeta {
  /**
   * Database operation(s) to execute: a single effect or drizzle query, an
   * array of them (positional results), or a record of named slots (results by
   * name). All but the single raw-SQL form run in one transaction. An empty
   * effect (`undefined`, `null`, `[]`, `{}`, a record with nothing to run) is a
   * no-op: nothing runs and neither commit nor rollback is dispatched.
   */
  effect:
    | FireflyEffect
    | FireflyEffect[]
    | DrizzleQuery
    | DrizzleQuery[]
    | FireflyEffectRecord
    | null
    | undefined;
  /** Optional action to dispatch on successful operation */
  commit?: Action & Record<string, unknown>;
  /** Optional action to dispatch on failed operation */
  rollback?: Action & Record<string, unknown>;
  /** Original action payload, forwarded to commit/rollback actions */
  originalPayload?: unknown;
}

/**
 * Redux action with Firefly metadata
 */
export interface FireflyAction extends Action {
  meta: {
    firefly: FireflyMeta;
    [key: string]: any;
  };
}

/**
 * Action dispatched by the Firefly middleware on successful database operation
 */
export interface FireflyCommitAction<P = any, R = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      result: R;
    };
  };
}

/**
 * Action dispatched by the Firefly middleware on failed database operation
 */
export interface FireflyRollbackAction<P = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      error: Error;
    };
  };
}

/**
 * What a commit carries once unpacked: the original payload and the effect's
 * results (by name for a record effect).
 */
export interface FireflyCommitted<P = any, R = any> {
  payload: P;
  results: R;
}

/**
 * What a rollback carries once unpacked: the original payload and the error
 * that failed the write. The database is unchanged.
 */
export interface FireflyRolledBack<P = any> {
  payload: P;
  error: Error;
}

/**
 * Type guard to check if an action is a Firefly action.
 *
 * An action whose effect is `null` or `undefined` is not one (there is nothing
 * to run). `[]` and `{}` still are — structurally Firefly actions — and the
 * middleware skips them as empty writes.
 */
export function isFireflyAction(action: unknown): action is FireflyAction {
  if (typeof action !== 'object' || action === null) {
    return false;
  }

  if (!('meta' in action) || typeof action.meta !== 'object' || action.meta === null) {
    return false;
  }

  const meta = action.meta as Record<string, unknown>;
  if (!('firefly' in meta) || typeof meta.firefly !== 'object' || meta.firefly === null) {
    return false;
  }

  const firefly = meta.firefly as Record<string, unknown>;
  // `typeof null === 'object'`, so null needs its own check.
  return 'effect' in firefly && typeof firefly.effect === 'object' && firefly.effect !== null;
}

/**
 * A decoded primary-key / column value, preserving its SQL type. Matches
 * `@fireflydb/core`'s `MergedValue` — INTEGER columns decode to `bigint`
 * (i64; avoids precision loss past 2^53).
 */
export type MergedValue = null | bigint | number | string | Uint8Array;

/**
 * One row resolved by a FireflyDB merge, with the post-merge value of every
 * column. Mirrors the `MergedRow` exported by `@fireflydb/core` **structurally**
 * (redux-firefly never imports `@fireflydb/core`), so the rows a `FireflyClient`
 * change event carries can be passed straight through to a slice's `apply`.
 */
export interface MergedRow {
  /** Table the changed row belongs to. */
  table: string;
  /** Decoded primary-key value(s): single column unwrapped, composite = array. */
  key: MergedValue | MergedValue[];
  /** Raw packed primary-key bytes (for opaque compare / re-pack). */
  pk: Uint8Array;
  /** Column name → decoded value. `{}` for a delete. */
  columns: Record<string, MergedValue>;
  /** True when the row carries a tombstone. */
  deleted: boolean;
}

/**
 * The merged rows for one table, split into upserts (live rows) and deletes
 * (tombstones), as handed to an {@link ApplyRowsConfig}'s `apply`.
 */
export interface ApplyRowsChanges {
  /** Rows whose values should be inserted/updated. */
  upserts: readonly MergedRow[];
  /** Rows that were deleted (tombstones) and should be removed. */
  deletes: readonly MergedRow[];
}

/**
 * Binds a slice to a table: when a change event carries merged rows for
 * `table`, `apply` receives them (with the current slice state) and returns the
 * next state — a plain reducer over rows, no SQL involved.
 */
export interface ApplyRowsConfig<State = any> {
  /** The table whose merged rows drive this slice. Matched case-insensitively. */
  table: string;
  /** Pure reducer: given the current slice state and the changes, return the next state. */
  apply: (state: State, changes: ApplyRowsChanges) => State;
}

/**
 * Minimal shape of a FireflyDB change event. `merged` carries the rows resolved
 * by the merge (remote changes only); events without rows are ignored.
 */
export interface FireflyChangeEvent {
  source?: 'local' | 'remote';
  merged?: readonly MergedRow[];
}

/**
 * Structural slice of a FireflyDB `FireflyClient`: its change subscription.
 * Pass the client itself as `FireflyConfig.changes`.
 */
export interface FireflyChangeSource {
  subscribeToChanges(handler: (event: FireflyChangeEvent) => void): { remove: () => void };
}

/**
 * Configuration for the Firefly middleware
 */
export interface FireflyConfig {
  /** Database driver instance or drizzle database */
  database: FireflyDriver | DrizzleDatabaseLike;
  /**
   * A FireflyDB `FireflyClient` (or anything with its `subscribeToChanges`).
   * Each change event's merged rows are dispatched to the `applyRows` reducers
   * whose table matches — that is how remote changes reach the store.
   */
  changes?: FireflyChangeSource;
  /** Optional error handler called when operations fail */
  onError?: (error: Error, action: FireflyAction) => void;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Serialize middleware DB effects so only one runs at a time.
   * Required for single-connection drivers (expo-sqlite, better-sqlite3) to
   * avoid "cannot start a transaction within a transaction". Set `false` for
   * pooled drivers (pg, mysql2) where the pool handles concurrency and
   * serialization would throw away real parallelism — and set
   * `transactionalSingleStatements` to `false` with it.
   * @default true
   */
  serializeEffects?: boolean;
  /**
   * Run a bare single drizzle query through `database.transaction`, like a
   * list, so it waits behind a transaction already open on the same database
   * instead of running inside it. Set `false` to await the query directly as
   * 1.x did. Arrays and record effects always use a transaction.
   *
   * A database whose `transaction()` is synchronous and refuses an async
   * callback (drizzle's better-sqlite3 driver) cannot hold the query: it is
   * awaited directly there whatever this option says, and arrays and record
   * effects roll back without running anything.
   *
   * Set it to `false` for a pooled driver. There the transaction holds one
   * connection while the query, built on the database and not on the
   * transaction, takes a second one: with `serializeEffects: false`, as many
   * concurrent writes as the pool has connections wait on each other forever.
   * @default true
   */
  transactionalSingleStatements?: boolean;
}

/**
 * Single hydration query configuration
 */
export interface HydrationQuery {
  /** SQL SELECT query to fetch initial data */
  query: string;
  /** Optional parameters for the query */
  params?: (string | number | null | boolean | Uint8Array)[];
  /** Optional transform function to shape the query results */
  transform?: (rows: any[]) => any;
}

/**
 * Hydration configuration for multiple slices
 * Maps slice names to their query configurations (SQL or drizzle)
 */
export type HydrationConfig = {
  [sliceName: string]: HydrationQuery | DrizzleHydrationQuery<any, any>;
};

/**
 * Props for the FireflyGate React component
 */
export interface FireflyGateProps {
  /** Optional component to show while hydrating */
  loading?: React.ReactNode;
  /** App content to render after hydration */
  children: React.ReactNode;
  /** Optional callback invoked before hydration */
  onBeforeHydrate?: () => void;
  /** Optional custom react-redux context for multi-store setups */
  context?: React.Context<ReactReduxContextValue<unknown, never> | null>;
}

/**
 * Extended store interface with hydration status
 */
export interface FireflyStore {
  /** Promise that resolves when hydration completes */
  hydrated: Promise<void>;
  /** Synchronous check for hydration status */
  isHydrated: () => boolean;
  /** Subscribe to hydration status changes */
  onHydrationChange: (callback: (hydrated: boolean) => void) => () => void;
  /**
   * Re-run hydration for every slice. Live changes arrive as merged rows via
   * `config.changes`; this is the manual escape hatch for anything that
   * bypasses them (e.g. after an explicit `client.sync()` pull).
   */
  refreshAll: () => Promise<void>;
  /**
   * Tear down the change subscription (if `config.changes` was set). Call on
   * store disposal / hot reload / in tests to avoid leaking the listener.
   */
  dispose: () => void;
}

/** The result of one statement of a record effect. */
type FireflyStatementResult<Q> =
  Q extends DrizzleQuery<infer R> ? R :
  Q extends FireflyEffect ? DriverMutationResult :
  never;

/**
 * The result a record effect's slot commits:
 *
 * - a single statement → that statement's result
 * - a list of statements → one result per statement (`[]` for an empty list)
 * - a skipped slot (`undefined` / `null` / `false`, or another falsy value)
 *   → `undefined`
 *
 * Distributes over unions, so `cond && query` gives `Result | undefined`,
 * whatever falsy value `cond` leaves behind.
 */
export type FireflySlotResult<V> =
  V extends DrizzleQuery<infer R> ? R :
  V extends FireflyEffect ? DriverMutationResult :
  V extends readonly (infer Q)[] ? FireflyStatementResult<Q>[] :
  undefined;

/** What each named slot of a record effect returned, under the same names. */
export type FireflyRecordResults<S> = { -readonly [K in keyof S]: FireflySlotResult<S[K]> };

/**
 * `E`, read as a record: every property a slot, none named `sql`. Mapped over
 * `E`'s own keys rather than checked against {@link FireflyEffectRecord}'s
 * index signature, so that a record typed by an interface is one too.
 */
type FireflyRecordOf<E> = { readonly [K in keyof E]: K extends 'sql' ? never : FireflyEffectSlot };

/**
 * Infers the commit result type from the effect type.
 *
 * - DrizzleQuery<R> → R (e.g. SQLiteRunResult for inserts, Row[] for selects)
 * - DrizzleQuery[] → MapDrizzleResults (tuple of OperationResult per query)
 * - FireflyEffect (RAW) → DriverMutationResult
 * - FireflyEffect[] → OperationResult[]
 * - a record of slots → FireflyRecordResults (each slot's result, by name)
 * - null / undefined → never (an empty write never commits)
 *
 * The record branch comes last: a query, an array and a raw effect are objects
 * too, and must not be read as records.
 */
export type InferEffectResult<E> =
  E extends null | undefined ? never :
  E extends DrizzleQuery<infer R> ? R :
  E extends readonly DrizzleQuery[] ? MapDrizzleResults<E> :
  E extends FireflyEffect ? DriverMutationResult :
  E extends readonly FireflyEffect[] ? OperationResult[] :
  E extends readonly unknown[] ? any :
  E extends object ? (E extends FireflyRecordOf<E> ? FireflyRecordResults<E> : any) :
  any;

/**
 * Result of a database operation
 */
export interface OperationResult<T = any> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Operation result — query rows, mutation metadata, or drizzle result */
  rows?: T;
  /** Error if operation failed */
  error?: Error;
  /** Results from transaction (array of OperationResult) */
  results?: OperationResult[];
}
