/**
 * Regression test for the Supabase default row-cap on Bronze-schema reads.
 *
 * fetchAllBronzeRows (lib/supabase/bronze-pagination.ts) is the shared helper behind
 * every Bronze-table read in app/api/process/members/route.ts and
 * lib/kajabi/membership-history.ts. A prior audit found that route.ts fetched
 * bronze.stripe_customers with a single unguarded `.select()` instead of this helper —
 * capped at the project's max-rows setting (1000 in production; 5000 locally per
 * supabase/config.toml's [api] block) — silently dropping rows past that cap from the
 * email -> stripe_customer_id map used when building `members`.
 *
 * This seeds more rows than the local cap and confirms fetchAllBronzeRows retrieves
 * every one of them, including rows past the cutoff. It seeds into bronze.kajabi_contacts
 * rather than bronze.stripe_customers: fetchAllBronzeRows itself doesn't care which
 * Bronze table it's paginating, but stripe_customers rows are also consumed by
 * lib/kajabi/membership-history.ts to build an `.in(...)` filter over stripe_subscriptions
 * whose URL length scales with total row count — since Vitest runs test files in
 * parallel against the same local Supabase instance, thousands of extra stripe_customers
 * rows here would intermittently break every *other* concurrently-running test that
 * calls /api/process/members with a "URI too long" error. kajabi_contacts has no such
 * downstream `.in()` consumer (see the "Members Bronze Pagination (>1000 rows)" suite in
 * tests/api/reprocessability/members-reprocessability.test.ts, which already seeds 5500
 * rows into it safely), so it's the safe table for proving the pagination mechanism here.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestSupabaseAdminClient } from "../helpers/supabase";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";

describe("fetchAllBronzeRows()", () => {
  const supabase = getTestSupabaseAdminClient();
  const ts = Date.now();
  const emailPrefix = `bronze-pagination-helper-${ts}`;
  const ROW_COUNT = 5500;

  const emailFor = (i: number) => `${emailPrefix}-${i}@example.com`;

  beforeAll(async () => {
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      kajabi_contact_id: `pagination-helper-contact-${ts}-${i}`,
      email: emailFor(i),
      name: `Pagination Helper Test ${i}`,
      created_at_kajabi: "2022-01-01T00:00:00Z",
      data: {},
    }));

    // Insert in chunks of 500 (CLAUDE.md batching guidance)
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .schema("bronze")
        .from("kajabi_contacts")
        .insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  }, 30000);

  afterAll(async () => {
    await supabase
      .schema("bronze")
      .from("kajabi_contacts")
      .delete()
      .ilike("email", `${emailPrefix}-%`);
  });

  it(
    "retrieves every row, including those past the Supabase query row cap",
    async () => {
      const rows = await fetchAllBronzeRows(
        supabase,
        "kajabi_contacts",
        "kajabi_contact_id, email",
        (q) => q.ilike("email", `${emailPrefix}-%`)
      );

      expect(rows).toHaveLength(ROW_COUNT);

      const emails = new Set(rows.map((r: any) => r.email));
      expect(emails.has(emailFor(0))).toBe(true);
      // Specifically confirm a row past row 1000 (the production cap) and past
      // row 5000 (the local dev cap) both made it through.
      expect(emails.has(emailFor(4000))).toBe(true);
      expect(emails.has(emailFor(ROW_COUNT - 1))).toBe(true);
    },
    60000
  );
});
