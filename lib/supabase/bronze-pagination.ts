// Fetches every row from a Bronze-schema table, paginating past Supabase's
// default 1000-row cap (5000 locally, per supabase/config.toml's [api] block)
// so large tables (e.g. kajabi_contacts, kajabi_purchases, stripe_customers)
// don't get silently truncated. See CLAUDE.md "Database Query Limits".
//
// Shared by app/api/process/members/route.ts and lib/kajabi/membership-history.ts
// so every Bronze read used to build a member's profile goes through the same
// paginated fetch — a route-local, unpaginated `.select()` against a Bronze
// table that grows over time (e.g. stripe_customers) is exactly the kind of
// gap this consolidation is meant to prevent from recurring.
export async function fetchAllBronzeRows(
  supabase: any,
  table: string,
  columns: string = "*",
  filter?: (query: any) => any
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.schema("bronze").from(table).select(columns);
    if (filter) query = filter(query);
    const { data: batch, error } = await query.range(offset, offset + BATCH_SIZE - 1);

    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}
