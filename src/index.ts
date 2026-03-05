// Main API
export { createFirefly } from './createFirefly';
export { withHydration } from './withHydration';
export type { HydratedReducer } from './withHydration';

// Type guards and utilities
export { isFireflyAction } from './types';

// TypeScript types
export type {
  // Effects
  FireflyEffect,
  InsertEffect,
  UpdateEffect,
  DeleteEffect,
  SelectEffect,
  RawEffect,
  EffectType,
  BaseEffect,

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

  // Utilities
  WhereClause,
} from './types';

// Error classes
export {
  FireflyError,
  DatabaseOperationError,
  HydrationError,
} from './utils/errors';
