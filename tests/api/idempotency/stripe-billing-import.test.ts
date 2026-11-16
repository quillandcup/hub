import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import type { Db } from "@/lib/data/db";
import { SupabaseBillingRepository } from "@/lib/data/billing";
import { importStripeBilling, type StripeBillingSource } from "@/lib/stripe/billing-import";
import { getTestSupabaseAdminClient } from "../../helpers/supabase";

/**
 * The Stripe invoices and charges import must be idempotent: the nightly run and the manual import read
 * overlapping windows, and a run that stops halfway is simply run again. Rows are keyed by Stripe's id, so
 * a second import creates no duplicates and a changed invoice or charge updates in place.
 */
describe("Stripe invoices and charges import idempotency", () => {
  const supabase = getTestSupabaseAdminClient();
  const db = supabase as unknown as Db;
  const billing = new SupabaseBillingRepository(db);
  const run = `${Date.now()}`;
  const customer = `cus_idem${run}`;
  const invoiceId = (n: number) => `in_idem${run}x${n}`;
  const chargeId = (n: number) => `ch_idem${run}x${n}`;
  // Far in the future, so the incremental window of these rows is the newest in the table whatever else is stored.
  const created = Date.parse("2097-03-01T00:00:00Z") / 1000;

  const invoice = (n: number, over: Record<string, unknown> = {}): Stripe.Invoice =>
    ({
      id: invoiceId(n),
      customer,
      status: "paid",
      billing_reason: "subscription_cycle",
      collection_method: "charge_automatically",
      currency: "usd",
      amount_due: 2500,
      amount_paid: 2500,
      amount_remaining: 0,
      attempt_count: 1,
      created: created + n * 86400,
      period_start: created + n * 86400,
      period_end: created + (n + 30) * 86400,
      due_date: null,
      next_payment_attempt: null,
      description: null,
      status_transitions: { paid_at: created + n * 86400 + 60 },
      parent: null,
      lines: { data: [] },
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: `pi_idem${run}x${n}` } }] },
      ...over,
    }) as unknown as Stripe.Invoice;

  const charge = (n: number, over: Record<string, unknown> = {}): Stripe.Charge =>
    ({
      id: chargeId(n),
      customer,
      amount: 2500,
      amount_refunded: 0,
      currency: "usd",
      status: "succeeded",
      paid: true,
      refunded: false,
      disputed: false,
      created: created + n * 86400 + 30,
      failure_code: null,
      description: null,
      payment_intent: `pi_idem${run}x${n}`,
      ...over,
    }) as unknown as Stripe.Charge;

  const source = (data: { invoices: Stripe.Invoice[]; charges: Stripe.Charge[] }): StripeBillingSource => ({
    fetchInvoices: async (filter = {}) =>
      data.invoices.filter((i) => (filter.status ? i.status === filter.status : true) && (filter.createdFrom === undefined || i.created >= filter.createdFrom)),
    retrieveInvoice: async (id) => data.invoices.find((i) => i.id === id) ?? null,
    fetchCharges: async (filter = {}) => data.charges.filter((c) => filter.createdFrom === undefined || c.created >= filter.createdFrom),
  });

  const stored = async () => ({
    invoices: await billing.stripeInvoices({ customerIds: [customer] }),
    charges: await billing.stripeCharges({ customerIds: [customer] }),
  });

  const clear = async () => {
    await supabase.schema("bronze").from("stripe_invoices").delete().eq("stripe_customer_id", customer);
    await supabase.schema("bronze").from("stripe_charges").delete().eq("stripe_customer_id", customer);
  };

  beforeAll(clear);
  afterAll(clear);

  it("creates the rows on the first import, links them, and creates no duplicates on a second", async () => {
    const data = { invoices: [invoice(1), invoice(2, { status: "open", amount_paid: 0, amount_remaining: 2500, status_transitions: {} })], charges: [charge(1)] };
    await importStripeBilling(billing, source(data), { full: true });
    const first = await stored();
    expect(first.invoices.map((i) => i.stripe_invoice_id)).toEqual([invoiceId(1), invoiceId(2)]);
    expect(first.charges.map((c) => c.stripe_charge_id)).toEqual([chargeId(1)]);
    expect(first.invoices[0]).toMatchObject({ amount_paid: 2500, stripe_charge_id: chargeId(1) });
    expect(first.charges[0].stripe_invoice_id).toBe(invoiceId(1));

    await importStripeBilling(billing, source(data));
    await importStripeBilling(billing, source(data), { full: true });
    const again = await stored();
    expect(again.invoices).toHaveLength(2);
    expect(again.charges).toHaveLength(1);
  });

  it("updates an invoice that was open when last seen and a charge that was refunded since", async () => {
    const data = {
      invoices: [invoice(1), invoice(2, { amount_paid: 2500, amount_remaining: 0, status_transitions: { paid_at: created + 3 * 86400 } })],
      charges: [charge(1, { refunded: true, amount_refunded: 2500 }), charge(2)],
    };
    await importStripeBilling(billing, source(data));
    await importStripeBilling(billing, source(data));
    const after = await stored();
    expect(after.invoices).toHaveLength(2);
    expect(after.invoices[1]).toMatchObject({ stripe_invoice_id: invoiceId(2), status: "paid", amount_paid: 2500, stripe_charge_id: chargeId(2) });
    expect(after.charges).toHaveLength(2);
    expect(after.charges[0]).toMatchObject({ stripe_charge_id: chargeId(1), refunded: true, amount_refunded: 2500, stripe_invoice_id: invoiceId(1) });
  });
});
