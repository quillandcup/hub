import type { SupabaseClient } from "@supabase/supabase-js";

/** Every row of a query, past Supabase's 1000-row cap (see CLAUDE.md, "Database Query Limits"). */
export async function fetchAll(supabase: SupabaseClient, table: string, columns: string, filter: (q: any) => any) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(offset, offset + 999);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** `ids` in slices small enough for an `.in()` filter. */
export function inBatches<T>(ids: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
