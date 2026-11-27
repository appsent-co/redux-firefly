export {
  buildCreateFireflySlice,
  createFireflySlice,
  onCommit,
  onRollback,
  onWriteCommit,
  onWriteRollback,
} from './createFireflySlice';
export type {
  // Slice and matchers
  BuildCreateFireflySliceOptions,
  CreateFireflySlice,
  FireflySlice,
  FireflyActions,
  CommitMatcher,
  RollbackMatcher,

  // Reducer definitions (for wrappers of createFireflySlice)
  CreateFireflySliceOptions,
  FireflySliceHydration,
  FireflyReducerFactory,
  FireflyCaseReducer,
  FireflyCaseReducerDef,
  FireflyCaseReducerWithPrepareDef,
  FireflyCommitHandlerAction,
  FireflyRollbackHandlerAction,
  FireflyIdentityPrepareArgs,

  // The compile-time check on a definition's effect, and what its errors name
  FireflyEffectCheck,
  FireflyInvalidEffectSlot,
  FireflyEffectIsAPromise,
} from './createFireflySlice';
export { runWrite } from './runWrite';
export type { WriteCreator, WriteOutcome } from './runWrite';
export type {
  FireflyCommitAction,
  FireflyRollbackAction,
  FireflyCommitted,
  FireflyRolledBack,
  FireflyEffect,
  FireflyEffectRecord,
  FireflyEffectSlot,
  FireflyRecordResults,
  FireflySlotResult,
  InferEffectResult,
} from './types';
export type { OperationResult, HydrationQuery } from '../types';
export type { DrizzleQuery, DrizzleHydrationQuery } from '../drizzle/types';

// Row-level apply (mirrors the main entry for toolkit consumers).
export { applyRows } from '../withHydration';
export { listApply } from '../apply-rows';
export type { ListApplyOptions } from '../apply-rows';
export type {
  MergedRow,
  MergedValue,
  ApplyRowsChanges,
  ApplyRowsConfig,
} from '../types';
