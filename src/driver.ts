/**
 * Result of a mutation query (INSERT/UPDATE/DELETE) via the driver.
 */
export interface DriverMutationResult {
  lastInsertRowId: number;
  changes: number;
}

/**
 * Database driver interface for Firefly.
 * Implement this interface to use a custom SQLite client.
 */
export interface FireflyDriver {
  runAsync(sql: string, params?: any[]): Promise<DriverMutationResult>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  withTransactionAsync(callback: () => Promise<void>): Promise<void>;
}
