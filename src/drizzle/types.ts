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
 * Hydration query using a drizzle select query.
 * Returns typed results directly — no transform needed.
 */
export interface DrizzleHydrationQuery<T = any> {
  query: DrizzleQuery<T>;
  transform?: (rows: T) => any;
}

/**
 * Extract result type from a DrizzleQuery.
 */
export type InferDrizzleResult<Q> = Q extends DrizzleQuery<infer T> ? T : any;
