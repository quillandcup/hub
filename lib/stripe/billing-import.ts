import type Stripe from "stripe";
import type { BillingRepository } from "@/lib/data/billing";
import { invoicePaymentRefs, mapCharge, mapInvoice } from "@/lib/stripe/billing-map";

/**
 * Pull-based import of Stripe invoices and charges into Bronze (`bronze.stripe_invoices`, `stripe_charges`).
 * The first run, or `full`, reads the whole history. Later runs read what was created since the newest stored
 * one minus a safety window (a charge is refunded or disputed, an invoice paid, long after it was created), and
 * ask again about every stored invoice still open or draft, which is the kind that changes. Upsert on Stripe's
 * id, so a repeat run, or one that stops halfway, never duplicates a row; nothing is ever marked deleted,
 * because Stripe does not delete a finalized invoice or a charge.
 */

/** How far before the newest stored row an incremental import starts reading. */
export const SAFETY_WINDOW_DAYS = 45;
const DAY_SECONDS = 24 * 60 * 60;

/** The key can't read invoices or charges (a restricted key without that permission). */
export class StripeBillingPermissionError extends Error {
  // Stripe's own message quotes the (masked) key, so it is not repeated here.
  constructor() {
    super("The Stripe API key may not read invoices and charges. Give the restricted key read access to Invoices and Charges, then run the import again.");
    this.name = "StripeBillingPermissionError";
  }
}

/** What the import needs of the Stripe client (a test passes a stand-in). */
export interface StripeBillingSource {
  fetchInvoices(filter?: { createdFrom?: number; status?: Stripe.InvoiceListParams.Status }): Promise<Stripe.Invoice[]>;
  retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice | null>;
  fetchCharges(filter?: { createdFrom?: number }): Promise<Stripe.Charge[]>;
}

export interface StripeBillingResult {
  invoices: number;
  charges: number;
  /** Where the read started (an instant), or null for the whole history. */
  invoicesSince: string | null;
  chargesSince: string | null;
  full: boolean;
}

const idOf = (ref: string | { id: string } | null | undefined): string | null => (typeof ref === "string" ? ref : (ref?.id ?? null));

function isPermissionError(error: unknown): boolean {
  const e = error as { type?: string; statusCode?: number; code?: string } | null;
  return e?.type === "StripePermissionError" || e?.statusCode === 403 || e?.code === "secret_key_required";
}

function startOf(newest: string | null, full: boolean): number | undefined {
  if (full || !newest) return undefined;
  return Math.max(0, Math.floor(Date.parse(newest) / 1000) - SAFETY_WINDOW_DAYS * DAY_SECONDS);
}

const instant = (seconds: number | undefined) => (seconds === undefined ? null : new Date(seconds * 1000).toISOString());

export async function importStripeBilling(
  billing: BillingRepository,
  stripe: StripeBillingSource,
  { full = false }: { full?: boolean } = {}
): Promise<StripeBillingResult> {
  try {
    const [newestInvoice, newestCharge] = await Promise.all([billing.newestStripeInvoiceCreatedAt(), billing.newestStripeChargeCreatedAt()]);
    const invoicesFrom = startOf(newestInvoice, full);
    const chargesFrom = startOf(newestCharge, full);

    const invoices = new Map<string, Stripe.Invoice>();
    for (const invoice of await stripe.fetchInvoices({ createdFrom: invoicesFrom })) invoices.set(invoice.id, invoice);
    if (invoicesFrom !== undefined) {
      // Invoices that changed but were created before the window: whatever is open or draft now, and whatever
      // was open or draft when last seen (it may have been paid or voided since).
      for (const status of ["open", "draft"] as const) {
        for (const invoice of await stripe.fetchInvoices({ status })) invoices.set(invoice.id, invoice);
      }
      for (const id of await billing.stripeInvoiceIdsWithStatus(["open", "draft"])) {
        if (invoices.has(id)) continue;
        const invoice = await stripe.retrieveInvoice(id);
        if (invoice) invoices.set(id, invoice);
      }
    }

    const charges = await stripe.fetchCharges({ createdFrom: chargesFrom });

    // Link charges and invoices: an invoice names its payments by charge or payment intent.
    const invoiceByCharge = new Map<string, string>();
    const invoiceByIntent = new Map<string, string>();
    for (const invoice of invoices.values()) {
      const refs = invoicePaymentRefs(invoice);
      for (const id of refs.chargeIds) invoiceByCharge.set(id, invoice.id);
      for (const id of refs.paymentIntentIds) invoiceByIntent.set(id, invoice.id);
    }
    const known = new Map<string, string | null>();
    for (const row of await billing.stripeCharges(chargesFrom !== undefined ? { createdFrom: instant(chargesFrom)! } : {})) {
      known.set(row.stripe_charge_id, row.stripe_invoice_id);
    }
    const paidChargeOfInvoice = new Map<string, string>();
    const chargeRows = charges.map((charge) => {
      const intent = idOf(charge.payment_intent);
      const invoiceId = invoiceByCharge.get(charge.id) ?? (intent ? invoiceByIntent.get(intent) : undefined) ?? known.get(charge.id) ?? null;
      if (invoiceId && charge.paid) paidChargeOfInvoice.set(invoiceId, charge.id);
      return mapCharge(charge, invoiceId);
    });
    const invoiceRows = [...invoices.values()]
      .map((invoice) => mapInvoice(invoice, paidChargeOfInvoice.get(invoice.id) ?? null))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    await billing.upsertStripeInvoices(invoiceRows);
    await billing.upsertStripeCharges(chargeRows);

    return {
      invoices: invoiceRows.length,
      charges: chargeRows.length,
      invoicesSince: instant(invoicesFrom),
      chargesSince: instant(chargesFrom),
      full: invoicesFrom === undefined && chargesFrom === undefined,
    };
  } catch (error) {
    if (isPermissionError(error)) throw new StripeBillingPermissionError();
    throw error;
  }
}
