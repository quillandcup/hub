import type Stripe from "stripe";
import type { NewStripeCharge, NewStripeInvoice } from "@/lib/data/billing";

/**
 * Stripe invoices and charges as Bronze rows (`bronze.stripe_invoices`, `stripe_charges`). Pure: no
 * request, no database. Only what the Hub needs is kept: amounts in cents, dates, statuses and ids. The raw
 * record is not stored, and neither are card details, the billing address, receipt links, the customer's
 * email or name, or the free-text failure message (the machine code is).
 */

const iso = (seconds: number | null | undefined): string | null => (typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null);

const idOf = (ref: string | { id: string } | null | undefined): string | null => (typeof ref === "string" ? ref : (ref?.id ?? null));

/** What links an invoice to the charges that paid (or failed to pay) it: Stripe names a payment by its charge or, more often, its payment intent. */
export interface InvoicePaymentRefs {
  chargeIds: string[];
  paymentIntentIds: string[];
}

export function invoicePaymentRefs(invoice: Stripe.Invoice): InvoicePaymentRefs {
  const refs: InvoicePaymentRefs = { chargeIds: [], paymentIntentIds: [] };
  for (const entry of invoice.payments?.data ?? []) {
    const charge = idOf(entry.payment.charge);
    const intent = idOf(entry.payment.payment_intent);
    if (charge) refs.chargeIds.push(charge);
    if (intent) refs.paymentIntentIds.push(intent);
  }
  return refs;
}

/**
 * One invoice as a row. `stripeChargeId` is the charge that collected it when the caller knows it (a payment
 * that names a charge, or a charge whose payment intent the invoice names).
 */
export function mapInvoice(invoice: Stripe.Invoice, stripeChargeId: string | null = null): NewStripeInvoice | null {
  const customer = idOf(invoice.customer);
  // Stripe's list never answers a deleted draft or an invoice without a customer; a row needs both.
  if (!customer || !invoice.status) return null;
  const subscription = invoice.parent?.subscription_details?.subscription;
  const price = invoice.lines?.data?.[0]?.pricing?.price_details;
  return {
    stripe_invoice_id: invoice.id,
    stripe_customer_id: customer,
    stripe_subscription_id: idOf(subscription),
    status: invoice.status,
    billing_reason: invoice.billing_reason ?? null,
    collection_method: invoice.collection_method ?? null,
    currency: invoice.currency ?? null,
    amount_due: invoice.amount_due ?? 0,
    amount_paid: invoice.amount_paid ?? 0,
    amount_remaining: invoice.amount_remaining ?? 0,
    attempt_count: invoice.attempt_count ?? 0,
    created_at_stripe: new Date(invoice.created * 1000).toISOString(),
    period_start: iso(invoice.period_start),
    period_end: iso(invoice.period_end),
    due_date: iso(invoice.due_date),
    paid_at: iso(invoice.status_transitions?.paid_at),
    next_payment_attempt: iso(invoice.next_payment_attempt),
    stripe_charge_id: stripeChargeId ?? invoicePaymentRefs(invoice).chargeIds[0] ?? null,
    stripe_product_id: price?.product ?? null,
    description: invoice.description ?? null,
    paid_out_of_band: (invoice.amount_paid_off_stripe ?? 0) > 0,
  };
}

/** One charge as a row. `stripeInvoiceId` is the invoice it belongs to when the caller knows it. */
export function mapCharge(charge: Stripe.Charge, stripeInvoiceId: string | null = null): NewStripeCharge {
  return {
    stripe_charge_id: charge.id,
    stripe_customer_id: idOf(charge.customer),
    stripe_invoice_id: stripeInvoiceId,
    amount: charge.amount ?? 0,
    amount_refunded: charge.amount_refunded ?? 0,
    currency: charge.currency ?? null,
    status: charge.status,
    paid: charge.paid ?? false,
    refunded: charge.refunded ?? false,
    disputed: charge.disputed ?? false,
    created_at_stripe: new Date(charge.created * 1000).toISOString(),
    failure_code: charge.failure_code ?? null,
    description: charge.description ?? null,
  };
}
