/**
 * Database driver interface for Firefly.
 * Implement this interface to use a custom SQLite client.
 */
export interface FireflyDriver {
  runAsync(
    sql: string,
    params?: any[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  withTransactionAsync(callback: () => Promise<void>): Promise<void>;
}
