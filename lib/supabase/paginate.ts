const BATCH_SIZE = 1000;

/**
 * Fetch every row matching a query, following CLAUDE.md's pagination rule
 * for tables/result sets that could exceed Supabase's default 1000-row
 * limit per request.
 *
 * `buildQuery` must build a *fresh* query each call (do not reuse a single
 * builder instance) so `.range(from, to)` narrows a new request each page.
 *
 * Example:
 * ```ts
 * const rows = await fetchAllRows<{ segment_id: string }>((from, to) =>
 *   supabase.from("segment_members").select("segment_id").range(from, to)
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

/** Split an array into chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
