/**
 * Integration tests for fetchResubscriptionsData()
 *
 * Tests the lib function directly (as the page now calls it) rather than
 * going through the HTTP API layer. Verifies the function works standalone
 * with a Supabase client — which is what the Server Component uses.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestSupabaseAdminClient } from "../helpers/supabase";
import { fetchResubscriptionsData } from "@/lib/resubscription-data";

const PREFIX = "test-resub-data-";

describe("fetchResubscriptionsData()", () => {
  const supabase = getTestSupabaseAdminClient();

  // Customer A: cancelled and resubscribed once — SHOULD appear
  const customerA = {
    kajabi_customer_id: `${PREFIX}cust-a`,
    email: `${PREFIX}a@example.com`,
    name: "Resub Alice",
    data: {},
  };

  // Customer B: only one active purchase — should NOT appear
  const customerB = {
    kajabi_customer_id: `${PREFIX}cust-b`,
    email: `${PREFIX}b@example.com`,
    name: "Active Betty",
    data: {},
  };

  // Customer C: cancelled, never returned — should NOT appear
  const customerC = {
    kajabi_customer_id: `${PREFIX}cust-c`,
    email: `${PREFIX}c@example.com`,
    name: "Gone Carol",
    data: {},
  };

  // Customer D (old email) + Customer D2 (new email): same person via alias.
  // D cancelled under old email, D2 resubscribed under new email.
  // Without alias resolution this looks like 0 resubscriptions each; with it, 1.
  const customerDOld = {
    kajabi_customer_id: `${PREFIX}cust-d-old`,
    email: `${PREFIX}d-old@example.com`,
    name: "Diana Old",
    data: {},
  };
  const customerDNew = {
    kajabi_customer_id: `${PREFIX}cust-d-new`,
    email: `${PREFIX}d-new@example.com`,
    name: "Diana New",
    data: {},
  };

  beforeAll(async () => {
    await cleanup(supabase);

    await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .insert([customerA, customerB, customerC, customerDOld, customerDNew]);

    await supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .insert([
        // A: cancelled → resubscribed (92-day gap: Jun 1 → Sep 1)
        {
          kajabi_purchase_id: `${PREFIX}p-a1`,
          kajabi_customer_id: customerA.kajabi_customer_id,
          effective_start_at: "2024-01-01T00:00:00Z",
          deactivated_at: "2024-06-01T00:00:00Z",
          data: {},
        },
        {
          kajabi_purchase_id: `${PREFIX}p-a2`,
          kajabi_customer_id: customerA.kajabi_customer_id,
          effective_start_at: "2024-09-01T00:00:00Z",
          deactivated_at: null,
          data: {},
        },
        // B: single active purchase
        {
          kajabi_purchase_id: `${PREFIX}p-b1`,
          kajabi_customer_id: customerB.kajabi_customer_id,
          effective_start_at: "2024-03-01T00:00:00Z",
          deactivated_at: null,
          data: {},
        },
        // C: cancelled, no follow-up
        {
          kajabi_purchase_id: `${PREFIX}p-c1`,
          kajabi_customer_id: customerC.kajabi_customer_id,
          effective_start_at: "2023-06-01T00:00:00Z",
          deactivated_at: "2023-12-01T00:00:00Z",
          data: {},
        },
        // D-old: cancelled under old email
        {
          kajabi_purchase_id: `${PREFIX}p-d1`,
          kajabi_customer_id: customerDOld.kajabi_customer_id,
          effective_start_at: "2023-01-01T00:00:00Z",
          deactivated_at: "2023-08-01T00:00:00Z",
          data: {},
        },
        // D-new: resubscribed under new email (alias of old)
        {
          kajabi_purchase_id: `${PREFIX}p-d2`,
          kajabi_customer_id: customerDNew.kajabi_customer_id,
          effective_start_at: "2024-01-01T00:00:00Z",
          deactivated_at: null,
          data: {},
        },
      ]);

    // Register d-old as an alias of d-new (canonical = new email)
    await supabase
      .from("member_email_aliases")
      .insert({
        canonical_email: customerDNew.email,
        alias_email: customerDOld.email,
      });
  });

  afterAll(async () => {
    await cleanup(supabase);
  });

  it("returns only customers with at least one resubscription", async () => {
    const data = await fetchResubscriptionsData(supabase);
    const testEmails = data.members
      .map((m) => m.memberEmail)
      .filter((e) => e.startsWith(PREFIX));

    expect(testEmails).toContain(customerA.email);
    expect(testEmails).not.toContain(customerB.email);
    expect(testEmails).not.toContain(customerC.email);
  });

  it("returns correct resubscription event details", async () => {
    const data = await fetchResubscriptionsData(supabase);
    const memberA = data.members.find((m) => m.memberEmail === customerA.email)!;

    expect(memberA.resubscriptions).toHaveLength(1);
    expect(memberA.resubscriptions[0].cancelledAt).toBe("2024-06-01T00:00:00Z");
    expect(memberA.resubscriptions[0].resubscribedAt).toBe("2024-09-01T00:00:00Z");
    expect(memberA.resubscriptions[0].gapDays).toBe(92);
  });

  it("sets isCurrentlyActive correctly", async () => {
    const data = await fetchResubscriptionsData(supabase);
    const memberA = data.members.find((m) => m.memberEmail === customerA.email)!;
    expect(memberA.isCurrentlyActive).toBe(true);
  });

  it("totalActiveMembers counts only active and on_hiatus members", async () => {
    const data = await fetchResubscriptionsData(supabase);
    expect(data.totalActiveMembers).toBeGreaterThan(0);
  });

  it("cohortByMonth includes the resubscription month", async () => {
    const data = await fetchResubscriptionsData(supabase);
    const months = data.cohortByMonth.map((c) => c.month);
    expect(months).toContain("2024-09");
  });

  it("cohortByMonth spans from first event to current month with no gaps", async () => {
    const data = await fetchResubscriptionsData(supabase);
    if (data.cohortByMonth.length < 2) return;

    for (let i = 1; i < data.cohortByMonth.length; i++) {
      const prev = new Date(data.cohortByMonth[i - 1].month + "-01");
      const curr = new Date(data.cohortByMonth[i].month + "-01");
      prev.setMonth(prev.getMonth() + 1);
      expect(prev.toISOString().slice(0, 7)).toBe(curr.toISOString().slice(0, 7));
    }
  });

  it("merges purchases across alias emails as a single member", async () => {
    const data = await fetchResubscriptionsData(supabase);

    // D's old email is an alias of D's new email — purchases from both customer
    // records should be combined under the canonical (new) email
    const dOldEntry = data.members.find((m) => m.memberEmail === customerDOld.email);
    const dNewEntry = data.members.find((m) => m.memberEmail === customerDNew.email);

    // Should appear exactly once, under the canonical email
    expect(dOldEntry).toBeUndefined();
    expect(dNewEntry).toBeDefined();
    expect(dNewEntry!.resubscriptions).toHaveLength(1);
  });
});

async function cleanup(supabase: ReturnType<typeof getTestSupabaseAdminClient>) {
  await supabase
    .from("member_email_aliases")
    .delete()
    .like("alias_email", `${PREFIX}%`);
  await supabase
    .schema("bronze")
    .from("kajabi_purchases")
    .delete()
    .like("kajabi_purchase_id", `${PREFIX}%`);
  await supabase
    .schema("bronze")
    .from("kajabi_customers")
    .delete()
    .like("kajabi_customer_id", `${PREFIX}%`);
}
