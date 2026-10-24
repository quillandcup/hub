import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// The Kajabi/Stripe reconciliation: for each member, what their Stripe subscription says they
// should have in Kajabi against what they have. Members come from their repository (in memory
// here); the bronze tables and overrides are faked.

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let tables: FakeTables = {};
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: createFakeSupabase(tables) } : { user: null }),
}));

import { GET } from "@/app/api/analyze/subscription-reconciliation/route";

const call = () => GET(new NextRequest("http://localhost/api/analyze/subscription-reconciliation"));

const MEMBERS = [
  { id: "m-paying", name: "Paying Example", email: "paying@example.test", kajabiId: "kj-paying" }, // Stripe active, Kajabi inactive
  { id: "m-kajabi", name: "Kajabi Only", email: "kajabi@example.test" }, // Kajabi active, no Stripe
  { id: "m-gift", name: "Gift Example", email: "gift@example.test" }, // gift override, nothing else
  { id: "m-paused", name: "Paused Example", email: "paused@example.test" }, // paused in Stripe, inactive in Kajabi
  { id: "m-retreat", name: "Retreat Example", email: "retreat@example.test" }, // only a retreat plan: not a membership
  { id: "m-hiatus", name: "Hiatus Example", email: "hiatus@example.test" }, // on hiatus, nothing else
  { id: "m-none", name: "Nothing Example", email: "none@example.test" }, // no data anywhere
];

const MEMBERSHIP_PRODUCT = "prod_membership";
const sub = (id: string, customer: string, overrides: Record<string, unknown> = {}, product = MEMBERSHIP_PRODUCT) => ({
  stripe_subscription_id: id,
  stripe_customer_id: customer,
  status: "active",
  pause_collection: null,
  data: { items: { data: [{ price: { product } }] } },
  imported_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  signedIn = true;
  repos = createInMemoryRepos(new InMemoryDataset({ members: MEMBERS }));
  tables = {
    "bronze.kajabi_offers": { data: [{ kajabi_offer_id: "off-1" }] },
    "bronze.kajabi_purchases": {
      data: [
        { kajabi_purchase_id: "p1", kajabi_customer_id: "kc-paying", kajabi_offer_id: "off-1", deactivated_at: "2026-09-01T00:00:00Z", imported_at: "2026-10-01T00:00:00Z" },
        { kajabi_purchase_id: "p2", kajabi_customer_id: "kc-kajabi", kajabi_offer_id: "off-1", deactivated_at: null, imported_at: "2026-10-02T00:00:00Z" },
      ],
    },
    "bronze.kajabi_customers": {
      data: [
        { kajabi_customer_id: "kc-paying", email: "paying@example.test" },
        { kajabi_customer_id: "kc-kajabi", email: "KAJABI@example.test" },
      ],
    },
    "bronze.stripe_products": { data: [{ stripe_product_id: MEMBERSHIP_PRODUCT, name: "Quill & Cup Membership" }] },
    "bronze.stripe_customers": {
      data: [
        { stripe_customer_id: "cus_paying", email: "other@example.test", data: { metadata: { kjb_member_id: "kj-paying" } } }, // matched by Kajabi id
        { stripe_customer_id: "cus_paused", email: "paused@example.test", data: {} }, // matched by email
        { stripe_customer_id: "cus_retreat", email: "retreat@example.test", data: {} },
      ],
    },
    "bronze.stripe_subscriptions": {
      data: [
        sub("sub_paying", "cus_paying"),
        sub("sub_paused", "cus_paused", { pause_collection: { behavior: "void" } }),
        sub("sub_retreat", "cus_retreat", {}, "prod_retreat"),
      ],
    },
    member_status_overrides: { data: [{ id: "ov-1", member_id: "m-gift", override_type: "gift", reason: "180 program", notes: null, starts_at: "2026-01-01", expires_at: null }] },
    member_hiatus_history: { data: [{ member_id: "m-hiatus", start_date: "2020-01-01", end_date: null }] },
    member_email_aliases: { data: [] },
  };
});

describe("GET /api/analyze/subscription-reconciliation", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
  });

  it("compares what Stripe says each member should have in Kajabi with what they have", async () => {
    const { members, summary } = await (await call()).json();
    const byId = Object.fromEntries(members.map((m: { member_id: string }) => [m.member_id, m]));

    // Paying in Stripe (matched through the Kajabi id in the customer's metadata) but inactive in Kajabi.
    expect(byId["m-paying"]).toMatchObject({ expected_kajabi_state: "active", actual_kajabi_state: "inactive", stripe_state: "paying", has_discrepancy: true });
    // Active in Kajabi (matched by email, any case) with nothing in Stripe.
    expect(byId["m-kajabi"]).toMatchObject({ expected_kajabi_state: "inactive", actual_kajabi_state: "active", stripe_state: "none", has_discrepancy: true });
    // A gift override keeps them active without a subscription.
    expect(byId["m-gift"]).toMatchObject({ expected_kajabi_state: "active", actual_kajabi_state: "inactive", override_type: "gift", override_reason: "180 program", has_discrepancy: true });
    // Paused in Stripe, inactive in Kajabi: as expected.
    expect(byId["m-paused"]).toMatchObject({ expected_kajabi_state: "inactive", actual_kajabi_state: "inactive", stripe_state: "paused", has_discrepancy: false });
    // Someone on hiatus has data even with nothing else.
    expect(byId["m-hiatus"]).toMatchObject({ is_on_hiatus: true, has_discrepancy: false });
    // A retreat payment plan is not a membership subscription, and a member with nothing anywhere is left out.
    expect(byId["m-retreat"]).toBeUndefined();
    expect(byId["m-none"]).toBeUndefined();

    expect(summary).toMatchObject({ total_members: 5, active_in_stripe: 1, paused_in_stripe: 1, active_in_kajabi: 1, total_overrides: 1, discrepancies: 3 });
  });

  it("includes every subscription when Stripe has no membership product configured", async () => {
    tables["bronze.stripe_products"] = { data: [] };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { members } = await (await call()).json();

    expect(members.find((m: { member_id: string }) => m.member_id === "m-retreat")).toMatchObject({ stripe_state: "paying" });
  });

  it("reports a failed products read as a server error", async () => {
    tables["bronze.kajabi_offers"] = { error: { message: "offers read failed" } };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "offers read failed" });
  });
});
