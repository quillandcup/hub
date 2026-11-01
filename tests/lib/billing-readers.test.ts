import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Code that reads the Kajabi and Stripe billing data through its repository (the in-memory twin here).

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: {} } : { user: null }),
}));

import { fetchTrialWindows } from "@/lib/trial-window";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import { GET as kajabiStripeComparison } from "@/app/api/analyze/kajabi-stripe-comparison/route";
import { createRepos } from "@/lib/data/repos";

const client = {} as SupabaseClient;
const unix = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

beforeEach(() => {
  signedIn = true;
  repos = createInMemoryRepos();
});

describe("fetchTrialWindows", () => {
  it("finds each member's trial windows through their email and its aliases", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        emailAliases: [{ id: "al-1", memberId: "mbr_AAAAAAAAAAA2", alias_email: "bea.old@example.test", canonical_email: "bea@example.test", active: true }],
        stripeCustomers: [
          { stripe_customer_id: "cus_ada", email: "ada@example.test" },
          { stripe_customer_id: "cus_bea", email: "bea.old@example.test" },
          { stripe_customer_id: "cus_other", email: "other@example.test" },
        ],
        stripeSubscriptions: [
          { stripe_subscription_id: "sub_ada", stripe_customer_id: "cus_ada", data: { trial_start: unix("2026-03-01"), trial_end: unix("2026-03-08") } },
          { stripe_subscription_id: "sub_bea", stripe_customer_id: "cus_bea", data: { trial_start: unix("2026-04-01"), trial_end: unix("2026-05-01") } },
          { stripe_subscription_id: "sub_notrial", stripe_customer_id: "cus_ada", data: {} },
          { stripe_subscription_id: "sub_other", stripe_customer_id: "cus_other", data: { trial_start: unix("2026-01-01"), trial_end: unix("2026-01-08") } },
        ],
      })
    );

    const windows = await fetchTrialWindows(createRepos(client), [
      { id: "mbr_AAAAAAAAAAA1", email: "Ada@Example.test" },
      { id: "mbr_AAAAAAAAAAA2", email: "bea@example.test" },
    ]);

    expect(windows.get("mbr_AAAAAAAAAAA1")).toEqual([{ start: "2026-03-01", end: "2026-03-08" }]);
    expect(windows.get("mbr_AAAAAAAAAAA2")).toEqual([{ start: "2026-04-01", end: "2026-05-01" }]);
    expect(windows.size).toBe(2);
  });

  it("answers nothing for no members, or members with no Stripe customer", async () => {
    expect((await fetchTrialWindows(createRepos(client), [])).size).toBe(0);
    expect((await fetchTrialWindows(createRepos(client), [{ id: "mbr_AAAAAAAAAAA1", email: "ada@example.test" }])).size).toBe(0);
  });
});

describe("fetchMembershipHistory", () => {
  const OFFER = { kajabi_offer_id: "off-1", name: "Quill & Cup Membership", data: { attributes: { subscription: true } }, trial_period_days: null };

  it("builds a member's stints from their purchases, dating billing from the end of the Stripe trial", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        kajabiOffers: [OFFER],
        kajabiCustomers: [{ kajabi_customer_id: "kc-1", email: "ada@example.test" }],
        kajabiPurchases: [
          { kajabi_purchase_id: "p-1", kajabi_customer_id: "kc-1", kajabi_offer_id: "off-1", status: "active", created_at_kajabi: "2026-03-01T12:00:00Z" },
        ],
        stripeCustomers: [{ stripe_customer_id: "cus_ada", email: "ada@example.test" }],
        stripeSubscriptions: [
          {
            stripe_subscription_id: "sub_ada",
            stripe_customer_id: "cus_ada",
            created_at_stripe: "2026-03-01T12:00:00Z",
            data: { trial_start: unix("2026-03-01"), trial_end: unix("2026-03-08") },
          },
        ],
      })
    );

    const history = await fetchMembershipHistory(createRepos(client), ["kc-1"]);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ created_at_kajabi: "2026-03-08T12:00:00.000Z" });
  });

  it("is empty with no customers, no purchases, or purchases of no offer", async () => {
    expect(await fetchMembershipHistory(createRepos(client), [])).toEqual([]);
    expect(await fetchMembershipHistory(createRepos(client), ["kc-none"])).toEqual([]);
    repos = createInMemoryRepos(new InMemoryDataset({ kajabiPurchases: [{ kajabi_purchase_id: "p-1", kajabi_customer_id: "kc-1" }] }));
    expect(await fetchMembershipHistory(createRepos(client), ["kc-1"])).toEqual([]);
  });
});

describe("GET /api/analyze/kajabi-stripe-comparison", () => {
  const call = () => kajabiStripeComparison(new NextRequest("http://localhost/api/analyze/kajabi-stripe-comparison"));

  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
  });

  it("flags a member Kajabi has active while Stripe has them paused, and counts who is only in one", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        kajabiPurchases: [
          { kajabi_purchase_id: "p-both", kajabi_customer_id: "kc-both", kajabi_offer_id: "2148128038" },
          { kajabi_purchase_id: "p-kajabi", kajabi_customer_id: "kc-kajabi", kajabi_offer_id: "2148293442" },
          { kajabi_purchase_id: "p-other-offer", kajabi_customer_id: "kc-both", kajabi_offer_id: "9999" },
        ],
        kajabiCustomers: [
          { kajabi_customer_id: "kc-both", email: "Both@example.test" },
          { kajabi_customer_id: "kc-kajabi", email: "kajabi@example.test" },
        ],
        stripeCustomers: [
          { stripe_customer_id: "cus_both", email: "both@example.test" },
          { stripe_customer_id: "cus_stripe", email: "stripe@example.test" },
        ],
        stripeSubscriptions: [
          { stripe_subscription_id: "sub_both", stripe_customer_id: "cus_both", status: "paused" },
          { stripe_subscription_id: "sub_stripe", stripe_customer_id: "cus_stripe", status: "active" },
        ],
      })
    );

    const body = await (await call()).json();

    expect(body.analysis.comparison).toMatchObject({ inBoth: 1, onlyKajabi: 1, onlyStripe: 1 });
    expect(body.sampleMismatches).toEqual([
      { email: "both@example.test", kajabiId: "p-both", kajabiStatus: "active", stripeId: "sub_both", stripeStatus: "paused" },
    ]);
    expect(body.analysis.kajabi).toMatchObject({ total: 2, nonCanceled: 2, canceled: 0 });
  });

  it("reports a failed read as a server error", async () => {
    vi.spyOn(repos.billing, "kajabiCustomerRows").mockRejectedValue(new Error("customers read failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("customers read failed");
  });
});
