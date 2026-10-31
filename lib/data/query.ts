import { chunk } from "@/lib/supabase/paginate";

/**
 * Query helpers shared by the repositories in `lib/data/`. Pagination (`fetchAllRows`) and `chunk` live in
 * `lib/supabase/paginate.ts`; this module has what the repositories used to define for themselves.
 */

/** What a PostgREST read resolves to: rows or an error message. */
export type Page<T> = { data: T[] | null; error: { message: string } | null };

/** A query that resolves to a `Page` (what `fetchAllRows` wants back from its builder). */
export type PageQuery<T> = PromiseLike<Page<T>>;

/**
 * Types a built query (usually a `.select(...).range(from, to)` whose generated row type is wider or
 * narrower than the rows you want) as a `PageQuery<T>`. A cast and nothing else: `T` is on you.
 */
export const asPage = <T>(query: unknown) => query as PageQuery<T>;

/** The data of a `{ data, error }` result, or throws `new Error(error.message)` (the database's message, for logs). */
export function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * Runs `run` for each chunk (at most `size` items) of the distinct `values`, all chunks together, and joins the
 * rows in chunk order. An empty input runs nothing and returns `[]`. Order within the result across chunks
 * follows the chunks, so sort afterwards when order matters (see `sortByKey`).
 */
export async function inChunks<T>(values: string[], size: number, run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const parts = chunk([...new Set(values)], size);
  return (await Promise.all(parts.map(run))).flat();
}

/** -1, 0 or 1 comparing two strings by code unit, as the database orders the ids and emails stored here. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A sorted copy of `rows` ordered by a text key. Ties keep their input order (the sort is stable); no tie-break. */
export function sortByKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => compareText(key(a), key(b)));
}

/**
 * A comparator on a text key with the id as the tie-break (always ascending, even when the key is
 * `descending`), so pages ordered `key, id` never repeat or skip a row.
 */
export const byKeyThenId =
  <T>(key: (row: T) => string, id: (row: T) => string, descending = false) =>
  (a: T, b: T) => {
    const x = key(a);
    const y = key(b);
    if (x !== y) return (x < y ? -1 : 1) * (descending ? -1 : 1);
    return compareText(id(a), id(b));
  };

/** What `upsertInChunks` needs from a table: `.upsert(rows, { onConflict })`. A Supabase table builder fits. */
type Upsertable<Row> = {
  upsert(rows: Row[], options: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
};

/**
 * Upserts `rows` into `table` on `onConflict` in chunks of `size` (default 500), so one statement stays under
 * the API role's statement timeout. `concurrency` chunks run at once (default 1: one after the other). Throws
 * `new Error(message)` of the first failed chunk in a group, after that group finishes. No rows, no request.
 */
export async function upsertInChunks<Row>(
  table: Upsertable<Row>,
  rows: Row[],
  onConflict: string,
  size = 500,
  concurrency = 1
): Promise<void> {
  const parts = chunk(rows, size);
  for (let i = 0; i < parts.length; i += concurrency) {
    const results = await Promise.all(parts.slice(i, i + concurrency).map((part) => table.upsert(part, { onConflict })));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }
}
