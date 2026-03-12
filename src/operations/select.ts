import type { FireflyDriver } from '../driver';
import type { SelectEffect, OperationResult } from '../types';
import { buildWhereClause } from '../utils/sql';

/**
 * Executes a SELECT operation
 * @param db - SQLite database instance
 * @param effect - SELECT effect configuration
 * @returns Operation result with rows
 *
 * @example
 * await executeSelect(db, {
 *   type: 'SELECT',
 *   table: 'todos',
 *   columns: ['id', 'text'],
 *   where: { completed: 0 },
 *   orderBy: 'created_at DESC',
 *   limit: 10
 * })
 */
export async function executeSelect(
  db: FireflyDriver,
  effect: SelectEffect
): Promise<OperationResult> {
  const { table, columns = ['*'], where, orderBy, limit } = effect;

  let sql = `SELECT ${columns.join(', ')} FROM ${table}`;
  let params: any[] = [];

  if (where) {
    const { clause: whereClause, params: whereParams } = buildWhereClause(where);
    sql += ` WHERE ${whereClause}`;
    params = whereParams;
  }

  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }

  if (limit !== undefined) {
    sql += ` LIMIT ${limit}`;
  }

  try {
    const rows = await db.getAllAsync(sql, params);

    return {
      success: true,
      rows,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
