import type { SQLiteDatabase } from 'expo-sqlite';
import type { RawEffect, OperationResult } from '../types';

/**
 * Executes a RAW SQL operation
 * @param db - SQLite database instance
 * @param effect - RAW effect configuration
 * @returns Operation result with either rows (for SELECT) or insertId/rowsAffected (for mutations)
 *
 * @example
 * // SELECT query
 * await executeRaw(db, {
 *   type: 'RAW',
 *   sql: 'SELECT * FROM todos WHERE created_at > ?',
 *   params: [Date.now() - 86400000]
 * })
 *
 * // Mutation query
 * await executeRaw(db, {
 *   type: 'RAW',
 *   sql: 'UPDATE todos SET archived = 1 WHERE completed = 1'
 * })
 */
export async function executeRaw(
  db: SQLiteDatabase,
  effect: RawEffect
): Promise<OperationResult> {
  const { sql, params = [] } = effect;

  try {
    // Determine if it's a query or mutation based on SQL command
    const trimmedSql = sql.trim().toUpperCase();
    const isQuery = trimmedSql.startsWith('SELECT');

    if (isQuery) {
      // SELECT query - return rows
      const rows = await db.getAllAsync(sql, params);
      return {
        success: true,
        rows,
      };
    } else {
      // Mutation (INSERT/UPDATE/DELETE/etc) - return affected rows
      const result = await db.runAsync(sql, params);
      return {
        success: true,
        insertId: result.lastInsertRowId,
        rowsAffected: result.changes,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
