import type { StripeChargeRow, StripeInvoiceRow } from "@/lib/data/billing";
import { ORG_TIMEZONE } from "@/lib/config";
import { formatDateTime } from "@/lib/formatters";

/** What a transaction is, in the words staff use. */
export type TransactionKind = "invoice" | "charge";

/** How a transaction ended up, as a staff-facing label with a tone for the badge. */
export type TransactionTone = "good" | "warn" | "bad" | "neutral";

export interface TransactionRow {
  /** The Stripe id of the invoice, or of the charge when there is no invoice (a one-off payment). */
  id: string;
  kind: TransactionKind;
  /** When Stripe created it (ISO instant). */
  createdAt: string;
  /** The date as staff read it, in the org's zone. */
  createdLabel: string;
  description: string;
  /** What was billed or taken, in cents. */
  amountCents: number;
  /** What was handed back, in cents (0 when nothing). */
  refundedCents: number;
  currency: string;
  statusLabel: string;
  tone: TransactionTone;
  /** Why a payment failed (Stripe's code), when it did. */
  failureCode: string | null;
  /** More than one try was needed (a retried invoice). */
  attempts: number;
  /** The Stripe id to open in the dashboard. */
  dashboardUrl: string;
}

const DASHBOARD = "https://dashboard.stripe.com";

/** Where Stripe shows an invoice. */
export const stripeInvoiceUrl = (id: string) => `${DASHBOARD}/invoices/${id}`;
/** Where Stripe shows a payment (a charge). */
export const stripeChargeUrl = (id: string) => `${DASHBOARD}/payments/${id}`;

/** "$12.50" from 1250 cents in `currency` (Stripe sends it lowercase, and sometimes not at all). */
export function formatCents(cents: number, currency: string | null | undefined): string {
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

const INVOICE_STATUS: Record<string, [string, TransactionTone]> = {
  paid: ["Paid", "good"],
  open: ["Open", "warn"],
  draft: ["Draft", "neutral"],
  void: ["Void", "neutral"],
  uncollectible: ["Uncollectible", "bad"],
};

function chargeOutcome(charge: StripeChargeRow): [string, TransactionTone] {
  if (charge.disputed) return ["Disputed", "bad"];
  if (charge.status === "failed") return ["Failed", "bad"];
  if (charge.status === "pending") return ["Pending", "warn"];
  if (charge.amount_refunded > 0 && charge.amount_refunded >= charge.amount) return ["Refunded", "neutral"];
  if (charge.amount_refunded > 0) return ["Partly refunded", "warn"];
  if (charge.paid || charge.status === "succeeded") return ["Paid", "good"];
  return [charge.status, "neutral"];
}

/**
 * A member's payments from the Stripe copy in Bronze, newest first: one row per invoice (with the charges
 * that tried to collect it folded in), and one per charge that belongs to no invoice. Invoices and charges
 * are joined both ways, because the import fills `stripe_charge_id` on one side or `stripe_invoice_id` on
 * the other depending on which it saw first.
 */
export function buildTransactions(invoices: StripeInvoiceRow[], charges: StripeChargeRow[]): TransactionRow[] {
  const chargeById = new Map(charges.map((c) => [c.stripe_charge_id, c]));
  const chargesByInvoice = new Map<string, StripeChargeRow[]>();
  const attach = (invoiceId: string, charge: StripeChargeRow) => {
    const list = chargesByInvoice.get(invoiceId) ?? [];
    if (!list.some((c) => c.stripe_charge_id === charge.stripe_charge_id)) list.push(charge);
    chargesByInvoice.set(invoiceId, list);
  };
  const invoiceIds = new Set(invoices.map((i) => i.stripe_invoice_id));
  for (const charge of charges) if (charge.stripe_invoice_id && invoiceIds.has(charge.stripe_invoice_id)) attach(charge.stripe_invoice_id, charge);
  for (const invoice of invoices) {
    const named = invoice.stripe_charge_id ? chargeById.get(invoice.stripe_charge_id) : undefined;
    if (named) attach(invoice.stripe_invoice_id, named);
  }
  const claimed = new Set([...chargesByInvoice.values()].flat().map((c) => c.stripe_charge_id));

  const rows: TransactionRow[] = [];

  for (const invoice of invoices) {
    const tries = (chargesByInvoice.get(invoice.stripe_invoice_id) ?? []).slice().sort((a, b) => a.created_at_stripe.localeCompare(b.created_at_stripe));
    const last = tries[tries.length - 1];
    const refunded = tries.reduce((sum, c) => sum + c.amount_refunded, 0);
    const [invoiceLabel, invoiceTone] = INVOICE_STATUS[invoice.status] ?? [invoice.status, "neutral" as TransactionTone];
    // A charge's outcome says more than "paid" or "open" when it went wrong or was handed back.
    const [chargeLabel, chargeTone] = last ? chargeOutcome(last) : [invoiceLabel, invoiceTone];
    const chargeSpeaks = last && (last.disputed || last.status === "failed" || refunded > 0) && invoice.status !== "void";
    const failedCharge = tries.slice().reverse().find((c) => c.failure_code);
    rows.push({
      id: invoice.stripe_invoice_id,
      kind: "invoice",
      createdAt: invoice.created_at_stripe,
      createdLabel: formatDateTime(invoice.created_at_stripe, ORG_TIMEZONE),
      description: invoice.description?.trim() || (invoice.billing_reason ? invoice.billing_reason.replace(/_/g, " ") : "Invoice"),
      amountCents: invoice.status === "paid" ? invoice.amount_paid : invoice.amount_due,
      refundedCents: refunded,
      currency: invoice.currency ?? "usd",
      statusLabel: chargeSpeaks ? chargeLabel : invoiceLabel,
      tone: chargeSpeaks ? chargeTone : invoiceTone,
      failureCode: invoice.status === "paid" ? null : (failedCharge?.failure_code ?? null),
      attempts: Math.max(invoice.attempt_count, tries.length),
      dashboardUrl: stripeInvoiceUrl(invoice.stripe_invoice_id),
    });
  }

  for (const charge of charges) {
    if (claimed.has(charge.stripe_charge_id)) continue;
    const [statusLabel, tone] = chargeOutcome(charge);
    rows.push({
      id: charge.stripe_charge_id,
      kind: "charge",
      createdAt: charge.created_at_stripe,
      createdLabel: formatDateTime(charge.created_at_stripe, ORG_TIMEZONE),
      description: charge.description?.trim() || "Payment",
      amountCents: charge.amount,
      refundedCents: charge.amount_refunded,
      currency: charge.currency ?? "usd",
      statusLabel,
      tone,
      failureCode: charge.failure_code,
      attempts: 1,
      dashboardUrl: stripeChargeUrl(charge.stripe_charge_id),
    });
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
