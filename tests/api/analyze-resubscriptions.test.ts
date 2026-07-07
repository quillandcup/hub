/**
 * Integration tests for GET /api/analyze/resubscriptions
 *
 * Seeds bronze.kajabi_customers and bronze.kajabi_purchases (no offers, so all
 * purchases are included), then verifies the API correctly detects which customers
 * have resubscribed and returns accurate counts/percentages.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from "../helpers/supabase";

const PREFIX = "test-resub-";

describe("GET /api/analyze/resubscriptions", () => {
  const supabase = getTestSupabaseAdminClient();
  const baseUrl = getTestApiBaseUrl();

  // ---- test fixtures -------------------------------------------------------

  // Customer A: cancelled and resubscribed — SHOULD appear
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

  // Customer C: cancelled once but never came back — should NOT appear
  const customerC = {
    kajabi_customer_id: `${PREFIX}cust-c`,
    email: `${PREFIX}c@example.com`,
    name: "Gone Carol",
    data: {},
  };

  // Customer D: cancelled and resubscribed twice — SHOULD appear with 2 events
  const customerD = {
    kajabi_customer_id: `${PREFIX}cust-d`,
    email: `${PREFIX}d@example.com`,
    name: "Double Dana",
    data: {},
  };

  // ---- seed ----------------------------------------------------------------

  beforeAll(async () => {
    // Clean up any leftovers first
    await cleanup(supabase);

    // Insert customers
    await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .insert([customerA, customerB, customerC, customerD]);

    // Customer A: cancelled Jan → resubscribed Sep
    await supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .insert([
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
      ]);

    // Customer B: one active purchase
    await supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .insert([
        {
          kajabi_purchase_id: `${PREFIX}p-b1`,
          kajabi_customer_id: customerB.kajabi_customer_id,
          effective_start_at: "2024-03-01T00:00:00Z",
          deactivated_at: null,
          data: {},
        },
      ]);

    // Customer C: cancelled, never returned
    await supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .insert([
        {
          kajabi_purchase_id: `${PREFIX}p-c1`,
          kajabi_customer_id: customerC.kajabi_customer_id,
          effective_start_at: "2023-06-01T00:00:00Z",
          deactivated_at: "2023-12-01T00:00:00Z",
          data: {},
        },
      ]);

    // Customer D: cancelled twice, came back twice
    await supabase
      .schema("bronze")
      .from("kajabi_purchases")
      .insert([
        {
          kajabi_purchase_id: `${PREFIX}p-d1`,
          kajabi_customer_id: customerD.kajabi_customer_id,
          effective_start_at: "2023-01-01T00:00:00Z",
          deactivated_at: "2023-04-01T00:00:00Z",
          data: {},
        },
        {
          kajabi_purchase_id: `${PREFIX}p-d2`,
          kajabi_customer_id: customerD.kajabi_customer_id,
          effective_start_at: "2023-07-01T00:00:00Z",
          deactivated_at: "2023-10-01T00:00:00Z",
          data: {},
        },
        {
          kajabi_purchase_id: `${PREFIX}p-d3`,
          kajabi_customer_id: customerD.kajabi_customer_id,
          effective_start_at: "2024-02-01T00:00:00Z",
          deactivated_at: null,
          data: {},
        },
      ]);
  });

  afterAll(async () => {
    await cleanup(supabase);
  });

  // ---- tests ---------------------------------------------------------------

  it("returns 200 with valid shape", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("totalResubscribingMembers");
    expect(body).toHaveProperty("totalMembersEver");
    expect(body).toHaveProperty("members");
    expect(body).toHaveProperty("cohortByMonth");
  });

  it("only counts customers with at least one resubscription", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    const body = await res.json();

    const testMembers = body.members.filter((m: any) =>
      m.memberEmail.startsWith(PREFIX)
    );

    // A and D should appear; B and C should not
    const emails = testMembers.map((m: any) => m.memberEmail);
    expect(emails).toContain(customerA.email);
    expect(emails).toContain(customerD.email);
    expect(emails).not.toContain(customerB.email);
    expect(emails).not.toContain(customerC.email);
  });

  it("counts resubscription events correctly for each member", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    const body = await res.json();

    const memberA = body.members.find((m: any) => m.memberEmail === customerA.email);
    const memberD = body.members.find((m: any) => m.memberEmail === customerD.email);

    expect(memberA.resubscriptions).toHaveLength(1);
    expect(memberD.resubscriptions).toHaveLength(2);
  });

  it("correctly sets isCurrentlyActive", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    const body = await res.json();

    const memberA = body.members.find((m: any) => m.memberEmail === customerA.email);
    const memberD = body.members.find((m: any) => m.memberEmail === customerD.email);

    expect(memberA.isCurrentlyActive).toBe(true);  // last purchase active
    expect(memberD.isCurrentlyActive).toBe(true);  // last purchase active
  });

  it("returns correct gap days for customer A (92 days: Jun 1 → Sep 1)", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    const body = await res.json();

    const memberA = body.members.find((m: any) => m.memberEmail === customerA.email);
    expect(memberA.resubscriptions[0].gapDays).toBe(92);
  });

  it("cohortByMonth contains months for resubscription events", async () => {
    const res = await fetch(`${baseUrl}/api/analyze/resubscriptions`, {
      headers: getTestAuthHeaders(),
    });
    const body = await res.json();

    const months = body.cohortByMonth.map((c: any) => c.month);
    // Customer A resubscribed 2024-09, customer D resubscribed 2023-07 and 2024-02
    expect(months).toContain("2024-09");
    expect(months).toContain("2023-07");
    expect(months).toContain("2024-02");
  });
});

async function cleanup(supabase: ReturnType<typeof getTestSupabaseAdminClient>) {
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
