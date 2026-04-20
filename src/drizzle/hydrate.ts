import type { DrizzleQuery, DrizzleHydrationQuery, InferHydrationResult } from './types';

export function fireflyHydration<
  const Q extends DrizzleQuery | readonly DrizzleQuery[],
  S = InferHydrationResult<Q>,
>(
  query: Q,
  transform?: (rows: InferHydrationResult<Q>) => S,
): DrizzleHydrationQuery<Q, S> {
  return transform ? { query, transform } : { query };
}
