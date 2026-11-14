import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBillingRepository } from "@/lib/data/billing";
import { invoicePaymentRefs, mapCharge, mapInvoice } from "@/lib/stripe/billing-map";
import { importStripeBilling, SAFETY_WINDOW_DAYS, StripeBillingPermissionError, type StripeBillingSource } from "@/lib/stripe/billing-import";

const sec = (iso: string) => Date.parse(iso) / 1000;

const invoice = (over: Record<string, unknown> = {}): Stripe.Invoice =>
  ({
    id: "in_AAAA1",
    customer: "cus_AAAA1",
    status: "paid",
    billing_reason: "subscription_cycle",
    collection_method: "charge_automatically",
    currency: "usd",
    amount_due: 2500,
    amount_paid: 2500,
    amount_remaining: 0,
    attempt_count: 1,
    created: sec("2026-09-01T00:00:00Z"),
    period_start: sec("2026-09-01T00:00:00Z"),
    period_end: sec("2026-10-01T00:00:00Z"),
    due_date: null,
    next_payment_attempt: null,
    description: null,
    status_transitions: { paid_at: sec("2026-09-01T00:05:00Z") },
    parent: { subscription_details: { subscription: "sub_AAAA1" } },
    lines: { data: [{ pricing: { price_details: { price: "price_AAAA1", product: "prod_AAAA1" } } }] },
    payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_AAAA1" } }] },
    // Fields that must never reach the row.
    customer_email: "ada@example.test",
    customer_name: "Ada Example",
    hosted_invoice_url: "https://example.test/invoice",
    ...over,
  }) as unknown as Stripe.Invoice;

const charge = (over: Record<string, unknown> = {}): Stripe.Charge =>
  ({
    id: "ch_AAAA1",
    customer: "cus_AAAA1",
    amount: 2500,
    amount_refunded: 0,
    currency: "usd",
    status: "succeeded",
    paid: true,
    refunded: false,
    disputed: false,
    created: sec("2026-09-01T00:01:00Z"),
    failure_code: null,
    failure_message: "Your card was declined.",
    description: "Subscription update",
    payment_intent: "pi_AAAA1",
    payment_method_details: { card: { last4: "4242" } },
    receipt_url: "https://example.test/receipt",
    ...over,
  }) as unknown as Stripe.Charge;

describe("mapInvoice", () => {
  it("keeps cents, instants, the subscription, the product and the paid transition", () => {
    expect(mapInvoice(invoice())).toEqual({
      stripe_invoice_id: "in_AAAA1",
      stripe_customer_id: "cus_AAAA1",
      stripe_subscription_id: "sub_AAAA1",
      status: "paid",
      billing_reason: "subscription_cycle",
      collection_method: "charge_automatically",
      currency: "usd",
      amount_due: 2500,
      amount_paid: 2500,
      amount_remaining: 0,
      attempt_count: 1,
      created_at_stripe: "2026-09-01T00:00:00.000Z",
      period_start: "2026-09-01T00:00:00.000Z",
      period_end: "2026-10-01T00:00:00.000Z",
      due_date: null,
      paid_at: "2026-09-01T00:05:00.000Z",
      next_payment_attempt: null,
      stripe_charge_id: null,
      stripe_product_id: "prod_AAAA1",
      description: null,
      paid_out_of_band: false,
    });
  });

  it("stores no customer details, links or raw record", () => {
    const row = JSON.stringify(mapInvoice(invoice()));
    expect(row).not.toContain("example.test");
    expect(row).not.toContain("Ada");
  });

  it("copes with the optional parts missing and takes an expanded customer", () => {
    const row = mapInvoice(
      invoice({
        customer: { id: "cus_AAAA2" },
        parent: null,
        lines: { data: [] },
        payments: undefined,
        status: "open",
        status_transitions: {},
        next_payment_attempt: sec("2026-09-05T00:00:00Z"),
        due_date: sec("2026-09-15T00:00:00Z"),
        amount_paid_off_stripe: 500,
        amount_paid: undefined,
      })
    )!;
    expect(row).toMatchObject({
      stripe_customer_id: "cus_AAAA2",
      stripe_subscription_id: null,
      stripe_product_id: null,
      stripe_charge_id: null,
      paid_at: null,
      amount_paid: 0,
      next_payment_attempt: "2026-09-05T00:00:00.000Z",
      due_date: "2026-09-15T00:00:00.000Z",
      paid_out_of_band: true,
    });
  });

  it("skips an invoice with no customer or no status", () => {
    expect(mapInvoice(invoice({ customer: null }))).toBeNull();
    expect(mapInvoice(invoice({ status: null }))).toBeNull();
  });

  it("names the charge a payment points at, and the one the caller found", () => {
    const withCharge = invoice({ payments: { data: [{ payment: { type: "charge", charge: "ch_AAAA9" } }] } });
    expect(invoicePaymentRefs(withCharge)).toEqual({ chargeIds: ["ch_AAAA9"], paymentIntentIds: [] });
    expect(invoicePaymentRefs(invoice())).toEqual({ chargeIds: [], paymentIntentIds: ["pi_AAAA1"] });
    expect(mapInvoice(withCharge)!.stripe_charge_id).toBe("ch_AAAA9");
    expect(mapInvoice(invoice(), "ch_AAAA2")!.stripe_charge_id).toBe("ch_AAAA2");
  });
});

describe("mapCharge", () => {
  it("keeps the failure code, not the message, and no card details", () => {
    const row = mapCharge(charge({ status: "failed", paid: false, failure_code: "card_declined" }), "in_AAAA1");
    expect(row).toEqual({
      stripe_charge_id: "ch_AAAA1",
      stripe_customer_id: "cus_AAAA1",
      stripe_invoice_id: "in_AAAA1",
      amount: 2500,
      amount_refunded: 0,
      currency: "usd",
      status: "failed",
      paid: false,
      refunded: false,
      disputed: false,
      created_at_stripe: "2026-09-01T00:01:00.000Z",
      failure_code: "card_declined",
      description: "Subscription update",
    });
    expect(JSON.stringify(row)).not.toContain("declined.");
    expect(JSON.stringify(row)).not.toContain("4242");
  });

  it("handles a charge with no customer and an expanded one", () => {
    expect(mapCharge(charge({ customer: null })).stripe_customer_id).toBeNull();
    expect(mapCharge(charge({ customer: { id: "cus_AAAA3" } })).stripe_customer_id).toBe("cus_AAAA3");
    expect(mapCharge(charge()).stripe_invoice_id).toBeNull();
  });
});

function source(data: { invoices?: Stripe.Invoice[]; charges?: Stripe.Charge[] }) {
  const fetchInvoices = vi.fn(async (filter: { createdFrom?: number; status?: string } = {}) =>
    (data.invoices ?? []).filter((i) => (filter.status ? i.status === filter.status : true) && (filter.createdFrom === undefined || i.created >= filter.createdFrom))
  );
  const retrieveInvoice = vi.fn(async (id: string) => (data.invoices ?? []).find((i) => i.id === id) ?? null);
  const fetchCharges = vi.fn(async (filter: { createdFrom?: number } = {}) =>
    (data.charges ?? []).filter((c) => filter.createdFrom === undefined || c.created >= filter.createdFrom)
  );
  return { fetchInvoices, retrieveInvoice, fetchCharges } satisfies StripeBillingSource;
}

describe("importStripeBilling", () => {
  const setup = () => {
    const dataset = new InMemoryDataset();
    return { dataset, billing: new InMemoryBillingRepository(dataset) };
  };

  it("imports the whole history the first time and links the charge and the invoice both ways", async () => {
    const { billing, dataset } = setup();
    const result = await importStripeBilling(billing, source({ invoices: [invoice()], charges: [charge()] }));
    expect(result).toMatchObject({ invoices: 1, charges: 1, invoicesSince: null, chargesSince: null, full: true });
    expect(dataset.stripeInvoices[0]).toMatchObject({ stripe_invoice_id: "in_AAAA1", stripe_charge_id: "ch_AAAA1" });
    expect(dataset.stripeCharges[0]).toMatchObject({ stripe_charge_id: "ch_AAAA1", stripe_invoice_id: "in_AAAA1" });
  });

  it("is idempotent: a second run creates no duplicates and a changed invoice is updated", async () => {
    const { billing, dataset } = setup();
    const data = { invoices: [invoice({ status: "open", amount_paid: 0, amount_remaining: 2500, status_transitions: {} })], charges: [] as Stripe.Charge[] };
    await importStripeBilling(billing, source(data));
    await importStripeBilling(billing, source(data));
    await importStripeBilling(billing, source(data), { full: true });
    expect(dataset.stripeInvoices).toHaveLength(1);
    expect(dataset.stripeInvoices[0]).toMatchObject({ status: "open", amount_remaining: 2500 });

    data.invoices = [invoice()];
    data.charges = [charge()];
    await importStripeBilling(billing, source(data));
    await importStripeBilling(billing, source(data));
    expect(dataset.stripeInvoices).toHaveLength(1);
    expect(dataset.stripeInvoices[0]).toMatchObject({ status: "paid", amount_paid: 2500, stripe_charge_id: "ch_AAAA1" });
    expect(dataset.stripeCharges).toHaveLength(1);
  });

  it("reads only since the newest stored row minus the window, and asks again about open and draft invoices", async () => {
    const { billing, dataset } = setup();
    const old = invoice({ id: "in_OLD1", status: "open", created: sec("2026-01-01T00:00:00Z"), amount_paid: 0, status_transitions: {} });
    const newest = invoice({ id: "in_NEW1", created: sec("2026-09-01T00:00:00Z") });
    await importStripeBilling(billing, source({ invoices: [old, newest] }));

    // The old invoice is paid in Stripe now, long after it was created.
    const paidNow = invoice({ id: "in_OLD1", status: "paid", created: sec("2026-01-01T00:00:00Z") });
    const src = source({ invoices: [paidNow, newest] });
    const result = await importStripeBilling(billing, src);

    const since = sec("2026-09-01T00:00:00Z") - SAFETY_WINDOW_DAYS * 86400;
    expect(src.fetchInvoices).toHaveBeenCalledWith({ createdFrom: since });
    expect(src.fetchInvoices).toHaveBeenCalledWith({ status: "open" });
    expect(src.fetchInvoices).toHaveBeenCalledWith({ status: "draft" });
    expect(src.retrieveInvoice).toHaveBeenCalledWith("in_OLD1");
    expect(result.full).toBe(false);
    expect(dataset.stripeInvoices.find((i) => i.stripe_invoice_id === "in_OLD1")).toMatchObject({ status: "paid" });
    expect(dataset.stripeInvoices).toHaveLength(2);
  });

  it("keeps a stored charge's invoice when a later run cannot link it, and fills an invoice's charge from a paid charge", async () => {
    const { billing, dataset } = setup();
    const noPayments = invoice({ payments: { data: [] } });
    await importStripeBilling(billing, source({ invoices: [noPayments], charges: [charge({ payment_intent: "pi_OTHER" })] }));
    expect(dataset.stripeCharges[0].stripe_invoice_id).toBeNull();

    // Linked once the invoice names the payment, and still linked when a later run sees only the charge.
    await importStripeBilling(billing, source({ invoices: [invoice({ payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_OTHER" } }] } })], charges: [charge({ payment_intent: "pi_OTHER" })] }));
    expect(dataset.stripeCharges[0].stripe_invoice_id).toBe("in_AAAA1");
    await importStripeBilling(billing, source({ invoices: [], charges: [charge({ payment_intent: "pi_OTHER", amount_refunded: 2500, refunded: true })] }));
    expect(dataset.stripeCharges[0]).toMatchObject({ stripe_invoice_id: "in_AAAA1", refunded: true, amount_refunded: 2500 });
  });

  it("skips an invoice that was deleted at Stripe since it was seen open", async () => {
    const { billing, dataset } = setup();
    await importStripeBilling(billing, source({ invoices: [invoice({ status: "draft", status_transitions: {} }), invoice({ id: "in_NEW1", created: sec("2026-09-02T00:00:00Z") })] }));
    const src = source({ invoices: [invoice({ id: "in_NEW1", created: sec("2026-09-02T00:00:00Z") })] });
    await importStripeBilling(billing, src);
    expect(src.retrieveInvoice).toHaveBeenCalledWith("in_AAAA1");
    expect(dataset.stripeInvoices).toHaveLength(2);
  });

  it("says plainly when the key may not read invoices, without quoting Stripe's message", async () => {
    const { billing } = setup();
    const denied = Object.assign(new Error("The provided key 'rk_live_****abcd' does not have the required permissions"), { type: "StripePermissionError", statusCode: 403 });
    const src = { ...source({}), fetchInvoices: vi.fn(async () => Promise.reject(denied)) };
    const error = await importStripeBilling(billing, src).catch((e) => e);
    expect(error).toBeInstanceOf(StripeBillingPermissionError);
    expect(error.message).toContain("read access to Invoices and Charges");
    expect(error.message).not.toContain("rk_live");
  });

  it("lets any other failure through unchanged", async () => {
    const { billing } = setup();
    const src = { ...source({}), fetchCharges: vi.fn(async () => Promise.reject(new Error("boom"))) };
    await expect(importStripeBilling(billing, src)).rejects.toThrow("boom");
  });
});
