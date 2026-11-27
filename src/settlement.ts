/**
 * How a firefly write ended: its statements committed (with their results),
 * or it rolled back with an error and nothing changed.
 */
export type WriteOutcome<R = any> =
  | { committed: true; results: R }
  | { committed: false; error: Error };

export type WriteSettler = (outcome: WriteOutcome) => void;

// Shared via Symbol.for on globalThis so separate entrypoints (main vs toolkit)
// and CJS/ESM module graphs observe the same pending-write map.
const PENDING_WRITES = Symbol.for('redux-firefly/pending-writes');

function pendingWrites(): WeakMap<object, WriteSettler> {
  const store = globalThis as Record<symbol, WeakMap<object, WriteSettler> | undefined>;
  if (!store[PENDING_WRITES]) {
    store[PENDING_WRITES] = new WeakMap();
  }
  return store[PENDING_WRITES];
}

export function registerPendingWrite(key: object, settle: WriteSettler): void {
  pendingWrites().set(key, settle);
}

export function claimPendingWrite(key: object): WriteSettler | undefined {
  const map = pendingWrites();
  const settle = map.get(key);
  if (settle) {
    map.delete(key);
  }
  return settle;
}

export function cancelPendingWrite(key: object): boolean {
  return pendingWrites().delete(key);
}
