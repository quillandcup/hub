/**
 * Why staff acknowledge a billing reconciliation row: a fixed set, so the reason can be filtered and counted, with the
 * words used in the form, the table and the Activity Log. No imports, so anything may read it (the Activity Log's
 * sentences do). The rest of the acknowledgement rules are in `src/lib/billing-acknowledgements.ts`.
 */

export const ACK_REASONS = ["gift", "comp", "forfeited", "paid_elsewhere", "other"] as const;
export type AckReason = (typeof ACK_REASONS)[number];

export const ACK_REASON_LABELS: Record<AckReason, string> = {
  gift: "Gift",
  comp: "Complimentary",
  forfeited: "Forfeited",
  paid_elsewhere: "Paid elsewhere",
  other: "Other",
};

/** One line under each reason in the form. */
export const ACK_REASON_HINTS: Record<AckReason, string> = {
  gift: "A month or a purchase we gave.",
  comp: "Complimentary: staff, a volunteer, or promised.",
  forfeited: "Payment kept and not refundable, such as a deposit after a cancellation.",
  paid_elsewhere: "Paid outside Stripe: cash, PayPal or another processor.",
  other: "Anything else. A note is required.",
};

/** The phrase the Activity Log uses: "acknowledged ... billing row as ...". */
export const ACK_REASON_PHRASES: Record<AckReason, string> = {
  gift: "a gift",
  comp: "complimentary",
  forfeited: "forfeited",
  paid_elsewhere: "paid outside Stripe",
  other: "something else",
};

export const ACK_NOTE_MAX = 500;

export const isAckReason = (value: unknown): value is AckReason => typeof value === "string" && (ACK_REASONS as readonly string[]).includes(value);
