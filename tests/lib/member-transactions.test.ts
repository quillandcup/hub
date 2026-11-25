import { describe, it, expect } from "vitest";
import { buildTransactions, formatCents, stripeLookupEmails } from "@/lib/member-transactions";
import type { StripeChargeRow, StripeInvoiceRow } from "@/lib/data/billing";

const invoice = (o: Partial<StripeInvoiceRow>): StripeInvoiceRow => ({
  amount_due: 2500, amount_paid: 2500, amount_remaining: 0, attempt_count: 1, billing_reason: "subscription_cycle",
  collection_method: null, created_at_stripe: "2026-03-01T15:00:00Z", currency: "usd", data: null, description: null,
  due_date: null, id: "r", imported_at: "", next_payment_attempt: null, paid_at: null, paid_out_of_band: false,
  period_end: null, period_start: null, status: "paid", stripe_charge_id: null, stripe_customer_id: "cus_1",
  stripe_invoice_id: "in_1", stripe_product_id: null, stripe_subscription_id: null, updated_at: "", ...o,
});
const charge = (o: Partial<StripeChargeRow>): StripeChargeRow => ({
  amount: 2500, amount_refunded: 0, created_at_stripe: "2026-03-01T15:00:05Z", currency: "usd", data: null, description: null,
  disputed: false, failure_code: null, id: "r", imported_at: "", paid: true, refunded: false, status: "succeeded",
  stripe_charge_id: "ch_1", stripe_customer_id: "cus_1", stripe_invoice_id: null, updated_at: "", ...o,
});

describe("buildTransactions", () => {
  it("folds a charge into its invoice, joined from either side, and lists newest first", () => {
    const rows = buildTransactions(
      [invoice({ stripe_invoice_id: "in_1", stripe_charge_id: "ch_1" }), invoice({ stripe_invoice_id: "in_2", created_at_stripe: "2026-04-01T00:00:00Z" })],
      [charge({ stripe_charge_id: "ch_1" }), charge({ stripe_charge_id: "ch_2", stripe_invoice_id: "in_2", created_at_stripe: "2026-04-01T00:00:05Z" })]
    );
    expect(rows.map((r) => r.id)).toEqual(["in_2", "in_1"]);
    expect(rows.every((r) => r.kind === "invoice" && r.statusLabel === "Paid")).toBe(true);
  });

  it("shows a charge with no invoice as a payment", () => {
    const [row] = buildTransactions([], [charge({ description: "Retreat deposit", amount: 10000 })]);
    expect(row).toMatchObject({ kind: "charge", description: "Retreat deposit", amountCents: 10000, statusLabel: "Paid", dashboardUrl: "https://dashboard.stripe.com/payments/ch_1" });
  });

  it("reports refunds, disputes and failures from the charge, with the failure code and attempts", () => {
    const [refunded] = buildTransactions([invoice({ stripe_charge_id: "ch_1" })], [charge({ amount_refunded: 1000 })]);
    expect(refunded).toMatchObject({ statusLabel: "Partly refunded", refundedCents: 1000 });
    const [full] = buildTransactions([], [charge({ amount_refunded: 2500 })]);
    expect(full.statusLabel).toBe("Refunded");
    const [disputed] = buildTransactions([], [charge({ disputed: true })]);
    expect(disputed).toMatchObject({ statusLabel: "Disputed", tone: "bad" });
    const [failed] = buildTransactions(
      [invoice({ status: "open", amount_paid: 0, amount_due: 2500, attempt_count: 2 })],
      [charge({ stripe_invoice_id: "in_1", status: "failed", paid: false, failure_code: "card_declined" })]
    );
    expect(failed).toMatchObject({ statusLabel: "Failed", failureCode: "card_declined", attempts: 2, amountCents: 2500 });
  });

  it("describes an invoice from its reason when it has no description, and an unpaid one by what is due", () => {
    const [row] = buildTransactions([invoice({ status: "open", amount_paid: 0, amount_due: 900 })], []);
    expect(row).toMatchObject({ description: "subscription cycle", statusLabel: "Open", amountCents: 900 });
  });
});

describe("formatCents", () => {
  it("formats money and survives an unknown currency", () => {
    expect(formatCents(1250, "usd")).toBe("$12.50");
    expect(formatCents(1250, null)).toBe("$12.50");
    expect(formatCents(1250, "zz")).toContain("12.50");
  });
});

describe("stripeLookupEmails", () => {
  it("covers the primary and alias emails, as written and lowercased, without blanks or repeats", () => {
    expect(stripeLookupEmails(["Ada@Example.test", "old@example.test", " ", null, undefined, "old@example.test"])).toEqual([
      "Ada@Example.test", "ada@example.test", "old@example.test",
    ]);
  });
});
