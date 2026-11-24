import { expectTypeOf } from 'expect-type';
import type {
  DriverMutationResult,
  DrizzleQuery,
  FireflyEffect,
  FireflyEffectRecord,
  FireflyMeta,
  FireflyRecordResults,
  FireflySlotResult,
  InferEffectResult,
  OperationResult,
} from '../src';
import { fakeStatement } from './helpers';

// Type-level tests: they pass by compiling (ts-jest and `yarn typecheck` both
// type-check this file, in strict mode — `undefined` must not vanish from the
// unions below).

interface Task {
  id: string;
  title: string;
}
interface RunResult {
  changes: number;
}

/**
 * Infers an effect the way `fireflyReducer` does (`const E`) and gives its
 * commit result — a type only: at runtime it is an empty object, so that
 * reading a slot off it does not throw.
 */
function resultOf<const E>(_effect: E): InferEffectResult<E> {
  return {} as InferEffectResult<E>;
}

const returning = fakeStatement<Task[]>([]);
const run = fakeStatement<RunResult>({ changes: 1 });
const condition = (): boolean => true;

describe('InferEffectResult', () => {
  it('gives a single drizzle query its own result', () => {
    expectTypeOf<InferEffectResult<DrizzleQuery<Task[]>>>().toEqualTypeOf<Task[]>();
    expectTypeOf(resultOf(returning)).toEqualTypeOf<Task[]>();
  });

  it('gives an array of drizzle queries one OperationResult per query', () => {
    expectTypeOf(resultOf([returning, run])).toEqualTypeOf<
      readonly [OperationResult<Task[]>, OperationResult<RunResult>]
    >();
    expectTypeOf<InferEffectResult<DrizzleQuery<RunResult>[]>>().toEqualTypeOf<OperationResult<RunResult>[]>();
  });

  it('gives a raw SQL effect the driver mutation result', () => {
    expectTypeOf<InferEffectResult<FireflyEffect>>().toEqualTypeOf<DriverMutationResult>();
    expectTypeOf(resultOf({ sql: 'DELETE FROM tasks' })).toEqualTypeOf<DriverMutationResult>();
  });

  it('keeps a raw SQL literal with params as any, as in 1.x', () => {
    // `const` inference makes the params a readonly tuple, which FireflyEffect's
    // mutable `params` does not match. 1.x code reads this result as any (rows
    // of a SELECT, say), so it has to stay that way.
    expectTypeOf(resultOf({ sql: 'SELECT * FROM tasks WHERE id = ?', params: ['t1'] })).toBeAny();
  });

  it('gives an array of raw SQL effects OperationResult[]', () => {
    expectTypeOf<InferEffectResult<FireflyEffect[]>>().toEqualTypeOf<OperationResult[]>();
    expectTypeOf(resultOf([{ sql: 'DELETE FROM tasks' }, { sql: 'DELETE FROM events' }])).toEqualTypeOf<OperationResult[]>();
  });

  it('gives a record each slot result under its name', () => {
    const results = resultOf({
      task: returning,
      seed: run,
      assignees: [run, run],
      events: [returning, run],
      mapped: ['a', 'b'].map(() => run),
      none: [],
      deleted: condition() && run,
      renamed: condition() ? returning : undefined,
      archived: condition() ? run : null,
      skipped: undefined,
      skippedNull: null,
      skippedFalse: false,
    });

    // single slot → that statement's result
    expectTypeOf(results.task).toEqualTypeOf<Task[]>();
    expectTypeOf(results.seed).toEqualTypeOf<RunResult>();
    // list slot → an array of results
    expectTypeOf(results.assignees).toEqualTypeOf<RunResult[]>();
    expectTypeOf(results.events).toEqualTypeOf<(Task[] | RunResult)[]>();
    expectTypeOf(results.mapped).toEqualTypeOf<RunResult[]>();
    expectTypeOf(results.none).toEqualTypeOf<never[]>();
    // conditional slot → the result, or undefined when it was skipped
    expectTypeOf(results.deleted).toEqualTypeOf<RunResult | undefined>();
    expectTypeOf(results.renamed).toEqualTypeOf<Task[] | undefined>();
    expectTypeOf(results.archived).toEqualTypeOf<RunResult | undefined>();
    // skipped slot → undefined
    expectTypeOf(results.skipped).toEqualTypeOf<undefined>();
    expectTypeOf(results.skippedNull).toEqualTypeOf<undefined>();
    expectTypeOf(results.skippedFalse).toEqualTypeOf<undefined>();

    expectTypeOf(results).toEqualTypeOf<{
      task: Task[];
      seed: RunResult;
      assignees: RunResult[];
      events: (Task[] | RunResult)[];
      mapped: RunResult[];
      none: never[];
      deleted: RunResult | undefined;
      renamed: Task[] | undefined;
      archived: RunResult | undefined;
      skipped: undefined;
      skippedNull: undefined;
      skippedFalse: undefined;
    }>();
  });

  it('reads a slot guarded by a number, a string or a bigint as skipped when the guard is falsy', () => {
    const ids: string[] = [];
    const name: string = 'Ada';
    const count: bigint = 0n;

    const results = resultOf({
      task: returning,
      // `count && query` leaves `0` behind, not `false`; a string leaves `''`, a bigint `0n`.
      removed: ids.length && run,
      renamed: name && returning,
      counted: count && run,
    });

    expectTypeOf(results).not.toBeAny();
    expectTypeOf(results).toEqualTypeOf<{
      task: Task[];
      removed: RunResult | undefined;
      renamed: Task[] | undefined;
      counted: RunResult | undefined;
    }>();
  });

  it('reads a record typed by an interface like one typed by a type alias', () => {
    interface SaveEffects {
      task: DrizzleQuery<Task[]>;
      seed: DrizzleQuery<RunResult> | undefined;
      links?: DrizzleQuery<RunResult>[];
    }
    type SaveEffectsAlias = {
      task: DrizzleQuery<Task[]>;
      seed: DrizzleQuery<RunResult> | undefined;
      links?: DrizzleQuery<RunResult>[];
    };
    type Expected = { task: Task[]; seed: RunResult | undefined; links?: RunResult[] | undefined };

    expectTypeOf<InferEffectResult<SaveEffects>>().not.toBeAny();
    expectTypeOf<InferEffectResult<SaveEffects>>().toEqualTypeOf<Expected>();
    expectTypeOf<InferEffectResult<SaveEffectsAlias>>().toEqualTypeOf<Expected>();
  });

  it('gives a raw SQL slot what a single raw effect gets', () => {
    const results = resultOf({
      created: { sql: 'INSERT INTO tasks DEFAULT VALUES' },
      touched: [{ sql: 'UPDATE lists SET n = n + 1' }],
    });

    expectTypeOf(results).toEqualTypeOf<{
      created: DriverMutationResult;
      touched: DriverMutationResult[];
    }>();
  });

  it('does not read a query, an array or a raw effect as a record', () => {
    // Each is an object too; the record branch must come after them.
    expectTypeOf(resultOf(run)).not.toEqualTypeOf<FireflyRecordResults<typeof run>>();
    expectTypeOf(resultOf(run)).toEqualTypeOf<RunResult>();
    expectTypeOf(resultOf({ sql: 'DELETE FROM tasks' })).toEqualTypeOf<DriverMutationResult>();
    expectTypeOf(resultOf([run])).toEqualTypeOf<readonly [OperationResult<RunResult>]>();
  });

  it('gives an effect that may be absent the result of when it is not', () => {
    // An absent effect never commits, so it adds nothing to the result.
    expectTypeOf(resultOf(condition() ? { task: returning } : undefined)).toEqualTypeOf<{ task: Task[] }>();
    expectTypeOf(resultOf(condition() ? returning : null)).toEqualTypeOf<Task[]>();
    expectTypeOf<InferEffectResult<undefined>>().toEqualTypeOf<never>();
    expectTypeOf<InferEffectResult<null>>().toEqualTypeOf<never>();
  });

  it('stays any for an effect of unknown shape', () => {
    expectTypeOf<InferEffectResult<any>>().toBeAny();
    expectTypeOf<InferEffectResult<unknown>>().toBeAny();
  });

  it('does not read an array with skipped entries, or an object that is no record, as a record', () => {
    // An array is positional: its entries are not slots.
    expectTypeOf(resultOf([condition() && run, returning])).toBeAny();
    // Not records: a property that is no slot, a slot named `sql`.
    expectTypeOf<InferEffectResult<Promise<RunResult>>>().toBeAny();
    expectTypeOf<InferEffectResult<Date>>().toBeAny();
    expectTypeOf<InferEffectResult<{ sql: DrizzleQuery<RunResult>; task: DrizzleQuery<Task[]> }>>().toBeAny();
  });
});

describe('FireflySlotResult', () => {
  it('maps each slot shape', () => {
    expectTypeOf<FireflySlotResult<DrizzleQuery<Task[]>>>().toEqualTypeOf<Task[]>();
    expectTypeOf<FireflySlotResult<FireflyEffect>>().toEqualTypeOf<DriverMutationResult>();
    expectTypeOf<FireflySlotResult<DrizzleQuery<RunResult>[]>>().toEqualTypeOf<RunResult[]>();
    expectTypeOf<FireflySlotResult<readonly DrizzleQuery<RunResult>[]>>().toEqualTypeOf<RunResult[]>();
    expectTypeOf<FireflySlotResult<readonly []>>().toEqualTypeOf<never[]>();
    expectTypeOf<FireflySlotResult<undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<null>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<false>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<false | DrizzleQuery<RunResult>>>().toEqualTypeOf<RunResult | undefined>();
    expectTypeOf<FireflySlotResult<0>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<''>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<0n>>().toEqualTypeOf<undefined>();
    expectTypeOf<FireflySlotResult<0 | DrizzleQuery<RunResult>>>().toEqualTypeOf<RunResult | undefined>();
    expectTypeOf<FireflySlotResult<'' | DrizzleQuery<Task[]>[]>>().toEqualTypeOf<Task[][] | undefined>();
  });
});

describe('FireflyMeta.effect', () => {
  it('accepts every effect form', () => {
    expectTypeOf(returning).toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf([returning, run]).toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf<FireflyEffect>().toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf<FireflyEffect[]>().toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf<undefined>().toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf<null>().toMatchTypeOf<FireflyMeta['effect']>();

    const record = {
      task: returning,
      assignees: [run, run],
      deleted: condition() && run,
      skipped: undefined,
    };
    expectTypeOf(record).toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf(record).toMatchTypeOf<FireflyMeta['effect']>();

    // Slots a guard left falsy: `0`, `''` and `0n` are skipped like `false`.
    const ids: string[] = [];
    const guarded = { task: returning, removed: ids.length && run, renamed: '' as const, counted: 0n as const };
    expectTypeOf(guarded).toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf(guarded).toMatchTypeOf<FireflyMeta['effect']>();
  });

  it('rejects a slot that is not a statement', () => {
    expectTypeOf({ task: 'DELETE FROM tasks' }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ task: 0 }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ tasks: [undefined] }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ tasks: [condition() && run, run] }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ task: Promise.resolve(run) }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ task: 1 as const }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ task: true as const }).not.toMatchTypeOf<FireflyEffectRecord>();
  });

  it('rejects a slot named sql: an object with a sql key is a SQL effect', () => {
    expectTypeOf({ sql: run, task: returning }).not.toMatchTypeOf<FireflyEffectRecord>();
    expectTypeOf({ sql: run, task: returning }).not.toMatchTypeOf<FireflyMeta['effect']>();
    expectTypeOf({ sql: 'DELETE FROM tasks' }).toMatchTypeOf<FireflyMeta['effect']>();
  });
});
