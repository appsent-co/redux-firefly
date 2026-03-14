import * as SQLite from 'expo-sqlite';
import { expoSQLiteDriver } from 'redux-firefly';

const expoDb = SQLite.openDatabaseSync('plain_redux.db');

export const driver = expoSQLiteDriver(expoDb);

export function initDatabase() {
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
