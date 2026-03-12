import type { FireflyDriver } from '../driver';

/**
 * Structural interface for expo-sqlite database instances.
 * Compatible with both expo-sqlite v14 and v15.
 */
interface SQLiteLike {
  runAsync(sql: string, params?: any): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync(sql: string, params?: any): Promise<any[]>;
  withTransactionAsync(callback: () => Promise<void>): Promise<void>;
}

/**
 * Creates a Firefly driver from an expo-sqlite database instance.
 *
 * @example
 * import * as SQLite from 'expo-sqlite';
 * import { expoSQLiteDriver } from 'redux-firefly';
 *
 * const db = SQLite.openDatabaseSync('myapp.db');
 * const driver = expoSQLiteDriver(db);
 */
export function expoSQLiteDriver(db: SQLiteLike): FireflyDriver {
  return {
    runAsync: (sql, params) => db.runAsync(sql, params ?? []),
    getAllAsync: (sql, params) => db.getAllAsync(sql, params ?? []),
    withTransactionAsync: (callback) => db.withTransactionAsync(callback),
  };
}
