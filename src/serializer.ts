/**
 * Serializes async DB work onto a single chain so that, on a single-connection
 * driver, effects never interleave (SQLite rejects a `BEGIN` inside an open
 * transaction). When `enabled` is false (pooled multi-connection drivers),
 * work runs immediately with no serialization.
 */
export interface Serializer {
  /** Run `task` after all previously-enqueued work settles; returns its result. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

const noop = (): void => {};

export function createSerializer(enabled: boolean): Serializer {
  if (!enabled) {
    return { run: (task) => task() };
  }
  // The chain tail never rejects, so a throwing task can't poison the queue.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(noop, noop);
      return result;
    },
  };
}
