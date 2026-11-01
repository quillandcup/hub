import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import { createInMemoryRepos } from "@/lib/data/repos";

// Admin routes that look members up through their repository (in memory here); the Bronze
// billing data they join to is in the same dataset.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, supabase: {} } : { user: null }),
}));

import { GET as externalStatus } from "@/app/api/admin/members/external-status/route";
import { GET as kajabiGrants } from "@/app/api/analyze/kajabi-grants/route";
import { GET as memberNetwork } from "@/app/api/members/network/route";
import { POST as linkSlackAlias } from "@/app/api/aliases/slack/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.test", status: "active", kajabiId: "kaj-ada", stripeCustomerId: "cus_ada" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "Fern@Example.test", status: "cancelled", kajabiId: null, stripeCustomerId: null };

beforeEach(() => {
  signedIn = true;
  dataset = new InMemoryDataset({ members: [ADA, FERN] });
  repos = createInMemoryRepos(dataset);
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
    dataset.kajabiCustomers = [{ kajabi_customer_id: "kc-1", email: ADA.email }];
    dataset.kajabiPurchases = [{ kajabi_purchase_id: "p-1", kajabi_customer_id: "kc-1", status: "active" }];
    dataset.stripeSubscriptions = [{ stripe_subscription_id: "sub_ada", stripe_customer_id: "cus_ada", status: "active" }];
    dataset.slackUsers = [{ user_id: "U_FERN", email: "fern@example.test", is_bot: false }];

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
    dataset.kajabiOffers = [{ kajabi_offer_id: "off-1", name: MEMBERSHIP_PRODUCT_NAMES[0] }];
    dataset.kajabiPurchases = [
        { kajabi_purchase_id: "p-granted", kajabi_customer_id: "kc-ada", kajabi_offer_id: "off-1", amount_in_cents: 0, created_at_kajabi: "2026-09-01T00:00:00Z", data: { relationships: { transactions: { data: [] } } } },
        { kajabi_purchase_id: "p-paid", kajabi_customer_id: "kc-fern", kajabi_offer_id: "off-1", amount_in_cents: 2500, created_at_kajabi: "2026-09-02T00:00:00Z", data: { relationships: { transactions: { data: [{ id: "t" }] } } } },
        { kajabi_purchase_id: "p-unknown", kajabi_customer_id: "kc-nobody", kajabi_offer_id: "off-1", amount_in_cents: 0, created_at_kajabi: "2026-09-03T00:00:00Z", data: null },
    ];
    dataset.kajabiCustomers = [{ kajabi_customer_id: "kc-ada", email: ADA.email }, { kajabi_customer_id: "kc-nobody", email: "nobody@example.test" }];

    const { grants } = await (await call()).json();

    expect(grants.map((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id).sort()).toEqual(["p-granted", "p-unknown"]);
    expect(grants.find((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id === "p-granted")).toMatchObject({
      offer_name: MEMBERSHIP_PRODUCT_NAMES[0],
      member_id: ADA.id,
      member_name: ADA.name,
      member_display_name: "Ada E",
      member_status: "active",
    });
    // No member has that email.
    expect(grants.find((g: { kajabi_purchase_id: string }) => g.kajabi_purchase_id === "p-unknown")).toMatchObject({ member_id: null, member_display_name: null, member_email: "nobody@example.test" });
  });

  it("is for signed-in admins, and empty when there are no membership offers", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
    signedIn = true;
    expect(await (await call()).json()).toEqual({ grants: [] });
  });
});

describe("GET /api/members/network", () => {
  const prickleRow = (id: string, memberId: string, prickleId: string) => ({ id, memberId, prickleId, joinTime: "2026-09-01T15:00:00Z", leaveTime: "2026-09-01T16:00:00Z" });

  it("connects active members by the prickles they shared, scaled to the smaller attendance", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA, { ...FERN, id: "mbr_AAAAAAAAAAA3", status: "active" }, { id: "mbr_AAAAAAAAAAA4", name: "Gone Example", email: "gone@example.test", status: "cancelled" }],
        attendance: [
          prickleRow("a1", ADA.id, "prkl_1"),
          prickleRow("a2", "mbr_AAAAAAAAAAA3", "prkl_1"),
          prickleRow("a3", ADA.id, "prkl_2"),
          prickleRow("a4", "mbr_AAAAAAAAAAA3", "prkl_2"),
          prickleRow("a5", ADA.id, "prkl_3"),
        ],
      }),
    );

    const { nodes, edges } = await (await memberNetwork(new NextRequest("http://localhost/api/members/network"))).json();

    expect(nodes.map((n: { name: string }) => n.name)).toEqual(["Ada Example", "Fern Example"]); // by name, active only
    expect(nodes.find((n: { id: string }) => n.id === ADA.id).totalPrickles).toBe(3);
    expect(edges).toEqual([expect.objectContaining({ weight: 2, normalizedWeight: 100 })]); // 2 shared of the smaller member's 2
  });

  it("is for signed-in admins, and empty when nobody is active", async () => {
    signedIn = false;
    expect((await memberNetwork(new NextRequest("http://localhost/api/members/network"))).status).toBe(401);
    signedIn = true;
    repos = createInMemoryRepos();
    expect(await (await memberNetwork(new NextRequest("http://localhost/api/members/network"))).json()).toEqual({ nodes: [], edges: [] });
  });
});

describe("POST /api/aliases/slack", () => {
  const post = (body: unknown) =>
    linkSlackAlias(new NextRequest("http://localhost/api/aliases/slack", { method: "POST", body: JSON.stringify(body) }));

  it("needs both a member and a Slack user", async () => {
    expect((await post({ member_id: ADA.id })).status).toBe(400);
  });

  it("404s for a member that doesn't exist, and for a Slack user that doesn't", async () => {
    expect((await post({ member_id: "mbr_ZZZZZZZZZZZZ", slack_user_id: "U1" })).status).toBe(404);
    const res = await post({ member_id: ADA.id, slack_user_id: "U1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Slack user not found" });
  });

  it("links the Slack user to the member, taking the link over if another member had it", async () => {
    dataset.slackUsers = [{ user_id: "U1", display_name: "Ada", real_name: "Ada Example" }];
    dataset.nameAliases.push({ id: "nal_1", member_id: FERN.id, alias: "U1", source: "slack", active: true });

    const res = await post({ member_id: ADA.id, slack_user_id: "U1" });

    expect(res.status).toBe(200);
    expect(dataset.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([[ADA.id, "U1", "slack"]]);
  });

  it("reports it when the link can't be saved", async () => {
    dataset.slackUsers = [{ user_id: "U1", display_name: "Ada", real_name: "Ada Example" }];
    vi.spyOn(repos.aliases, "upsertName").mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ member_id: ADA.id, slack_user_id: "U1" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
  });
});
