import { describe, expect, it, vi } from "vitest";
import { importStripeCore } from "@/lib/stripe/core-import";

const build = () => {
  const billing = {
    upsertStripeCustomers: vi.fn().mockResolvedValue(undefined),
    upsertStripeProducts: vi.fn().mockResolvedValue(undefined),
    upsertStripeSubscriptions: vi.fn().mockResolvedValue(undefined),
  };
  const stripe = {
    fetchAllCustomers: vi.fn().mockResolvedValue([
      { id: "cus_AAAA1", email: "Ada@Example.test", name: "Ada Example", created: 1_700_000_000 },
      { id: "cus_AAAA2", email: null, name: null, created: 1_700_000_100 },
    ]),
    fetchAllProducts: vi.fn().mockResolvedValue([{ id: "prod_AAAA1", name: "Membership", active: true }]),
    fetchAllSubscriptions: vi.fn().mockResolvedValue([
      { id: "sub_AAAA1", customer: "cus_AAAA1", status: "active", created: 1_700_000_000, canceled_at: null, pause_collection: { behavior: "void" }, current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 },
      { id: "sub_AAAA2", customer: { id: "cus_AAAA2" }, status: "canceled", created: 1_700_000_000, canceled_at: 1_701_000_000, pause_collection: null },
    ]),
  };
  return { billing, stripe };
};

describe("importStripeCore", () => {
  it("maps and upserts customers, products and subscriptions, and returns the counts", async () => {
    const { billing, stripe } = build();
    const result = await importStripeCore(billing as never, stripe as never);
    expect(result).toMatchObject({ customers: 2, products: 1, subscriptions: 2, statusBreakdown: { active: 1, canceled: 1 } });
    expect(stripe.fetchAllSubscriptions).toHaveBeenCalledWith("all");
    expect(billing.upsertStripeCustomers.mock.calls[0][0][0]).toMatchObject({ stripe_customer_id: "cus_AAAA1", email: "ada@example.test", imported_at: result.importTimestamp });
    expect(billing.upsertStripeCustomers.mock.calls[0][0][1].email).toBeNull();
    const [active, canceled] = billing.upsertStripeSubscriptions.mock.calls[0][0];
    expect(active).toMatchObject({ stripe_customer_id: "cus_AAAA1", pause_collection: { behavior: "void" }, current_period_end: new Date(1_702_592_000_000).toISOString() });
    expect(canceled).toMatchObject({ stripe_customer_id: "cus_AAAA2", current_period_start: null, canceled_at: new Date(1_701_000_000_000).toISOString() });
  });

  it.each([
    ["upsertStripeCustomers", "Customers"],
    ["upsertStripeProducts", "Products"],
    ["upsertStripeSubscriptions", "Subscriptions"],
  ] as const)("names the step when %s fails", async (method, label) => {
    const { billing, stripe } = build();
    billing[method].mockRejectedValue(new Error("boom"));
    await expect(importStripeCore(billing as never, stripe as never)).rejects.toThrow(`${label} import failed: boom`);
  });

  it("writes nothing when a fetch fails", async () => {
    const { billing, stripe } = build();
    stripe.fetchAllSubscriptions.mockRejectedValue(new Error("rate limited"));
    await expect(importStripeCore(billing as never, stripe as never)).rejects.toThrow("rate limited");
    expect(billing.upsertStripeSubscriptions).not.toHaveBeenCalled();
  });
});
