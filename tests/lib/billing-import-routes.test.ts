import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The Kajabi and Stripe imports write Bronze through the billing repository (the in-memory twin here);
// the APIs they pull from are faked.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: {} } : { user: null }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/courses/sync", () => ({ syncKajabiCourses: async () => ({ synced: true }) }));
const triggerReprocessing = vi.fn(async () => ({ processed: ["members"] }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessing(...(args as [])) }));

const kajabi = {
  fetchAllContacts: vi.fn(),
  fetchAllCustomers: vi.fn(),
  fetchAllSubscriptions: vi.fn(),
  fetchAllOffers: vi.fn(),
};
vi.mock("@/lib/kajabi/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kajabi/client")>()),
  createKajabiClient: () => kajabi,
}));
const stripe = { fetchAllCustomers: vi.fn(), fetchAllProducts: vi.fn(), fetchAllSubscriptions: vi.fn() };
vi.mock("@/lib/stripe/client", () => ({ createStripeClient: () => stripe }));

import { POST as importKajabi } from "@/app/api/import/kajabi/route";
import { POST as importStripe } from "@/app/api/import/stripe/route";
import { POST as importMembers } from "@/app/api/import/members/route";
import { POST as importSubscriptions } from "@/app/api/import/subscriptions/route";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";

const kajabiContact = (id: string, email: string) => ({
  id,
  type: "contacts",
  attributes: { name: `Contact ${id}`, email, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
});

beforeEach(() => {
  signedIn = true;
  dataset = new InMemoryDataset();
  repos = createInMemoryRepos(dataset);
  triggerReprocessing.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  kajabi.fetchAllContacts.mockResolvedValue([kajabiContact("kc-1", "Ada@Example.test")]);
  kajabi.fetchAllCustomers.mockResolvedValue([
    { id: "cust-1", attributes: { email: "Ada@Example.test", name: "Ada Example", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" } },
  ]);
  kajabi.fetchAllSubscriptions.mockResolvedValue([
    {
      id: "pur-1",
      relationships: { customer: { data: { id: "cust-1" } }, offer: { data: { id: "off-1" } } },
      attributes: { amount_in_cents: 2500, currency: null, deactivated_at: null, created_at: "2026-01-02T00:00:00Z", effective_start_at: "2026-01-09T00:00:00Z" },
    },
    {
      id: "pur-2",
      relationships: {},
      attributes: { amount_in_cents: 0, currency: "USD", deactivated_at: "2026-03-01T00:00:00Z", created_at: "2026-01-03T00:00:00Z", effective_start_at: null },
    },
  ]);
  kajabi.fetchAllOffers.mockResolvedValue([{ id: "off-1", attributes: { title: "Membership", status: "active", trial_period_days: 7 } }]);
});

const post = (handler: (r: NextRequest) => Promise<Response>, path: string, body?: FormData) =>
  handler(new NextRequest(`http://localhost${path}`, { method: "POST", body }));

describe("POST /api/import/kajabi", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await post(importKajabi, "/api/import/kajabi")).status).toBe(401);
  });

  it("stores contacts, customers, purchases and offers, then reprocesses members; a second run adds nothing", async () => {
    const first = await (await post(importKajabi, "/api/import/kajabi")).json();
    await post(importKajabi, "/api/import/kajabi");

    expect(first).toMatchObject({ success: true, members: { contacts: 1, customers: 1, purchases: 2, offers: 1 } });
    expect(dataset.kajabiContacts).toHaveLength(1);
    expect(dataset.kajabiContacts[0]).toMatchObject({ kajabi_contact_id: "kc-1", email: "ada@example.test" });
    expect(dataset.kajabiCustomers[0]).toMatchObject({ kajabi_customer_id: "cust-1", email: "ada@example.test" });
    expect(dataset.kajabiPurchases.map((p) => [p.kajabi_purchase_id, p.status, p.kajabi_offer_id, p.currency])).toEqual([
      ["pur-1", "active", "off-1", "USD"],
      ["pur-2", "canceled", null, "USD"],
    ]);
    expect(dataset.kajabiOffers[0]).toMatchObject({ kajabi_offer_id: "off-1", name: "Membership", trial_period_days: 7 });
    expect(triggerReprocessing).toHaveBeenCalledWith("kajabi_contacts", "bronze");
  });

  it.each([
    ["upsertKajabiContacts", "Contacts import failed: boom"],
    ["upsertKajabiCustomers", "Customers import failed: boom"],
    ["upsertKajabiPurchases", "Purchases import failed: boom"],
    ["upsertKajabiOffers", "Offers import failed: boom"],
  ] as const)("reports a failed %s as a server error", async (method, message) => {
    vi.spyOn(repos.billing, method).mockRejectedValue(new Error("boom"));

    const res = await post(importKajabi, "/api/import/kajabi");

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(message);
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/stripe", () => {
  beforeEach(() => {
    stripe.fetchAllCustomers.mockResolvedValue([{ id: "cus_1", email: "Ada@Example.test", name: "Ada Example", created: 1767225600 }]);
    stripe.fetchAllProducts.mockResolvedValue([{ id: "prod_1", name: "Membership", active: true }]);
    stripe.fetchAllSubscriptions.mockResolvedValue([
      { id: "sub_1", customer: "cus_1", status: "active", created: 1767225600, current_period_start: 1767225600, current_period_end: 1769904000, canceled_at: null, pause_collection: null },
      { id: "sub_2", customer: { id: "cus_1" }, status: "canceled", created: 1767225600, canceled_at: 1769904000, pause_collection: null },
    ]);
  });

  it("stores customers, products and subscriptions, and counts subscriptions by status", async () => {
    const body = await (await post(importStripe, "/api/import/stripe")).json();
    await post(importStripe, "/api/import/stripe");

    expect(body.stripe).toMatchObject({ customers: 1, products: 1, subscriptions: 2, statusBreakdown: { active: 1, canceled: 1 } });
    expect(dataset.stripeCustomers).toHaveLength(1);
    expect(dataset.stripeCustomers[0]).toMatchObject({ stripe_customer_id: "cus_1", email: "ada@example.test" });
    expect(dataset.stripeProducts[0]).toMatchObject({ stripe_product_id: "prod_1", name: "Membership" });
    expect(dataset.stripeSubscriptions.map((s) => [s.stripe_subscription_id, s.stripe_customer_id, s.status])).toEqual([
      ["sub_1", "cus_1", "active"],
      ["sub_2", "cus_1", "canceled"],
    ]);
    expect(dataset.stripeSubscriptions[1].canceled_at).toBe("2026-02-01T00:00:00.000Z");
  });

  it.each([
    ["upsertStripeCustomers", "Customers import failed: boom"],
    ["upsertStripeProducts", "Products import failed: boom"],
    ["upsertStripeSubscriptions", "Subscriptions import failed: boom"],
  ] as const)("reports a failed %s as a server error", async (method, message) => {
    vi.spyOn(repos.billing, method).mockRejectedValue(new Error("boom"));

    const res = await post(importStripe, "/api/import/stripe");

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(message);
  });
});

function csvUpload(name: string, text: string) {
  const form = new FormData();
  form.set("file", new File([text], name, { type: "text/csv" }));
  return form;
}

describe("POST /api/import/members", () => {
  const CSV = "Name,Email,Member Created At\nAda Example,Ada@Example.test,2026-01-01\n";

  it("adds a snapshot row per member and reprocesses; importing again adds another snapshot", async () => {
    const body = await (await post(importMembers, "/api/import/members", csvUpload("members.csv", CSV))).json();
    await post(importMembers, "/api/import/members", csvUpload("members.csv", CSV));

    expect(body).toMatchObject({ success: true, imported: 1 });
    expect(dataset.kajabiMembers.map((m) => m.email)).toEqual(["ada@example.test", "ada@example.test"]);
    expect(triggerReprocessing).toHaveBeenCalledWith("kajabi_members", "bronze");
  });

  it("rejects a missing or non-CSV file", async () => {
    expect((await post(importMembers, "/api/import/members", new FormData())).status).toBe(400);
    expect((await post(importMembers, "/api/import/members", csvUpload("members.txt", CSV))).status).toBe(400);
  });

  it("reports a failed write as a server error", async () => {
    vi.spyOn(repos.billing, "insertKajabiMembers").mockRejectedValue(new Error("boom"));

    const res = await post(importMembers, "/api/import/members", csvUpload("members.csv", CSV));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});

describe("POST /api/import/subscriptions", () => {
  const CSV =
    "Kajabi Subscription ID,Customer Email,Customer Name,Status,Created At,Offer Title\n" +
    "ks-1,Ada@Example.test,Ada Example,Active,2026-01-01,Membership\n" +
    "ks-2,fern@example.test,Fern Example,Canceled,2026-01-02,Membership\n";

  it("stores every subscription, counts them by status and reprocesses", async () => {
    const body = await (await post(importSubscriptions, "/api/import/subscriptions", csvUpload("subs.csv", CSV))).json();

    expect(body).toMatchObject({ success: true, imported: 2, statusBreakdown: { Active: 1, Canceled: 1 } });
    expect(dataset.subscriptionHistory.map((s) => [s.kajabi_subscription_id, s.customer_email])).toEqual([
      ["ks-1", "ada@example.test"],
      ["ks-2", "fern@example.test"],
    ]);
    expect(triggerReprocessing).toHaveBeenCalledWith("subscription_history", "bronze");
  });

  it("rejects a missing file, a non-CSV file and a CSV with no subscriptions", async () => {
    expect((await post(importSubscriptions, "/api/import/subscriptions", new FormData())).status).toBe(400);
    expect((await post(importSubscriptions, "/api/import/subscriptions", csvUpload("subs.txt", CSV))).status).toBe(400);
    const empty = "Kajabi Subscription ID,Customer Email,Customer Name,Status,Created At\n,,,,\n";
    expect((await post(importSubscriptions, "/api/import/subscriptions", csvUpload("subs.csv", empty))).status).toBe(400);
  });

  it("reports a failed write as a server error", async () => {
    vi.spyOn(repos.billing, "upsertSubscriptionHistory").mockRejectedValue(new Error("boom"));

    const res = await post(importSubscriptions, "/api/import/subscriptions", csvUpload("subs.csv", CSV));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});

describe("refreshKajabiContactInBronze", () => {
  const client = {} as never;

  it("fetches the contact again and stores it on its contact id", async () => {
    const fetchContact = vi.fn(async () => kajabiContact("kc-9", "New@Example.test") as never);

    const contact = await refreshKajabiContactInBronze(client, { fetchContact }, "kc-9");

    expect(contact.id).toBe("kc-9");
    expect(dataset.kajabiContacts).toHaveLength(1);
    expect(dataset.kajabiContacts[0]).toMatchObject({ kajabi_contact_id: "kc-9", email: "new@example.test" });
  });

  it("names the table when the write fails", async () => {
    vi.spyOn(repos.billing, "upsertKajabiContacts").mockRejectedValue(new Error("boom"));

    await expect(refreshKajabiContactInBronze(client, { fetchContact: async () => kajabiContact("kc-9", "a@example.test") as never }, "kc-9")).rejects.toThrow(
      "kajabi_contacts refresh failed: boom"
    );
  });
});
