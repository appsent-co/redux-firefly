import type { SQLiteDatabase } from 'expo-sqlite';
import type { FireflyEffect, OperationResult } from './types';
import {
  executeInsert,
  executeUpdate,
  executeDelete,
  executeSelect,
  executeRaw,
} from './operations';

/**
 * Executes a database operation or transaction
 * @param db - SQLite database instance
 * @param effect - Single effect or array of effects (for transactions)
 * @returns Operation result
 *
 * @example
 * // Single operation
 * await executeOperation(db, {
 *   type: 'INSERT',
 *   table: 'todos',
 *   values: { text: 'Buy milk' }
 * })
 *
 * // Transaction (multiple operations)
 * await executeOperation(db, [
 *   { type: 'INSERT', table: 'todos', values: { text: 'Todo 1' } },
 *   { type: 'INSERT', table: 'todos', values: { text: 'Todo 2' } }
 * ])
 */
export async function executeOperation(
  db: SQLiteDatabase,
  effect: FireflyEffect | FireflyEffect[]
): Promise<OperationResult> {
  try {
    // Transaction support - array of effects
    if (Array.isArray(effect)) {
      return await executeTransaction(db, effect);
    }

    // Single operation - route to appropriate handler
    return await executeSingleOperation(db, effect);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Executes a single database operation
 * @param db - SQLite database instance
 * @param effect - Single effect
 * @returns Operation result
 */
async function executeSingleOperation(
  db: SQLiteDatabase,
  effect: FireflyEffect
): Promise<OperationResult> {
  switch (effect.type) {
    case 'INSERT':
      return await executeInsert(db, effect);
    case 'UPDATE':
      return await executeUpdate(db, effect);
    case 'DELETE':
      return await executeDelete(db, effect);
    case 'SELECT':
      return await executeSelect(db, effect);
    case 'RAW':
      return await executeRaw(db, effect);
    default:
      throw new Error(`Unknown effect type: ${(effect as any).type}`);
  }
}

/**
 * Executes multiple operations in a single transaction
 * All operations must succeed, or all will be rolled back
 * @param db - SQLite database instance
 * @param effects - Array of effects to execute atomically
 * @returns Combined operation result
 */
async function executeTransaction(
  db: SQLiteDatabase,
  effects: FireflyEffect[]
): Promise<OperationResult> {
  try {
    // Store results in outer scope to work with void-returning transaction API
    let transactionResults: OperationResult[] = [];

    // Use withTransactionAsync for atomic execution
    await db.withTransactionAsync(async () => {
      const opResults: OperationResult[] = [];

      for (const effect of effects) {
        const result = await executeSingleOperation(db, effect);

        // If any operation fails, throw to trigger rollback
        if (!result.success) {
          throw result.error || new Error('Operation failed');
        }

        opResults.push(result);
      }

      // Assign to outer scope before callback returns
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
