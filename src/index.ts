// Main API
export { createFirefly } from './createFirefly';
export { withHydration, isHydratedReducer, applyRows, isApplyRowsReducer } from './withHydration';
export type { HydratedReducer } from './withHydration';
export { fireflyHydration } from './drizzle/hydrate';

// Row-level apply helpers
export { listApply } from './apply-rows';
export type { ListApplyOptions } from './apply-rows';

// Drivers
export { expoSQLiteDriver } from './drivers/expo-sqlite';
export { fireflyClientDriver } from './drivers/firefly-client';
export type { FireflyClientLike } from './drivers/firefly-client';
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

  // FireflyDB change source (live merged-row updates)
  FireflyChangeSource,
  FireflyChangeEvent,

  // Row-level apply
  MergedRow,
  MergedValue,
  ApplyRowsChanges,
  ApplyRowsConfig,

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
