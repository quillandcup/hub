/**
 * Runs `worker` over `items` with at most `limit` in flight, for uploading several attachments at once.
 * Results come back in the order of `items`, whatever order they finish in. The first failure stops
 * everything: nothing new starts, the signal passed to the running workers is aborted, and that failure
 * is returned (index included) once the in-flight workers have settled. Aborting `signal` stops the pool
 * the same way and returns `{ ok: false, aborted: true }`.
 */

export const CHAT_UPLOAD_CONCURRENCY = 3;

export type PoolOutcome<R, E> = { ok: true; results: R[] } | { ok: false; index: number; error: E; aborted: boolean };

export async function runPool<T, R, E>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<{ ok: true; value: R } | { ok: false; error: E }>,
  signal?: AbortSignal,
): Promise<PoolOutcome<R, E>> {
  const inner = new AbortController();
  const stop = () => inner.abort();
  if (signal?.aborted) inner.abort();
  signal?.addEventListener("abort", stop, { once: true });

  const results: R[] = new Array(items.length);
  let failure: { index: number; error: E } | null = null;
  let next = 0;

  const lane = async () => {
    while (!inner.signal.aborted && next < items.length) {
      const index = next++;
      const outcome = await worker(items[index], index, inner.signal);
      if (outcome.ok) {
        results[index] = outcome.value;
      } else {
        if (!failure) failure = { index, error: outcome.error };
        inner.abort();
      }
    }
  };

  const lanes = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : lanes }, lane));
  signal?.removeEventListener("abort", stop);

  if (failure) return { ok: false, ...(failure as { index: number; error: E }), aborted: false };
  if (inner.signal.aborted) return { ok: false, index: -1, error: undefined as E, aborted: true };
  return { ok: true, results };
}
