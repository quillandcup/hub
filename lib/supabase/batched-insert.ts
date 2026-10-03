/**
 * Write rows in batches, a few batches at a time.
 *
 * Firing every batch at once (`Promise.all` over all of them) is fine for a
 * handful, but Silver rebuilds write tens of thousands of rows: 47 concurrent
 * 500-row inserts into member_activities got Cloudflare 520s back from
 * Supabase and lost a third of the batches. Stops at the first failed group
 * and throws its error.
 *
 * No retry: these tables have no unique key to dedupe on, and a 520 can come
 * back after Postgres committed the insert, so a retry could double rows.
 * Callers that DELETE + INSERT a scope heal on their next successful run.
 */
export async function writeInBatches<T>(
  rows: T[],
  write: (batch: T[]) => PromiseLike<{ error: unknown }>,
  { batchSize = 500, concurrency = 4 }: { batchSize?: number; concurrency?: number } = {}
): Promise<number> {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));

  let written = 0;
  for (let i = 0; i < batches.length; i += concurrency) {
    const group = batches.slice(i, i + concurrency);
    const results = await Promise.all(group.map((batch) => write(batch)));
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error(`Batch write failed after ${written} of ${rows.length} rows`);
      throw failed.error;
    }
    written += group.reduce((n, batch) => n + batch.length, 0);
  }
  return written;
}
