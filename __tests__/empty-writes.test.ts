import { executeOperation } from '../src/executor';
import { isEmptyEffect, isFireflyAction } from '../src';
import type { FireflyMeta } from '../src';
import {
  createTestStore,
  fakeDriver,
  fakeDrizzleDatabase,
  fakeStatement,
  fireflyAction,
  flush,
} from './helpers';

type Effect = FireflyMeta['effect'];

const EMPTY_EFFECTS: Array<[name: string, effect: Effect]> = [
  ['an empty array', []],
  ['an empty record', {}],
  ['a record whose slots are all skipped', { a: undefined, b: null, c: false }],
  ['a record whose slots a guard left falsy', { a: 0, b: '', c: 0n }],
  ['a record with only an empty list', { list: [] }],
  ['a record of empty lists and skipped slots', { list: [], other: [], skipped: undefined }],
  ['undefined', undefined],
  ['null', null],
];

/** A database able to run anything, so any call at all shows up. */
function anyDatabase() {
  const database = { ...fakeDrizzleDatabase(), ...fakeDriver() };
  const expectUntouched = () => {
    for (const method of Object.values(database)) {
      expect(method).not.toHaveBeenCalled();
    }
  };
  return { database, expectUntouched };
}

/** Counts the `tasks/touch` actions that reached the reducer. */
const touched = (state = 0, action: { type: string }) =>
  action.type === 'tasks/touch' ? state + 1 : state;

describe('empty write', () => {
  describe.each(EMPTY_EFFECTS)('with %s as its effect', (_name, effect) => {
    it('reaches the reducer and does nothing else', async () => {
      const { database, expectUntouched } = anyDatabase();
      const { store, types, onError } = await createTestStore<{ touched: number }>({
        database,
        reducers: { touched },
      });

      store.dispatch(fireflyAction('tasks/touch', { id: 't1' }, effect));
      await flush();

      // The original action went through to the reducer...
      expect(store.getState().touched).toBe(1);
      // ...and nothing followed it: no commit, no rollback, no error, no database call.
      expect(types()).toEqual(['tasks/touch']);
      expect(onError).not.toHaveBeenCalled();
      expectUntouched();
    });

    it('is a successful no-op for executeOperation', async () => {
      const { database, expectUntouched } = anyDatabase();

      expect(await executeOperation(database, effect)).toEqual({ success: true });
      expectUntouched();
    });

    it('is empty for isEmptyEffect', () => {
      expect(isEmptyEffect(effect)).toBe(true);
    });
  });

  it('does not hold up the write that follows it', async () => {
    const database = fakeDrizzleDatabase();
    const { store, types } = await createTestStore({ database });

    store.dispatch(fireflyAction('tasks/touch', null, {}));
    store.dispatch(fireflyAction('tasks/add', null, { task: fakeStatement([{ id: 't1' }]) }));
    await flush();

    expect(types()).toEqual(['tasks/touch', 'tasks/add', 'tasks/add/commit']);
  });
});

describe('isEmptyEffect', () => {
  const statement = fakeStatement(1);

  it.each<[name: string, effect: Effect]>([
    ['a drizzle query', statement],
    ['a raw SQL effect', { sql: 'DELETE FROM todos' }],
    ['a one-statement array', [statement]],
    ['a record with a single slot', { a: statement }],
    ['a record with a raw effect slot', { a: { sql: 'DELETE FROM todos' } }],
    ['a record with a non-empty list', { skipped: null, list: [statement] }],
  ])('is false for %s', (_name, effect) => {
    expect(isEmptyEffect(effect)).toBe(false);
  });

  it('does not filter an array: its results are positional', () => {
    expect(isEmptyEffect([undefined])).toBe(false);
  });
});

describe('an effect that is not one', () => {
  class Query {
    run = 0;
  }

  // Objects that are no query, SQL effect, array or record. None of them has
  // an enumerable slot, and none of them is an empty write: 1.x failed them,
  // and so does 2.0.
  const NOT_EFFECTS: Array<[name: string, effect: unknown, message: RegExp]> = [
    ['a Promise', Promise.resolve({ changes: 1 }), /is a Promise, not a drizzle query/],
    ['a Date', new Date(0), /is not a drizzle query, a SQL effect/],
    ['a Map', new Map(), /is not a drizzle query, a SQL effect/],
    ['a class instance without a slot to run', new Query(), /is not a drizzle query, a SQL effect/],
    ['a SQL effect whose sql is undefined', { sql: undefined, params: [] }, /needs a `sql` string/],
    ['a SQL effect whose sql is undefined, without params', { sql: undefined }, /needs a `sql` string/],
    ['a SQL effect whose sql is null', { sql: null }, /needs a `sql` string/],
  ];

  describe.each(NOT_EFFECTS)('%s', (_name, value, message) => {
    const effect = value as Effect;

    it('is not empty for isEmptyEffect', () => {
      expect(isEmptyEffect(effect)).toBe(false);
    });

    it('rolls back and reaches onError, without touching the database', async () => {
      const { database, expectUntouched } = anyDatabase();
      const { store, types, find, onError } = await createTestStore({ database });

      const action = fireflyAction('tasks/touch', { id: 't1' }, effect);
      store.dispatch(action);
      await flush();

      expect(types()).toEqual(['tasks/touch', 'tasks/touch/rollback']);
      const { error } = find('tasks/touch/rollback').meta.firefly;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(message);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error, action);
      expectUntouched();
    });

    it('fails executeOperation', async () => {
      const { database, expectUntouched } = anyDatabase();

      const result = await executeOperation(database, effect);

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(message);
      expectUntouched();
    });
  });

  it('reads an object with a sql key as a SQL effect, never as a record with a slot named sql', async () => {
    const { database, expectUntouched } = anyDatabase();
    const query = fakeStatement({ changes: 1 });
    const record = { sql: query, other: fakeStatement({ changes: 2 }) } as unknown as Effect;

    expect(isEmptyEffect(record)).toBe(false);
    const result = await executeOperation(database, record);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/cannot name a slot "sql"/);
    expect(query.awaited).toBe(0);
    expectUntouched();
  });
});

describe('isFireflyAction', () => {
  const withEffect = (effect: unknown) => ({ type: 'tasks/touch', meta: { firefly: { effect } } });

  it('is false for a null or undefined effect', () => {
    expect(isFireflyAction(withEffect(null))).toBe(false);
    expect(isFireflyAction(withEffect(undefined))).toBe(false);
  });

  it('is still true for [] and {}, which the middleware then skips', () => {
    expect(isFireflyAction(withEffect([]))).toBe(true);
    expect(isFireflyAction(withEffect({}))).toBe(true);
  });

  it('is true for every effect that has work', () => {
    const statement = fakeStatement(1);
    expect(isFireflyAction(withEffect(statement))).toBe(true);
    expect(isFireflyAction(withEffect([statement]))).toBe(true);
    expect(isFireflyAction(withEffect({ sql: 'DELETE FROM todos' }))).toBe(true);
    expect(isFireflyAction(withEffect({ task: statement }))).toBe(true);
  });
});
