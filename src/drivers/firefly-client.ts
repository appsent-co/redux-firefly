import type { FireflyDriver, DriverMutationResult } from '../driver';

/**
 * The slice of a FireflyDB `FireflyClient` this driver needs. Structurally typed
 * so redux-firefly never imports `@fireflydb/core`.
 */
export interface FireflyClientLike {
  exec(sql: string, params?: readonly unknown[]): Promise<void>;
  query<T = any>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

/**
 * Adapt a FireflyDB `FireflyClient` to a {@link FireflyDriver} so **raw-SQL**
 * effects and hydration run on the CRDT-tracked connection (and therefore sync).
 *
 * Caveat: drizzle-query effects are awaited directly and carry their own db
 * handle, so they bypass this driver. To run drizzle effects on the CRDT
 * connection, build the drizzle instance over the client via
 * `drizzle-orm/sqlite-proxy` (forwarding to `client.exec`/`client.query`) and
 * pass that drizzle db as `database` instead — see "Drizzle + FireflyDB" in the
 * README. This driver is for the raw-SQL path.
 *
 * `runAsync` returns `{ lastInsertRowId: 0, changes: 0 }` — FireflyDB rows use
 * app-generated ids (UUIDs / `firefly_uuid()`), so SQLite's last-insert-rowid is
 * not meaningful; commit handlers should not rely on it.
 *
 * Single connection: `withTransactionAsync` issues `BEGIN`/`COMMIT`/`ROLLBACK`,
 * which SQLite rejects if a transaction is already open. Keep `serializeEffects`
 * on (the default) so effects are serialized on the one connection and
 * transactions can't overlap.
 */
export function fireflyClientDriver(client: FireflyClientLike): FireflyDriver {
  return {
    async runAsync(sql: string, params: any[] = []): Promise<DriverMutationResult> {
      await client.exec(sql, params);
      return { lastInsertRowId: 0, changes: 0 };
    },
    async getAllAsync(sql: string, params: any[] = []): Promise<any[]> {
      return client.query(sql, params);
    },
    async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
      await client.exec('BEGIN');
      try {
        await callback();
        await client.exec('COMMIT');
      } catch (err) {
        try {
          await client.exec('ROLLBACK');
        } catch {
          // best-effort rollback; surface the original error
        }
        throw err;
      }
    },
  };
}
