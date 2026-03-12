import type { FireflyDriver } from '../driver';
import type { DeleteEffect, OperationResult } from '../types';
import { buildWhereClause } from '../utils/sql';

/**
 * Executes a DELETE operation
 * @param db - SQLite database instance
 * @param effect - DELETE effect configuration
 * @returns Operation result with rowsAffected
 *
 * @example
 * await executeDelete(db, {
 *   type: 'DELETE',
 *   table: 'todos',
 *   where: { id: 5 }
 * })
 */
export async function executeDelete(
  db: FireflyDriver,
  effect: DeleteEffect
): Promise<OperationResult> {
  const { table, where } = effect;

  const { clause: whereClause, params } = buildWhereClause(where);
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

  try {
    const result = await db.runAsync(sql, params);

    return {
      success: true,
      rowsAffected: result.changes,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
