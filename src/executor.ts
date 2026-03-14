import type { FireflyDriver } from './driver';
import type { FireflyEffect, FireflyMeta, OperationResult } from './types';
import type { DrizzleQuery, DrizzleDatabaseLike } from './drizzle/types';
import { isDrizzleQuery } from './drizzle/detect';

/**
 * Executes a database operation or transaction.
 * Supports both raw SQL effects and drizzle query objects.
 */
export async function executeOperation(
  db: FireflyDriver | DrizzleDatabaseLike,
  effect: FireflyMeta['effect']
): Promise<OperationResult> {
  try {
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
      return await executeDrizzleQuery(effect);
    }

    // Single raw SQL effect
    return await executeRawEffect(db as FireflyDriver, effect);
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
 * Executes a single drizzle query by awaiting it directly.
 * Drizzle queries are self-contained — they carry their own db reference.
 */
async function executeDrizzleQuery(query: DrizzleQuery): Promise<OperationResult> {
  const result = await query;
  return {
    success: true,
    rows: result,
  };
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

    await db.transaction(async () => {
      for (const query of queries) {
        const result = await query;
        results.push({
          success: true,
          rows: result,
        });
      }
    });

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
