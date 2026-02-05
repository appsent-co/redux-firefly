import type { WhereClause } from '../types';

/**
 * Builds a WHERE clause from an object
 * @param where - Object mapping column names to values
 * @returns SQL WHERE clause string and parameter array
 *
 * @example
 * buildWhereClause({ id: 1, active: true })
 * // Returns: { clause: "id = ? AND active = ?", params: [1, true] }
 *
 * buildWhereClause({ name: "John", age: null })
 * // Returns: { clause: "name = ? AND age IS NULL", params: ["John"] }
 */
export function buildWhereClause(where: WhereClause): {
  clause: string;
  params: any[];
} {
  const conditions: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else {
      conditions.push(`${key} = ?`);
      params.push(value);
    }
  }

  return {
    clause: conditions.join(' AND '),
    params,
  };
}
