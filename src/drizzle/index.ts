// Types
export type {
  DrizzleQuery,
  DrizzleDatabaseLike,
  DrizzleHydrationQuery,
  MapDrizzleResults,
  InferHydrationResult,
} from './types';

// Detection utilities
export {
  isDrizzleQuery,
  isDrizzleDatabase,
  isFireflyDriver,
  isDrizzleHydrationQuery,
} from './detect';
