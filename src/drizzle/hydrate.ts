import type { DrizzleQuery, DrizzleHydrationQuery, InferHydrationResult } from './types';

export function fireflyHydration<
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
  S = InferHydrationResult<Q>,
>(
  query: () => Q,
  transform?: (rows: InferHydrationResult<Q>) => S,
): DrizzleHydrationQuery<Q, S>;
export function fireflyHydration<
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
  S = InferHydrationResult<Q>,
>(
  query: Q,
  transform?: (rows: InferHydrationResult<Q>) => S,
): DrizzleHydrationQuery<Q, S>;
export function fireflyHydration(
  query: unknown,
  transform?: (rows: any) => any,
): DrizzleHydrationQuery<any, any> {
  const config: DrizzleHydrationQuery<any, any> =
    typeof query === 'function'
      ? { get query() { return (query as () => unknown)(); } } as DrizzleHydrationQuery<any, any>
      : { query } as DrizzleHydrationQuery<any, any>;
  if (transform) {
    config.transform = transform;
  }
  return config;
}
