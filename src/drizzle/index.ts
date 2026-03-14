// Types
export type {
  DrizzleQuery,
  DrizzleDatabaseLike,
  DrizzleHydrationQuery,
  InferDrizzleResult,
} from './types';

// Detection utilities
export {
  isDrizzleQuery,
  isDrizzleDatabase,
  isFireflyDriver,
  isDrizzleHydrationQuery,
} from './detect';
