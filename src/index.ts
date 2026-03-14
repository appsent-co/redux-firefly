// Main API
export { createFirefly } from './createFirefly';
export { withHydration, isHydratedReducer } from './withHydration';
export type { HydratedReducer } from './withHydration';

// Drivers
export { expoSQLiteDriver } from './drivers/expo-sqlite';
export type { FireflyDriver, DriverMutationResult } from './driver';

// Drizzle types (re-exported for convenience)
export type {
  DrizzleQuery,
  DrizzleDatabaseLike,
  DrizzleHydrationQuery,
} from './drizzle/types';

// Type guards and utilities
export { isFireflyAction } from './types';

// TypeScript types
export type {
  // Effects
  FireflyEffect,

  // Action & Metadata
  FireflyAction,
  FireflyCommitAction,
  FireflyRollbackAction,
  FireflyMeta,

  // Configuration
  FireflyConfig,
  HydrationConfig,
  HydrationQuery,

  // Results
  OperationResult,

  // Store
  FireflyStore,

  // React
  FireflyGateProps,
} from './types';

// Error classes
export {
  FireflyError,
  DatabaseOperationError,
  HydrationError,
} from './utils/errors';
