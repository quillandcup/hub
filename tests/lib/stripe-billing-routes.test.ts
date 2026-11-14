import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const repos = vi.hoisted(() => ({
  billing: { upsertStripeCustomers: vi.fn(), upsertStripeProducts: vi.fn(), upsertStripeSubscriptions: vi.fn() },
}));
const stripe = vi.hoisted(() => ({
  fetchAllCustomers: vi.fn(),
  fetchAllProducts: vi.fn(),
  fetchAllSubscriptions: vi.fn(),
}));

vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/cron-heartbeats", () => ({ pingCronHeartbeat: vi.fn() }));
vi.mock("@/lib/data/repos", () => ({ createRepos: vi.fn(() => repos) }));
vi.mock("@/lib/stripe/client", () => ({ createStripeClient: vi.fn(() => stripe) }));
vi.mock("@/lib/stripe/billing-import", async () => ({
  ...(await vi.importActual<typeof import("@/lib/stripe/billing-import")>("@/lib/stripe/billing-import")),
  importStripeBilling: vi.fn(),
}));

import { GET as reconcile } from "@/app/api/reconcile/stripe-billing/route";
import { POST as manualImport } from "@/app/api/import/stripe/route";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { importStripeBilling, StripeBillingPermissionError } from "@/lib/stripe/billing-import";

const request = (url = "http://localhost:3000/api/reconcile/stripe-billing") => new Request(url, { method: "POST" }) as unknown as NextRequest;
const done = { invoices: 3, charges: 4, invoicesSince: null, chargesSince: null, full: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "cron" } as never, forbidden: false, supabase: {} as never });
  vi.mocked(importStripeBilling).mockResolvedValue(done);
  for (const upsert of Object.values(repos.billing)) upsert.mockResolvedValue(undefined);
  stripe.fetchAllCustomers.mockResolvedValue([{ id: "cus_AAAA1", email: "ada@example.test", name: "Ada Example", created: 1_700_000_000 }]);
  stripe.fetchAllProducts.mockResolvedValue([{ id: "prod_AAAA1", name: "Membership", active: true }]);
  stripe.fetchAllSubscriptions.mockResolvedValue([{ id: "sub_AAAA1", customer: "cus_AAAA1", status: "active", created: 1_700_000_000, canceled_at: null, pause_collection: null }]);
});

describe("GET /api/reconcile/stripe-billing", () => {
  it("answers 401 when unauthenticated and 403 when not an admin, and imports nothing", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as never });
    expect((await reconcile(request())).status).toBe(401);
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "u" } as never, forbidden: true, supabase: {} as never });
    expect((await reconcile(request())).status).toBe(403);
    expect(importStripeBilling).not.toHaveBeenCalled();
  });

  it("imports, returns the counts and pings the heartbeat; ?full=1 reads everything", async () => {
    const response = await reconcile(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, reconciliation: "stripe-billing", ...done });
    expect(vi.mocked(importStripeBilling).mock.calls[0][2]).toEqual({ full: false });
    expect(pingCronHeartbeat).toHaveBeenCalledWith("reconcile-stripe-billing");

    await reconcile(request("http://localhost:3000/api/reconcile/stripe-billing?full=1"));
    expect(vi.mocked(importStripeBilling).mock.calls[1][2]).toEqual({ full: true });
  });

  it("answers 500 with the reason, without a ping, when the key may not read invoices", async () => {
    vi.mocked(importStripeBilling).mockRejectedValue(new StripeBillingPermissionError());
    const response = await reconcile(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("read access to Invoices and Charges");
    expect(pingCronHeartbeat).not.toHaveBeenCalled();

    vi.mocked(importStripeBilling).mockRejectedValue("odd");
    expect((await (await reconcile(request())).json()).error).toBe("Failed to import Stripe invoices and charges");
  });
});

describe("POST /api/import/stripe", () => {
  it("answers 401 and 403 like the other admin imports", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as never });
    expect((await manualImport(request("http://localhost:3000/api/import/stripe"))).status).toBe(401);
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "u" } as never, forbidden: true, supabase: {} as never });
    expect((await manualImport(request("http://localhost:3000/api/import/stripe"))).status).toBe(403);
  });

  it("imports customers, products, subscriptions, then invoices and charges", async () => {
    const response = await manualImport(request("http://localhost:3000/api/import/stripe?full=1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stripe).toMatchObject({ customers: 1, products: 1, subscriptions: 1, billing: done });
    expect(body.stripe.billingError).toBeUndefined();
    expect(vi.mocked(importStripeBilling).mock.calls[0][2]).toEqual({ full: true });
  });

  it("keeps the rest of the import when the key may not read invoices, and says so", async () => {
    vi.mocked(importStripeBilling).mockRejectedValue(new StripeBillingPermissionError());
    const body = await (await manualImport(request("http://localhost:3000/api/import/stripe"))).json();
    expect(body.success).toBe(true);
    expect(body.stripe.subscriptions).toBe(1);
    expect(body.stripe.billing).toBeUndefined();
    expect(body.stripe.billingError).toContain("Invoices and Charges");

    vi.mocked(importStripeBilling).mockRejectedValue("odd");
    expect((await (await manualImport(request("http://localhost:3000/api/import/stripe"))).json()).stripe.billingError).toBe("Invoices and charges import failed");
  });
});
