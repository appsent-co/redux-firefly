import type { FireflyDriver } from '../driver';
import type { UpdateEffect, OperationResult } from '../types';
import { buildWhereClause } from '../utils/sql';

/**
 * Executes an UPDATE operation
 * @param db - SQLite database instance
 * @param effect - UPDATE effect configuration
 * @returns Operation result with rowsAffected
 *
 * @example
 * await executeUpdate(db, {
 *   type: 'UPDATE',
 *   table: 'todos',
 *   values: { completed: 1 },
 *   where: { id: 5 }
 * })
 */
export async function executeUpdate(
  db: FireflyDriver,
  effect: UpdateEffect
): Promise<OperationResult> {
  const { table, values, where } = effect;

  const setClause = Object.keys(values)
    .map((key) => `${key} = ?`)
    .join(', ');

  const { clause: whereClause, params: whereParams } = buildWhereClause(where);
  const params = [...Object.values(values), ...whereParams];

  const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

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
