import type { DrizzleQuery, DrizzleDatabaseLike, DrizzleHydrationQuery } from './types';
import type { FireflyDriver } from '../driver';

/**
 * Checks if a value is a drizzle query builder (thenable with .toSQL()).
 */
export function isDrizzleQuery(value: unknown): value is DrizzleQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).then === 'function' &&
    typeof (value as any).toSQL === 'function'
  );
}

/**
 * Checks if a database config is a drizzle database instance.
 */
export function isDrizzleDatabase(db: unknown): db is DrizzleDatabaseLike {
  return (
    typeof db === 'object' &&
    db !== null &&
    typeof (db as any).select === 'function' &&
    typeof (db as any).insert === 'function' &&
    typeof (db as any).transaction === 'function'
  );
}

/**
 * Checks if a database config is a FireflyDriver.
 */
export function isFireflyDriver(db: unknown): db is FireflyDriver {
  return (
    typeof db === 'object' &&
    db !== null &&
    typeof (db as any).runAsync === 'function' &&
    typeof (db as any).getAllAsync === 'function'
  );
}

/**
 * Checks if a hydration query is a drizzle hydration query.
 */
export function isDrizzleHydrationQuery(q: unknown): q is DrizzleHydrationQuery {
  return (
    typeof q === 'object' &&
    q !== null &&
    'query' in q &&
    isDrizzleQuery((q as any).query)
  );
}
