const BATCH_SIZE = 1000;

/**
 * Fetch every row matching a query, following the pagination rule (.claude/rules/api-routes-and-queries.md)
 * for tables/result sets that could exceed Supabase's default 1000-row
 * limit per request.
 *
 * `buildQuery` must build a *fresh* query each call (do not reuse a single
 * builder instance) so `.range(from, to)` narrows a new request each page.
 *
 * Example:
 * ```ts
 * const rows = await fetchAllRows<{ id: string }>((from, to) =>
 *   supabase.from("some_table").select("id").range(from, to)
 * );
 * ```
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await buildQuery(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      all = all.concat(data);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return all;
}

/**
 * Fetch rows `from` to `from + count - 1` of an ordered query, which may be more than the 1000 rows one request
 * returns: it asks for at most 1000 at a time and stops at the first short batch. `buildQuery` must order by a unique
 * column, so the batches never overlap or skip a row.
 */
export async function fetchRowWindow<T>(
  from: number,
  count: number,
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  const end = from + count;
  for (let offset = from; offset < end; offset += BATCH_SIZE) {
    const take = Math.min(BATCH_SIZE, end - offset);
    const { data, error } = await buildQuery(offset, offset + take - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < take) break;
  }
  return rows;
}

/** Split an array into chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
