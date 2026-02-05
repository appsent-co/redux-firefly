import type { SQLiteDatabase } from 'expo-sqlite';
import type { InsertEffect, OperationResult } from '../types';

/**
 * Executes an INSERT operation
 * @param db - SQLite database instance
 * @param effect - INSERT effect configuration
 * @returns Operation result with insertId and rowsAffected
 *
 * @example
 * await executeInsert(db, {
 *   type: 'INSERT',
 *   table: 'todos',
 *   values: { text: 'Buy milk', completed: 0 }
 * })
 */
export async function executeInsert(
  db: SQLiteDatabase,
  effect: InsertEffect
): Promise<OperationResult> {
  const { table, values } = effect;

  const columns = Object.keys(values);
  const placeholders = columns.map(() => '?').join(', ');
  const params = Object.values(values);

  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

  try {
    const result = await db.runAsync(sql, params);

    return {
      success: true,
      insertId: result.lastInsertRowId,
      rowsAffected: result.changes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
