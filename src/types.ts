import type { SQLiteDatabase } from 'expo-sqlite';
import type { Action } from 'redux';
import type { ReactReduxContextValue } from 'react-redux';

/**
 * Supported database operation types
 */
export type EffectType = 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT' | 'RAW';

/**
 * Where clause for SQL operations
 * Maps column names to their values
 */
export type WhereClause = {
  [key: string]: string | number | boolean | null;
};

/**
 * Base effect interface
 */
export interface BaseEffect {
  type: EffectType;
}

/**
 * INSERT effect - adds new rows to a table
 */
export interface InsertEffect extends BaseEffect {
  type: 'INSERT';
  table: string;
  values: Record<string, any>;
}

/**
 * UPDATE effect - modifies existing rows
 */
export interface UpdateEffect extends BaseEffect {
  type: 'UPDATE';
  table: string;
  values: Record<string, any>;
  where: WhereClause;
}

/**
 * DELETE effect - removes rows from a table
 */
export interface DeleteEffect extends BaseEffect {
  type: 'DELETE';
  table: string;
  where: WhereClause;
}

/**
 * SELECT effect - queries rows from a table
 */
export interface SelectEffect extends BaseEffect {
  type: 'SELECT';
  table: string;
  columns?: string[];
  where?: WhereClause;
  orderBy?: string;
  limit?: number;
}

/**
 * RAW effect - executes custom SQL
 */
export interface RawEffect extends BaseEffect {
  type: 'RAW';
  sql: string;
  params?: any[];
}

/**
 * Union of all effect types
 */
export type FireflyEffect =
  | InsertEffect
  | UpdateEffect
  | DeleteEffect
  | SelectEffect
  | RawEffect;

/**
 * Firefly metadata attached to Redux actions
 */
export interface FireflyMeta {
  /** Database operation(s) to execute - single or array for transactions */
  effect: FireflyEffect | FireflyEffect[];
  /** Optional action to dispatch on successful operation */
  commit?: Action & Record<string, unknown>;
  /** Optional action to dispatch on failed operation */
  rollback?: Action & Record<string, unknown>;
}

/**
 * Redux action with Firefly metadata
 */
export interface FireflyAction extends Action {
  meta: {
    firefly: FireflyMeta;
    [key: string]: any;
  };
}

/**
 * Action dispatched by the Firefly middleware on successful database operation
 */
export interface FireflyCommitAction<P = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      result: OperationResult;
      /** Results from transaction (array of OperationResult) */
      results?: OperationResult[];
    };
  };
}

/**
 * Action dispatched by the Firefly middleware on failed database operation
 */
export interface FireflyRollbackAction<P = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      error: Error;
    };
  };
}

/**
 * Type guard to check if an action is a Firefly action
 */
export function isFireflyAction(action: unknown): action is FireflyAction {
  if (typeof action !== 'object' || action === null) {
    return false;
  }

  if (!('meta' in action) || typeof action.meta !== 'object' || action.meta === null) {
    return false;
  }

  const meta = action.meta as Record<string, unknown>;
  if (!('firefly' in meta) || typeof meta.firefly !== 'object' || meta.firefly === null) {
    return false;
  }

  const firefly = meta.firefly as Record<string, unknown>;
  return 'effect' in firefly && typeof firefly.effect === 'object';
}

/**
 * Configuration for the Firefly middleware
 */
export interface FireflyConfig {
  /** SQLite database instance */
  database: SQLiteDatabase;
  /** Optional error handler called when operations fail */
  onError?: (error: Error, action: FireflyAction) => void;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Single hydration query configuration
 */
export interface HydrationQuery {
  /** SQL SELECT query to fetch initial data */
  query: string;
  /** Optional parameters for the query */
  params?: (string | number | null | boolean | Uint8Array)[];
  /** Optional transform function to shape the query results */
  transform?: (rows: any[]) => any;
}

/**
 * Hydration configuration for multiple slices
 * Maps slice names to their query configurations
 */
export type HydrationConfig = {
  [sliceName: string]: HydrationQuery;
};

/**
 * Result of a database operation
 */
export interface OperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Last inserted row ID (for INSERT operations) */
  insertId?: number;
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  rowsAffected?: number;
  /** Query results (for SELECT operations) */
  rows?: any[];
  /** Error if operation failed */
  error?: Error;
  /** Results from transaction (array of OperationResult) */
  results?: OperationResult[];
}

/**
 * Props for the FireflyGate React component
 */
export interface FireflyGateProps {
  /** Optional component to show while hydrating */
  loading?: React.ReactNode;
  /** App content to render after hydration */
  children: React.ReactNode;
  /** Optional callback invoked before hydration */
  onBeforeHydrate?: () => void;
  /** Optional custom react-redux context for multi-store setups */
  context?: React.Context<ReactReduxContextValue<unknown, never> | null>;
}

/**
 * Extended store interface with hydration status
 */
export interface FireflyStore {
  /** Promise that resolves when hydration completes */
  hydrated: Promise<void>;
  /** Synchronous check for hydration status */
  isHydrated: () => boolean;
  /** Subscribe to hydration status changes */
  onHydrationChange: (callback: (hydrated: boolean) => void) => () => void;
}
