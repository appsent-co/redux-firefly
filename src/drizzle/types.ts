/**
 * Structural type matching any drizzle query builder object.
 * Drizzle queries are promise-like (thenable) and expose .toSQL().
 * Uses structural typing so the core bundle never imports drizzle-orm.
 */
export interface DrizzleQuery<T = any> {
  then(
    onfulfilled?: (value: T) => any,
    onrejected?: (reason: any) => any
  ): Promise<any>;
  toSQL(): { sql: string; params: unknown[] };
}

/**
 * Structural type matching a drizzle database instance.
 * Used for database config detection and transaction support.
 */
export interface DrizzleDatabaseLike {
  select(...args: any[]): any;
  insert(...args: any[]): any;
  update(...args: any[]): any;
  delete(...args: any[]): any;
  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
}

/**
 * Hydration query using drizzle select query(ies).
 * Supports a single query or a tuple of queries.
 * When using a tuple, transform receives an array of OperationResult matching each query's result type.
 */
export interface DrizzleHydrationQuery<Q extends DrizzleQuery | readonly DrizzleQuery[] = DrizzleQuery, S = any> {
  query: Q;
  transform?: (rows: InferHydrationResult<Q>) => S;
}

/** Infers the transform input type for hydration queries. */
export type InferHydrationResult<Q> =
  Q extends DrizzleQuery<infer T> ? T :
  Q extends readonly DrizzleQuery[] ? MapDrizzleResults<Q> :
  any;

/** Maps a tuple of DrizzleQuery types to a tuple of OperationResult types. */
import type { OperationResult } from '../types';

export type MapDrizzleResults<T extends readonly DrizzleQuery[]> = {
  [K in keyof T]: T[K] extends DrizzleQuery<infer R> ? OperationResult<R> : OperationResult;
};
