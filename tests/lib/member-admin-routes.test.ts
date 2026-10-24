import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// Admin routes that look members up through their repository (in memory here); the bronze
// tables they join to are faked.

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let tables: FakeTables = {};
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, supabase: createFakeSupabase(tables) } : { user: null }),
}));

import { GET as externalStatus } from "@/app/api/admin/members/external-status/route";
import { GET as kajabiGrants } from "@/app/api/analyze/kajabi-grants/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", status: "active", kajabiId: "kaj-ada", stripeCustomerId: "cus_ada" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "Fern@Example.test", status: "cancelled", kajabiId: null, stripeCustomerId: null };

beforeEach(() => {
  signedIn = true;
  tables = {};
  repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA, FERN] }));
});

describe("GET /api/admin/members/external-status", () => {
  const call = (ids: string) => externalStatus(new NextRequest(`http://localhost/api/admin/members/external-status?ids=${ids}`));

  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call(ADA.id)).status).toBe(401);
  });

  it("answers nothing for no ids, or ids that match no member", async () => {
    expect(await (await call("")).json()).toEqual({ members: {} });
    expect(await (await call("mbr_ZZZZZZZZZZZZ")).json()).toEqual({ members: {} });
  });

  it("reports each member's Kajabi, Stripe and Slack standing", async () => {
    tables = {
      member_email_aliases: { data: [] },
      "bronze.kajabi_customers": { data: [{ kajabi_customer_id: "kc-1", email: ADA.email }] },
      "bronze.kajabi_purchases": { data: [{ kajabi_customer_id: "kc-1" }] },
      "bronze.stripe_subscriptions": { data: [{ stripe_customer_id: "cus_ada" }] },
      "bronze.slack_users": { data: [{ user_id: "U_FERN", email: "fern@example.test" }] },
    };

    const { members } = await (await call(`${ADA.id},${FERN.id}`)).json();

    expect(members[ADA.id]).toEqual({
      kajabi_id: "kaj-ada",
      kajabi_active_purchases: 1,
      stripe_customer_id: "cus_ada",
      stripe_active_subscriptions: 1,
      slack_user_id: null,
    });
    expect(members[FERN.id]).toMatchObject({ kajabi_id: null, kajabi_active_purchases: 0, stripe_customer_id: null, stripe_active_subscriptions: 0, slack_user_id: "U_FERN" });
  });
});

describe("GET /api/analyze/kajabi-grants", () => {
  const call = () => kajabiGrants(new NextRequest("http://localhost/api/analyze/kajabi-grants"));

  it("lists membership purchases with no money behind them, with the member they belong to", async () => {
    tables = {
      "bronze.kajabi_offers": { data: [{ kajabi_offer_id: "off-1", name: "Quill & Cup Membership" }] },
      "bronze.kajabi_purchases": {
        data: [
          { kajabi_purchase_id: "p-granted", kajabi_customer_id: "kc-ada", kajabi_offer_id: "off-1", amount_in_cents: 0, created_at_kajabi: "2026-09-01T00:00:00Z", data: { relationships: { transactions: { data: [] } } } },
          { kajabi_purchase_id: "p-paid", kajabi_customer_id: "kc-fern", kajabi_offer_id: "off-1", amount_in_cents: 2500, created_at_kajabi: "2026-09-02T00:00:00Z", data: { relationships: { transactions: { data: [{ id: "t" }] } } } },
          { kajabi_purchase_id: "p-unknown", kajabi_customer_id: "kc-nobody", kajabi_offer_id: "off-1", amount_in_cents: 0, created_at_kajabi: "2026-09-03T00:00:00Z", data: null },
        ],
      },
      "bronze.kajabi_customers": { data: [{ kajabi_customer_id: "kc-ada", email: ADA.email }, { kajabi_customer_id: "kc-nobody", email: "nobody@example.test" }] },
    };

    const { grants } = await (await call()).json();

    expect(grants.map((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id).sort()).toEqual(["p-granted", "p-unknown"]);
    expect(grants.find((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id === "p-granted")).toMatchObject({
      offer_name: "Quill & Cup Membership",
      member_id: ADA.id,
      member_name: ADA.name,
      member_status: "active",
    });
    // No member has that email.
    expect(grants.find((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id === "p-unknown")).toMatchObject({ member_id: null, member_email: "nobody@example.test" });
  });

  it("is for signed-in admins, and empty when there are no membership offers", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
    signedIn = true;
    tables = { "bronze.kajabi_offers": { data: [] } };
    expect(await (await call()).json()).toEqual({ grants: [] });
  });
});
