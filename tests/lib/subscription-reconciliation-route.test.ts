import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// The Kajabi/Stripe reconciliation: for each member, what their Stripe subscription says they
// should have in Kajabi against what they have. Members come from their repository (in memory
// here); the Bronze billing data comes from the in-memory dataset and the overrides are faked.

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
  { id: "m-paying", name: "Paying Example", displayName: "Pay E", email: "paying@example.test", kajabiId: "kj-paying" }, // Stripe active, Kajabi inactive
  { id: "m-kajabi", name: "Kajabi Only", email: "kajabi@example.test" }, // Kajabi active, no Stripe
  { id: "m-gift", name: "Gift Example", email: "gift@example.test" }, // gift override, nothing else
  { id: "m-paused", name: "Paused Example", email: "paused@example.test" }, // paused in Stripe, inactive in Kajabi
  { id: "m-retreat", name: "Retreat Example", email: "retreat@example.test" }, // only a retreat plan: not a membership
  { id: "m-hiatus", name: "Hiatus Example", email: "hiatus@example.test" }, // on hiatus, nothing else
  { id: "m-none", name: "Nothing Example", email: "none@example.test" }, // no data anywhere
  { id: "m-pastdue", name: "Past Due Example", email: "pastdue@example.test" }, // past due in Stripe: still active until cancelled
  { id: "m-canceled", name: "Canceled Example", email: "canceled@example.test" }, // cancelled in Stripe, inactive in Kajabi
  { id: "m-multi", name: "Multi Example", email: "multi@example.test" }, // two Kajabi customers, one under an old aliased email
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
  repos = createInMemoryRepos(new InMemoryDataset({
    members: MEMBERS,
    kajabiOffers: [{ kajabi_offer_id: "off-1", name: MEMBERSHIP_PRODUCT_NAMES[0] }],
    kajabiPurchases: [
      { kajabi_purchase_id: "p1", kajabi_customer_id: "kc-paying", kajabi_offer_id: "off-1", deactivated_at: "2026-09-01T00:00:00Z", imported_at: "2026-10-01T00:00:00Z" },
      { kajabi_purchase_id: "p2", kajabi_customer_id: "kc-kajabi", kajabi_offer_id: "off-1", deactivated_at: null, imported_at: "2026-10-02T00:00:00Z" },
      // m-multi: the deactivated purchase comes first, but the live one under the other customer is the one that counts.
      { kajabi_purchase_id: "p3", kajabi_customer_id: "kc-multi-old", kajabi_offer_id: "off-1", deactivated_at: "2026-08-01T00:00:00Z", imported_at: "2026-10-03T00:00:00Z" },
      { kajabi_purchase_id: "p4", kajabi_customer_id: "kc-multi", kajabi_offer_id: "off-1", deactivated_at: null, imported_at: "2026-10-04T00:00:00Z" },
      { kajabi_purchase_id: "p5", kajabi_customer_id: "kc-multi-old", kajabi_offer_id: "off-1", deactivated_at: "2026-07-01T00:00:00Z", imported_at: "2026-10-05T00:00:00Z" },
    ],
    kajabiCustomers: [
      { kajabi_customer_id: "kc-paying", email: "paying@example.test" },
      { kajabi_customer_id: "kc-kajabi", email: "KAJABI@example.test" },
      { kajabi_customer_id: "kc-multi", email: "multi@example.test" },
      { kajabi_customer_id: "kc-multi-old", email: "multi.old@example.test" },
    ],
    stripeProducts: [{ stripe_product_id: MEMBERSHIP_PRODUCT, name: MEMBERSHIP_PRODUCT_NAMES[0] }],
    stripeCustomers: [
      { stripe_customer_id: "cus_paying", email: "other@example.test", data: { metadata: { kjb_member_id: "kj-paying" } } }, // matched by Kajabi id
      { stripe_customer_id: "cus_paused", email: "paused@example.test", data: {} }, // matched by email
      { stripe_customer_id: "cus_retreat", email: "retreat@example.test", data: {} },
      { stripe_customer_id: "cus_pastdue", email: "pastdue@example.test", data: {} },
      { stripe_customer_id: "cus_canceled", email: "canceled@example.test", data: {} },
    ],
    stripeSubscriptions: [
      sub("sub_paying", "cus_paying"),
      sub("sub_paused", "cus_paused", { pause_collection: { behavior: "void" } }),
      sub("sub_retreat", "cus_retreat", {}, "prod_retreat"),
      sub("sub_pastdue", "cus_pastdue", { status: "past_due" }),
      sub("sub_canceled", "cus_canceled", { status: "canceled" }),
    ],
  }));
  tables = {
    member_status_overrides: { data: [{ id: "ov-1", member_id: "m-gift", override_type: "gift", reason: "180 program", notes: null, starts_at: "2026-01-01", expires_at: null }] },
    member_hiatus_history: { data: [{ member_id: "m-hiatus", start_date: "2020-01-01", end_date: null }] },
    member_email_aliases: { data: [{ canonical_email: "multi@example.test", alias_email: "multi.old@example.test" }] },
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
    expect(byId["m-paying"]).toMatchObject({ member_name: "Paying Example", member_display_name: "Pay E", expected_kajabi_state: "active", actual_kajabi_state: "inactive", stripe_state: "paying", has_discrepancy: true });
    // Active in Kajabi (matched by email, any case) with nothing in Stripe.
    expect(byId["m-kajabi"]).toMatchObject({ member_display_name: null, expected_kajabi_state: "inactive", actual_kajabi_state: "active", stripe_state: "none", has_discrepancy: true });
    // A gift override keeps them active without a subscription.
    expect(byId["m-gift"]).toMatchObject({ expected_kajabi_state: "active", actual_kajabi_state: "inactive", override_type: "gift", override_reason: "180 program", has_discrepancy: true });
    // Paused in Stripe, inactive in Kajabi: as expected.
    expect(byId["m-paused"]).toMatchObject({ expected_kajabi_state: "inactive", actual_kajabi_state: "inactive", stripe_state: "paused", has_discrepancy: false });
    // Someone on hiatus has data even with nothing else.
    expect(byId["m-hiatus"]).toMatchObject({ is_on_hiatus: true, has_discrepancy: false });
    // Past due is still active until it is cancelled; a cancelled subscription expects nothing.
    expect(byId["m-pastdue"]).toMatchObject({ expected_kajabi_state: "active", stripe_state: "past_due", has_discrepancy: true });
    expect(byId["m-canceled"]).toMatchObject({ expected_kajabi_state: "inactive", stripe_state: "canceled", has_discrepancy: false });
    // Two Kajabi customers for one person (the old one under an aliased email): the live purchase wins.
    expect(byId["m-multi"]).toMatchObject({ actual_kajabi_state: "active", expected_kajabi_state: "inactive", has_discrepancy: true });
    // A retreat payment plan is not a membership subscription, and a member with nothing anywhere is left out.
    expect(byId["m-retreat"]).toBeUndefined();
    expect(byId["m-none"]).toBeUndefined();

    expect(summary).toMatchObject({ total_members: 8, active_in_stripe: 1, paused_in_stripe: 1, active_in_kajabi: 2, total_overrides: 1, discrepancies: 5 });
  });

  it("includes every subscription when Stripe has no membership product configured", async () => {
    vi.spyOn(repos.billing, "stripeProductsByName").mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { members } = await (await call()).json();

    expect(members.find((m: { member_id: string }) => m.member_id === "m-retreat")).toMatchObject({ stripe_state: "paying" });
  });

  it("answers with nothing when no system has any data", async () => {
    repos = createInMemoryRepos();
    tables = Object.fromEntries(Object.keys(tables).map((key) => [key, { data: [] }]));

    const { members, summary } = await (await call()).json();

    expect(members).toEqual([]);
    expect(summary).toMatchObject({ total_members: 0, active_in_stripe: 0, paused_in_stripe: 0, active_in_kajabi: 0, total_overrides: 0, discrepancies: 0 });
  });

  it("reports a failed products read as a server error", async () => {
    vi.spyOn(repos.billing, "kajabiOffersByName").mockRejectedValue(new Error("offers read failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "offers read failed" });
  });
});
