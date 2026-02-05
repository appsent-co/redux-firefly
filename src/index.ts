// Main middleware and hydration
export { createFireflyMiddleware } from './middleware';
export { hydrateFromDatabase } from './hydration';

// React integration
export { fireflyReducer } from './react/fireflyReducer';

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
  FireflyMeta,

  // Configuration
  FireflyConfig,
  HydrationConfig,
  HydrationQuery,

  // Results
  OperationResult,

  // State
  FireflyState,

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
