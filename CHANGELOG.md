# Changelog

All notable changes to redux-firefly are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-11-27

### Added

- **`buildCreateFireflySlice({ meta })`** (`redux-firefly/toolkit`): creates a custom `createFireflySlice` whose `fireflyReducer` accepts extra app-specific fields and merges derived metadata onto dispatched actions, preserving all hydration and effect overloads without manual wrapper boilerplate.
- **`runWrite(creator, ...args)` and `WriteOutcome<R>`** (`redux-firefly/toolkit`, `WriteOutcome` also on `redux-firefly`): thunk that dispatches a firefly write and resolves once its database effect commits or rolls back (directly via the Firefly middleware, without needing `listenerMiddleware`). Empty writes resolve immediately as `{ committed: true, results: {} }`.
- **`onWriteCommit` and `onWriteRollback`** (`redux-firefly/toolkit`): listener-middleware twins of `onCommit` and `onRollback` that unpack `{ payload, results }` / `{ payload, error }` with typed `ListenerEffectAPI`.

## [2.0.0] - 2026-11-24

2.0 is about multi-statement writes and reacting to them. An effect can name its
statements and read their results by name, every `createFireflySlice` write
announces its commit or rollback, and action creators carry matchers for those
actions, so nobody spells out a `'slice/reducer/commit'` string.

Four behaviours change, and one action-creator signature is corrected at the
type level. Each is listed under [Changed](#changed) and has an entry in
[Migrating from 1.x](#migrating-from-1x).

### Added

- **Record effects.** An effect can be a record of named slots:

  ```typescript
  effect: (p) => ({
    profile: db.update(profiles).set(p.profile).where(eq(profiles.id, p.id)).returning(),
    slots: p.slots.map((slot) => db.insert(slots).values(slot)),
    deleted: p.removeOld && db.delete(slots).where(eq(slots.profileId, p.id)),
  })
  ```

  - A slot is one statement, a list of statements, or `undefined` / `null` /
    `false` (skipped). Any other falsy value skips the slot too, so
    `ids.length && query` and `name && query` work as guards and are typed
    `Result | undefined`.
  - All statements run in **one** transaction, in record order: slot order, then
    the order inside a list slot.
  - The commit carries the results under the same names: a single slot gives
    that statement's result, a list slot gives an array (also when the list is
    empty), a skipped slot gives `undefined`.
  - The result types are inferred per slot, for a record typed by an
    interface as well.
  - In `fireflyReducer`, a slot that is not a statement, a list of statements
    or a falsy value is a compile error that names the slot
    (`FireflyInvalidEffectSlot<"deleted">`): a Promise, a query builder that
    was not called, a list with a skipped entry.
  - A slot cannot be named `sql`: an object with a `sql` key is always read as
    a SQL effect.
  - A record holds drizzle queries or raw SQL effects, not both. A mixed record
    fails before anything runs.
  - Works in `createFireflySlice` and in a hand-written `meta.firefly.effect`.
- **Commit and rollback matchers on action creators** (`redux-firefly/toolkit`).
  For every firefly reducer, `slice.actions[key].commit` and `.rollback` are
  `{ type, match(action), unpack(action) }`. `unpack` returns
  `{ payload, results }` for a commit and `{ payload, error }` for a rollback,
  with `error` always an `Error`. `match` is a type guard that works wherever
  Redux Toolkit takes a matcher: `startListening({ matcher })`,
  `builder.addMatcher` and `isAnyOf`.
- **`onCommit(builder, creator, handler)` and `onRollback(builder, creator, handler)`**
  (`redux-firefly/toolkit`), for reacting to another slice's write inside
  `extraReducers`. The handler receives `(state, { payload, results })` or
  `(state, { payload, error })`.
- **Commit-only writes.** A firefly reducer's `reducer` is optional. Without it
  there is no optimistic update: state changes only in `commit`, once the write
  has landed.
- **`results` and `error` on handler arguments.** A reducer's `commit` handler
  receives the commit action plus `results`, and its `rollback` handler the
  rollback action plus `error`. `commit: (state, { payload, results }) => ...`
  and the 1.x `commit: (state, action) => action.meta.firefly.result` both
  work.
- **`transactionalSingleStatements`** option on `createReduxFirefly` (default
  `true`). Set it to `false` to await a bare single drizzle query directly, as
  1.x did.
- **`isEmptyEffect(effect)`**, exported from `redux-firefly`: whether an effect
  has nothing to run.
- **Wrappable `createFireflySlice`** (`redux-firefly/toolkit`). An app can wrap
  the `fireflyReducer` helper its `reducers` callback receives, to accept extra
  fields on every reducer and add to what `prepare` returns, and forward
  `hydration` and `applyRows` unchanged. The action creators, their matchers
  and the per-slot results keep their types through the wrapper, with no cast.
  See "Wrapping `createFireflySlice`" in the README.
- **Types.**
  - From `redux-firefly` and `redux-firefly/toolkit`: `FireflyEffectRecord`,
    `FireflyEffectSlot`, `FireflyRecordResults`, `FireflySlotResult`,
    `FireflyCommitted`, `FireflyRolledBack`, and `InferEffectResult`, which now
    has a record branch and was not exported before.
  - From `redux-firefly/toolkit`, the slice and its matchers: `FireflySlice`,
    `FireflyActions`, `CommitMatcher`, `RollbackMatcher`.
  - From `redux-firefly/toolkit`, for wrappers and for naming a definition:
    `CreateFireflySliceOptions`, `FireflySliceHydration`,
    `FireflyReducerFactory`, `FireflyCaseReducer`, `FireflyCaseReducerDef`,
    `FireflyCommitHandlerAction`, `FireflyRollbackHandlerAction`,
    `FireflyIdentityPrepareArgs`, and re-exports of `FireflyEffect`,
    `DrizzleQuery` and `DrizzleHydrationQuery`.
  - From `redux-firefly/toolkit`, the compile-time check on a definition's
    effect and the types its errors name: `FireflyEffectCheck`,
    `FireflyInvalidEffectSlot`, `FireflyEffectIsAPromise`.
  - `FireflySliceHydration<State>` is for a wrapper's implementation signature:
    its Drizzle `transform` takes `unknown` rows, so a `hydration` written in
    place with an annotated `transform` is still checked against its query.
- **`prepare`'s `meta` is supported API.** Whatever `meta` a firefly reducer's
  `prepare` returns stays on the dispatched action, next to `meta.firefly`, and
  reaches `onError(error, action)`. This already worked in 1.x; it is now
  documented and covered by the compatibility promise.

### Changed

- **BREAKING: empty writes are a no-op.** An effect of `[]`, `{}`, a record
  whose slots are all skipped or empty lists, or `undefined` / `null` runs
  nothing and dispatches no commit and no rollback. It never reaches `onError`.
  The original action still reaches the reducers.
- **BREAKING: a bare single drizzle query runs through `database.transaction`**,
  like an array does, so it waits behind a transaction already open on the same
  database instead of running inside it. Its commit result is unchanged.
  On a database whose `transaction()` is synchronous and refuses an async
  callback (drizzle's `better-sqlite3` driver), it is awaited directly, as in
  1.x.
- **BREAKING: commit and rollback are always dispatched for `createFireflySlice`
  writes**, including reducers that define neither handler. Actions built by
  hand with `meta.firefly` are unaffected: they dispatch only the `commit` /
  `rollback` they declare.
- **BREAKING: `isFireflyAction` returns `false` for a `null` effect**, as it
  already did for `undefined`. `FireflyMeta['effect']` now also admits a
  record, `null` and `undefined`.
- `createFireflySlice` returns a `FireflySlice`: RTK's `Slice` with the matcher
  types added to its action creators. It stays assignable to `Slice`.
- **Typing: the action creator of a firefly reducer without `prepare` takes the
  payload.** `fireflyReducer({ reducer: (state, action: PayloadAction<Todo>) => ..., effect })`
  now gives a creator typed `(payload: Todo)`, which is what it always did at
  runtime; the argument is optional when the payload type admits `undefined` or
  is not annotated. 1.x typed it with no arguments. See
  [Migrating from 1.x](#5-action-creators-without-prepare-take-the-payload).
- `createFireflySlice` no longer modifies the definitions its `reducers`
  callback returns (1.x replaced their `prepare` in place).
- A firefly definition written by hand, without the `fireflyReducer` helper and
  without `prepare`, dispatches its first argument as the payload, as the
  helper's definitions do. 1.x dispatched `payload: null` for it. (The 1.x types
  did not accept such a definition, so this concerns JavaScript and casts.)
- **Typing: `fireflyReducer` rejects an `effect` that is a Promise**
  (`effect: async (p) => ...`, or a query that was awaited or run). 1.x compiled
  it and failed the write when it ran; see the next entry.
- An effect that is no effect at all (a Promise, a `Date`, an `{ sql }` object
  whose `sql` is not a string) still fails the write, as in 1.x (rollback and
  `onError`), now with an error that says what it was given instead of a
  `TypeError` from the SQL path. It is never taken for an empty write.

### Fixed

- An array of Drizzle queries ran its statements one by one, outside any
  transaction, after its rollback had been dispatched, on a database whose
  `transaction()` is synchronous and refuses an async callback (drizzle's
  `better-sqlite3` driver throws `Transaction function cannot return a
  promise`). The write still rolls back, as it cannot run in one transaction
  there, but no statement runs any more, and the error says why. Record effects
  behave the same.
- An array of Drizzle queries committed at once, before its statements had run
  and without their results, on a database whose `transaction()` does not wait
  for its callback (drizzle's `durable-sqlite` driver drops the callback's
  promise and returns `{}`), and a statement that failed afterwards was never
  reported. The write now settles when its statements have: it commits their
  results, or rolls back with the error of the one that failed, and runs none
  after it. The statements still run outside that transaction, as they do with
  drizzle's synchronous `expo-sqlite` driver. Record effects behave the same.
- An array of Drizzle queries committed the results of the statements that had
  run when `database.transaction` resolved although its callback had failed (a
  runner that does not rethrow). It rolls back with the statement's error.
- A `null` effect passed `isFireflyAction` (`typeof null === 'object'`) and then
  crashed in the raw SQL path.
- A rollback always carries an `Error`. A non-`Error` value thrown while the
  commit action was being dispatched (by a commit handler, for example) is now
  wrapped before it reaches the rollback action and `onError`.
- An array of Drizzle queries committed the results of every attempt when
  `database.transaction` retried its callback (on `SQLITE_BUSY`, say), which
  shifted the positional results. Only the run that went through is committed.
  Records and single statements behave the same way.

### Migrating from 1.x

Everything else you wrote for 1.x keeps compiling and behaving the same: the
single and array effect forms, the shape of commit and rollback actions
(`meta.firefly.result`, `meta.firefly.error`), hydration, `applyRows`, and
hand-written `meta.firefly` actions. The one thing that stops compiling never
worked: an `effect` that is a Promise (an `async` effect function) failed every
write in 1.x, and `fireflyReducer` now rejects it.

#### 1. Empty writes no longer commit or fail

**Who is affected.** Any write whose effect can end up with no statements,
typically `effect: (p) => p.ids.map(...)` with an empty list, or an effect that
is `{}` or `null`.

**What you will observe.** In 1.x the outcome depended on the database:

| Effect in 1.x | With a `FireflyDriver` | With a drizzle database |
| --- | --- | --- |
| `[]` | ran an empty transaction, then dispatched commit with `[]` | failed: rollback and `onError` |
| `{}` or `null` | failed: rollback and `onError` | failed: rollback and `onError` |

In 2.0 none of that happens. The action reaches the reducers (an optimistic
`reducer` still runs), and then nothing: no database work, no commit, no
rollback, no `onError`.

**What to do.**

- Delete guards and placeholder statements that only existed to keep an empty
  write from failing.
- If a `commit` or `rollback` handler undoes something the optimistic `reducer`
  set (a `syncing` flag, a pending entry), make sure the reducer does not set it
  when there is nothing to write. No handler will run to clear it.
- Code that waits for a write to settle by watching for its commit or rollback
  must not wait for an empty write. `isEmptyEffect(action.meta.firefly.effect)`
  tells you up front. A `createFireflySlice` write with an empty effect is
  dispatched with `meta.firefly.effect` set to `undefined`.

#### 2. A single drizzle query runs inside `database.transaction`

**Who is affected.** Stores configured with a drizzle database whose effects are
one bare query (`effect: (p) => db.insert(todos).values(p)`). Raw SQL effects
are unaffected, and so is a drizzle query dispatched to a store configured with
a `FireflyDriver` (no `transaction` function, so it is awaited directly as
before).

**What you will observe.** `database.transaction(callback)` is called once per
single-statement write and the query is awaited inside the callback.

- On a database whose `transaction()` waits for an async callback, each such
  write is now wrapped in `BEGIN` / `COMMIT`, and it queues behind a transaction
  already open on that database.
- The commit result is the query's own result, as before.
- A test double for `database` that has a `transaction` method must call its
  callback. If `transaction` resolves although the callback was never called,
  the statement did not run and the write rolls back.
- The outcome of the write is the callback's, not `transaction()`'s. If
  `transaction` resolves, or returns, before its callback has finished
  (drizzle's `durable-sqlite` driver drops the callback's promise and returns
  `{}`), the statement is running on its own, outside that transaction:
  redux-firefly waits for it, and commits its result or rolls back with its
  error, as 1.x did.

**What to do.** On a single-connection database (SQLite), usually nothing. Set
`transactionalSingleStatements: false` to restore the 1.x direct await if you do
not want a `BEGIN` / `COMMIT` around every single-statement write.

**With drizzle's `better-sqlite3` driver** nothing changes for a single query.
Its `transaction()` is synchronous and throws
`Transaction function cannot return a promise` when given an async callback, so
no transaction can hold the query: redux-firefly awaits it directly, as 1.x did,
and commits its result. Set `transactionalSingleStatements: false` to skip the
refused `BEGIN` / `ROLLBACK` before each write. Arrays could not run on this
driver in 1.x and still cannot, and neither can records: they roll back, now
without running any statement.

**With a pooled driver, set it to `false`.** This is not only a matter of cost.
On a pool (`node-postgres`, for example), `database.transaction` holds one
connection while its callback runs, and the query, which was built on `database`
and not on the transaction, takes a second connection to run. Each
single-statement write therefore needs two connections at once, and the
statement does not run inside that transaction anyway. With
`serializeEffects: false`, as many concurrent writes as the pool has connections
hold all of them while each waits for one more. Unless the pool has an acquire
timeout they wait forever: no commit, no rollback, no `onError`. In 1.x only
array effects could do this.

```typescript
createReduxFirefly({
  database: db,
  serializeEffects: false, // pooled driver
  transactionalSingleStatements: false, // required with a pool
});
```

You can also set it with
drizzle's synchronous `expo-sqlite` driver, whose `transaction()` does not wait
for an async callback: there the query runs right after an empty `BEGIN` /
`COMMIT` rather than inside it, and the option only saves that round trip. The
option covers the bare single-query form only. Arrays and records always use a
transaction.

#### 3. Every `createFireflySlice` write dispatches commit or rollback

**Who is affected.** `createFireflySlice` users with firefly reducers that
define no `commit` or no `rollback` handler. Plain Redux users who build
`meta.firefly` by hand are unaffected.

**What you will observe.** Every write that runs is followed by
`{name}/{reducerKey}/commit` or `{name}/{reducerKey}/rollback`, even when the
reducer has no handler for it. For a reducer with neither handler that is one
more dispatched action per write, and two action types that did not exist in
1.x. They show up in:

- Redux DevTools and logging middleware;
- listener middleware, `addMatcher` and custom middleware that match broadly,
  for example on `action.type.startsWith('todos/')`;
- tests that assert the exact list of dispatched actions;
- store subscribers, which are notified once more per write. State is
  unchanged unless a reducer handles the action.

A rollback action carries an `Error` at `meta.firefly.error`, so keep
`ignoredActionPaths: ['meta.firefly']` in your `serializableCheck` config.

**What to do.**

- Update tests that assert exact action sequences.
- Narrow matchers that match a slice's actions by prefix if they should not see
  commits and rollbacks.
- Filter the new types in DevTools or your logger if they are noise.
- Remove no-op handlers (`commit: () => {}`) that existed only to get the
  action dispatched.

#### 4. `isFireflyAction` is `false` for a `null` effect

**Who is affected.** Code that calls `isFireflyAction` itself, such as custom
middleware, or that reads `action.meta.firefly.effect` through the
`FireflyMeta` type.

**What you will observe.** `isFireflyAction` returns `false` when the effect is
`null`, as it already did for `undefined`. It stays `true` for `[]` and `{}`;
the middleware skips those as empty writes. At the type level,
`FireflyMeta['effect']` now also includes `FireflyEffectRecord`, `null` and
`undefined`, so code that narrows it by hand may need another branch.

**What to do.** Use `isEmptyEffect(effect)` to ask whether there is anything to
run, rather than inspecting the effect's shape.

#### 5. Action creators without `prepare` take the payload

**Who is affected.** TypeScript users with a firefly reducer that has no
`prepare` and whose `reducer` annotates its action
(`reducer: (state, action: PayloadAction<Todo>) => ...`). This is a typing
change only; nothing changes at runtime.

**What you will observe.** In 1.x such a creator was typed with no arguments,
although it dispatched its first argument as the payload: `replaceTodo(todo)`
did not compile, and `replaceTodo()` compiled and dispatched `undefined`. In 2.0
it is typed `(payload: Todo)`. A call without the payload is now a compile error
when the payload is required. Creators whose reducer does not annotate the
action, or whose payload may be `undefined`, can still be called with no
argument.

**What to do.** Pass the payload, and drop any cast that was working around the
1.x signature.

#### Adopting the new API

None of this is required, but it is what 2.0 is for:

- Replace `'todos/addTodo/commit'` strings with `addTodo.commit.type`,
  `addTodo.commit.match(action)`, or `onCommit(builder, addTodo, handler)`.
- Replace positional array effects with record effects where a commit handler
  reads results: `results.profile` instead of `action.meta.firefly.result[0].rows`.
- Read `results` and `error` off the handler argument instead of
  `action.meta.firefly`.
