import type { Action } from 'redux';
import type { ReactReduxContextValue } from 'react-redux';
import type { FireflyDriver } from './driver';
import type { DrizzleQuery, DrizzleDatabaseLike, DrizzleHydrationQuery, MapDrizzleResults } from './drizzle/types';
import type { DriverMutationResult } from './driver';

/**
 * A plain SQL effect.
 */
export interface FireflyEffect {
  sql: string;
  params?: any[];
}

/**
 * Firefly metadata attached to Redux actions
 */
export interface FireflyMeta {
  /** Database operation(s) to execute - single effect, array for transactions, or drizzle query */
  effect: FireflyEffect | FireflyEffect[] | DrizzleQuery | DrizzleQuery[];
  /** Optional action to dispatch on successful operation */
  commit?: Action & Record<string, unknown>;
  /** Optional action to dispatch on failed operation */
  rollback?: Action & Record<string, unknown>;
  /** Original action payload, forwarded to commit/rollback actions */
  originalPayload?: unknown;
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
export interface FireflyCommitAction<P = any, R = any> extends Action {
  payload: P;
  meta: {
    firefly: {
      result: R;
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
  /** Database driver instance or drizzle database */
  database: FireflyDriver | DrizzleDatabaseLike;
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
 * Maps slice names to their query configurations (SQL or drizzle)
 */
export type HydrationConfig = {
  [sliceName: string]: HydrationQuery | DrizzleHydrationQuery<any, any>;
};

/**
 * Infers the commit result type from the effect type.
 *
 * - DrizzleQuery<R> → R (e.g. SQLiteRunResult for inserts, Row[] for selects)
 * - DrizzleQuery[] → MapDrizzleResults (tuple of OperationResult per query)
 * - FireflyEffect (RAW) → DriverMutationResult
 * - FireflyEffect[] → OperationResult[]
 */
export type InferEffectResult<E> =
  E extends DrizzleQuery<infer R> ? R :
  E extends readonly DrizzleQuery[] ? MapDrizzleResults<E> :
  E extends FireflyEffect ? DriverMutationResult :
  E extends readonly FireflyEffect[] ? OperationResult[] :
  any;

/**
 * Result of a database operation
 */
export interface OperationResult<T = any> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Operation result — query rows, mutation metadata, or drizzle result */
  rows?: T;
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
