import { ORG_TIMEZONE } from "@/lib/config";

/**
 * Billing reconciliation: for each thing a member pays for (a purchase), the dates the Hub expects a
 * payment on, lined up against what Stripe actually did, with a status per date. Pure: plain inputs in,
 * schedules out, no database. The loader (`src/lib/billing-reconciliation-loader.ts`) reads the inputs,
 * the page shows the schedules. Docs: docs/architecture/BILLING_RECONCILIATION.md.
 *
 * Today only the membership purchase has a schedule. To add a purchase type (events, programs, courses):
 * add its builder next to `buildMembershipSchedule`, return `PurchaseSchedule`s of its own `purchaseType`,
 * and call it in `buildSchedules`. The statuses and the page need no change.
 *
 * All days are Eastern days (`ORG_TIMEZONE`), never the server's. A "month" is the Eastern calendar month
 * of the billing day (Stripe creates a subscription's invoice on the billing day).
 *
 * Boundary rule for hiatuses and programs that include membership: a billing day strictly inside the
 * window is not expected (a payment there is flagged); the window's first and last day are neither
 * expected nor flagged (the first is the cycle that started it, the last the one that resumes billing),
 * so neither edge is ever reported.
 */

const PURCHASE_TYPES = ["membership", "program", "course", "event"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];

export const ROW_STATUSES = ["paid", "refunded", "missed", "failed", "open", "charged_when_not_expected", "unexpected", "not_expected", "hub_stripe_disagree", "paused_short", "hiatus_confirmed", "hiatus_mismatch", "unrecorded_gap", "gap_short"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  paid: "Paid",
  refunded: "Refunded",
  missed: "Missed",
  failed: "Failed",
  open: "Open",
  charged_when_not_expected: "Charged when it should not be",
  unexpected: "Unexpected payment",
  not_expected: "Not expected",
  hub_stripe_disagree: "Hub and Stripe disagree",
  paused_short: "Paused, short",
  hiatus_confirmed: "Hiatus confirmed by billing",
  hiatus_mismatch: "Hiatus and billing gap differ",
  unrecorded_gap: "Unrecorded gap",
  gap_short: "Short gap (possible gift)",
};

/** Why a row is what it is, for filtering: a hiatus or a program that includes membership, or a billing day soon after a hiatus ended. */
export type RowCause = "hiatus" | "program" | "pause" | "after_hiatus" | "gap" | "hiatus_billing_day" | null;

export interface ScheduleTransaction {
  invoiceId: string;
  chargeIds: string[];
  /** The Eastern day the invoice was created. */
  day: string;
  /** What was billed, in cents. */
  billedCents: number;
  /** What was kept after refunds, in cents (0 unless the invoice is paid). */
  keptCents: number;
  refundedCents: number;
  invoiceStatus: string;
  failureCodes: string[];
  attempts: number;
}

export interface ScheduleRow {
  /** Stable: member + purchase type + month (+ a counter when a month has several rows). A later acknowledgement can be keyed by it. */
  key: string;
  /** The billing day the Hub expected a payment on, or null for a payment with no expected day. */
  expectedDate: string | null;
  /** What was expected in cents (the last known price), or null when none is known. */
  expectedAmountCents: number | null;
  /** Eastern billing month, YYYY-MM. */
  month: string;
  status: RowStatus;
  /** A short sentence for staff. */
  reason: string;
  /** Staff should look at this row. */
  needsAttention: boolean;
  cause: RowCause;
  transactions: ScheduleTransaction[];
  currency: string;
}

export interface PurchaseSchedule {
  purchaseType: PurchaseType;
  label: string;
  memberId: string;
  /** First and last day the purchase runs (the subscription), or null. */
  start: string | null;
  end: string | null;
  /** Oldest first. */
  rows: ScheduleRow[];
  /**
   * What the schedule leaves out and why (invoices before the range it covers, draft or void ones that billed
   * nothing, invoices of other products), so it never shows fewer transactions than the flat list without saying so.
   */
  notes: string[];
}

export interface ReconMember {
  id: string;
  /** The Hub's status: "active", "on_hiatus", "cancelled", ... */
  status: string;
  /** Every Stripe customer that is this member (the linked one, plus any found under their other emails). */
  stripeCustomerIds: string[];
}

export interface ReconInvoice {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripeProductId: string | null;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string | null;
  /** ISO instant. */
  createdAt: string;
  attemptCount: number;
  stripeChargeId: string | null;
}

export interface ReconCharge {
  stripeChargeId: string;
  stripeCustomerId: string | null;
  stripeInvoiceId: string | null;
  status: string;
  amountCents: number;
  amountRefundedCents: number;
  failureCode: string | null;
}

export interface ReconSubscription {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  /** ISO instants. */
  createdAt: string;
  canceledAt: string | null;
  /** The instant the billing day is counted from (Stripe's `billing_cycle_anchor`), or null when unknown. */
  billingAnchor: string | null;
  /** The subscription's collection is paused in Stripe (a draft invoice instead of a charge is expected). */
  paused: boolean;
  /** `pause_collection.behavior` and `.resumes_at` (an ISO instant): when set, billing resumes on that day; when not, the pause is indefinite. */
  pauseBehavior?: string | null;
  pauseResumesAt?: string | null;
}

/** A hiatus or a program cohort: dates as YYYY-MM-DD; a null end means it has not ended. */
export interface ReconWindow {
  memberId: string;
  startDate: string;
  endDate: string | null;
}

export interface ReconInput {
  /** Today as an Eastern day (YYYY-MM-DD). */
  today: string;
  members: ReconMember[];
  /** Stripe product ids that are the membership. Invoices for anything else are not looked at here. */
  membershipProductIds: ReadonlySet<string>;
  invoices: ReconInvoice[];
  charges: ReconCharge[];
  subscriptions: ReconSubscription[];
  hiatuses: ReconWindow[];
  /** Cohorts of programs that include membership. */
  programWindows: ReconWindow[];
  /** How many months back the schedule goes: default 12, `null` for the member's whole billing history. */
  lookbackMonths?: number | null;
}

const DEFAULT_LOOKBACK_MONTHS = 12;
/** A transaction matches an expected day at most this many days away. */
const MATCH_TOLERANCE_DAYS = 5;
/** Days after a program ends before "membership billing never started" is reported. */
const PROGRAM_END_GRACE_DAYS = 7;

/**
 * A pause this long or shorter, counted in billing periods (billing days it covers), is read as "possibly a
 * gift" (a month given to a member), not as a hiatus; a longer one, or one with no resume date, is a hiatus.
 * Stripe stores no pause start, so the pause is counted from the first billing day after the member's last
 * payment up to the resume day. A heuristic, not a fact: the page and docs say so.
 */
export const SHORT_PAUSE_MAX_BILLING_PERIODS = 1;

/** A billing day this soon after a hiatus ended is "after a hiatus". */
const AFTER_HIATUS_DAYS = 45;

/** A payment with a draft or void invoice (what a pause leaves) within this many days on both sides is read as taken during the pause: about one billing period. */
const PAUSE_ARTIFACT_WINDOW_DAYS = 35;

const LIVE_SUBSCRIPTION = new Set(["active", "past_due", "trialing"]);

// ---------------------------------------------------------------- dates

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Eastern day (YYYY-MM-DD) of an instant. */
export function easternDay(iso: string): string {
  const parts = dayFormat.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const monthOf = (day: string) => day.slice(0, 7);
const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const addMonths = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};
const addDays = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
/** The billing day of a month for a day-of-month, clamped to the month's length (the 31st bills on the 28th in February). */
const billingDate = (month: string, dayOfMonth: number) => `${month}-${String(Math.min(dayOfMonth, daysInMonth(month))).padStart(2, "0")}`;

const strictlyInside = (day: string, w: ReconWindow) => day > w.startDate && (w.endDate === null || day < w.endDate);
const touches = (day: string, w: ReconWindow) => day >= w.startDate && (w.endDate === null || day <= w.endDate);

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------------------------------------------------------------- joining

const group = <T>(rows: T[], keyOf: (row: T) => string | null | undefined): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key == null) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
};

/** The membership invoices of one customer, each with the charges that tried to collect it and what refunds took back. */
function transactionsOf(
  invoices: ReconInvoice[],
  chargesByInvoice: Map<string, ReconCharge[]>,
  chargeById: Map<string, ReconCharge>
): ScheduleTransaction[] {
  return invoices.map((invoice) => {
    const tries = new Map((chargesByInvoice.get(invoice.stripeInvoiceId) ?? []).map((c) => [c.stripeChargeId, c]));
    const named = invoice.stripeChargeId ? chargeById.get(invoice.stripeChargeId) : undefined;
    if (named) tries.set(named.stripeChargeId, named);
    const list = [...tries.values()];
    const refunded = list.reduce((sum, c) => sum + c.amountRefundedCents, 0);
    return {
      invoiceId: invoice.stripeInvoiceId,
      chargeIds: list.map((c) => c.stripeChargeId),
      day: easternDay(invoice.createdAt),
      billedCents: invoice.status === "paid" ? invoice.amountPaidCents : invoice.amountDueCents,
      keptCents: invoice.status === "paid" ? Math.max(0, invoice.amountPaidCents - refunded) : 0,
      refundedCents: refunded,
      invoiceStatus: invoice.status,
      failureCodes: [...new Set(list.map((c) => c.failureCode).filter((c): c is string => !!c))],
      attempts: Math.max(invoice.attemptCount, list.length),
    };
  });
}

/** The state of one transaction on its own, before what is expected of it. */
function transactionStatus(tx: ScheduleTransaction): RowStatus {
  if (tx.invoiceStatus === "paid") return tx.refundedCents > 0 && tx.keptCents <= 0 && tx.billedCents > 0 ? "refunded" : "paid";
  if (tx.invoiceStatus === "uncollectible") return "failed";
  if (tx.invoiceStatus === "open") return tx.failureCodes.length > 0 ? "failed" : "open";
  return "open";
}

/**
 * How many billing days a pause covers: from the first billing day after the last payment (or the subscription's
 * start when nothing was paid) up to, not including, the resume day. Null when there is no resume day (indefinite).
 */
function pausePeriods(sub: ReconSubscription, lastPaidDay: string | null): number | null {
  if (!sub.pauseResumesAt) return null;
  const resumes = easternDay(sub.pauseResumesAt);
  const anchorDay = Number(easternDay(sub.billingAnchor ?? sub.createdAt).slice(8, 10));
  const from = lastPaidDay ?? easternDay(sub.createdAt);
  let count = 0;
  for (let month = monthOf(from); month <= monthOf(resumes); month = addMonths(month, 1)) {
    const date = billingDate(month, anchorDay);
    if (date > from && date < resumes) count += 1;
  }
  return count;
}

/** A run of billing periods with no payment between two paid invoices. */
export interface BillingGap {
  /** The Eastern day of the last payment before the gap, and of the one that resumed billing. */
  lastPaid: string;
  resumed: string;
  /** The first billing day with no payment. */
  firstMissed: string;
  /** How many billing periods have no payment (1 or more). */
  missedPeriods: number;
}

const DAYS_PER_PERIOD = 30.44;

/**
 * Pauses inferred from the payments: two consecutive paid invoices more than one billing period apart. Left
 * out: a gap with a failed, open or uncollectible invoice in it (a payment problem, not a pause), a gap not
 * inside one subscription's life (a cancellation and a new subscription), and a gap mostly covered by a program
 * that includes membership. A heuristic: the invoices show what was billed, not why.
 */
export function inferBillingGaps(paidDays: string[], problemDays: string[], subs: ReconSubscription[], programs: ReconWindow[]): BillingGap[] {
  const days = [...new Set(paidDays)].sort();
  const gaps: BillingGap[] = [];
  for (let i = 0; i + 1 < days.length; i++) {
    const a = days[i];
    const b = days[i + 1];
    const missedPeriods = Math.round(dayDiff(b, a) / DAYS_PER_PERIOD) - 1;
    if (missedPeriods < 1) continue;
    if (problemDays.some((d) => d > a && d < b)) continue;
    if (!subs.some((s) => easternDay(s.createdAt) <= a && (!s.canceledAt || easternDay(s.canceledAt) >= b))) continue;
    const covered = programs.some((p) => {
      const from = p.startDate > a ? p.startDate : a;
      const to = p.endDate === null || p.endDate > b ? b : p.endDate;
      return dayDiff(to, from) * 2 >= dayDiff(b, a);
    });
    if (covered) continue;
    gaps.push({ lastPaid: a, resumed: b, firstMissed: billingDate(addMonths(monthOf(a), 1), Number(a.slice(8, 10))), missedPeriods });
  }
  return gaps;
}

/** What the Hub's hiatus rows say about one inferred gap, or what is missing. */
export interface HiatusAudit {
  kind: "confirmed" | "mismatch" | "unrecorded" | "short";
  gap: BillingGap;
  hiatus: ReconWindow | null;
  /** Billing resumed this many days after the hiatus ended (negative: before). Null without a hiatus or end date. */
  endDiffDays: number | null;
  /** The hiatus ended on the day of the month the member is billed on. */
  endedOnBillingDay: boolean;
}

/** Days either side of a billing gap's edge within which the Hub's hiatus dates count as the same. */
const HIATUS_DATE_TOLERANCE_DAYS = 5;

/**
 * The Hub's hiatus history is the claim, the payments the evidence. A gap with a hiatus over it that ends
 * about when billing resumed is confirmed; one that ends earlier or later (a hiatus ending on the billing day
 * that still skipped a month shows here, as about 30 days) is a mismatch; a gap with no hiatus and no program is
 * unrecorded, or short when it is within `SHORT_PAUSE_MAX_BILLING_PERIODS` (possibly a gifted month).
 */
export function auditHiatuses(gaps: BillingGap[], hiatuses: ReconWindow[]): HiatusAudit[] {
  return gaps.map((gap): HiatusAudit => {
    const over = hiatuses
      .filter((h) => h.startDate <= gap.resumed && (h.endDate === null || h.endDate >= gap.firstMissed))
      .sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0];
    if (!over) {
      return { kind: gap.missedPeriods <= SHORT_PAUSE_MAX_BILLING_PERIODS ? "short" : "unrecorded", gap, hiatus: null, endDiffDays: null, endedOnBillingDay: false };
    }
    const endDiffDays = over.endDate === null ? null : dayDiff(gap.resumed, over.endDate);
    const startOk = over.startDate <= addDays(gap.firstMissed, HIATUS_DATE_TOLERANCE_DAYS);
    const endOk = endDiffDays !== null && Math.abs(endDiffDays) <= HIATUS_DATE_TOLERANCE_DAYS;
    return {
      kind: startOk && endOk ? "confirmed" : "mismatch",
      gap,
      hiatus: over,
      endDiffDays,
      endedOnBillingDay: over.endDate !== null && Number(over.endDate.slice(8, 10)) === Number(gap.lastPaid.slice(8, 10)),
    };
  });
}

/** The schedule row for one audit result. */
function auditRow(a: HiatusAudit): Omit<ScheduleRow, "key"> {
  const { gap, hiatus } = a;
  const span = `${gap.lastPaid} and ${gap.resumed}`;
  const base = { expectedDate: gap.resumed, expectedAmountCents: null, month: monthOf(gap.resumed), currency: "usd", transactions: [] as ScheduleTransaction[] };
  const periods = `${gap.missedPeriods} billing ${gap.missedPeriods === 1 ? "period" : "periods"}`;
  if (a.kind === "confirmed" && hiatus) {
    return { ...base, status: "hiatus_confirmed", needsAttention: false, cause: "hiatus", reason: `The Hub's hiatus (${hiatus.startDate} to ${hiatus.endDate}) is confirmed by the payments: none between ${span}.` };
  }
  if (a.kind === "mismatch" && hiatus) {
    const end = hiatus.endDate === null ? "has no end date" : a.endDiffDays !== null && a.endDiffDays > 0 ? `ended ${hiatus.endDate}, ${a.endDiffDays} days before billing resumed` : `ended ${hiatus.endDate}, ${Math.abs(a.endDiffDays ?? 0)} days after billing resumed`;
    const extra = a.endDiffDays !== null && Math.abs(a.endDiffDays) > HIATUS_DATE_TOLERANCE_DAYS ? ` (about ${Math.round(Math.abs(a.endDiffDays) / DAYS_PER_PERIOD)} billing period${Math.round(Math.abs(a.endDiffDays) / DAYS_PER_PERIOD) === 1 ? "" : "s"} ${a.endDiffDays > 0 ? "more" : "fewer"} than recorded)` : "";
    return {
      ...base,
      status: "hiatus_mismatch",
      needsAttention: true,
      cause: a.endedOnBillingDay ? "hiatus_billing_day" : "hiatus",
      reason: `No payment between ${span}, but the Hub's hiatus (from ${hiatus.startDate}) ${end}${extra}.${a.endedOnBillingDay ? " The hiatus ended on the billing day." : ""}`,
    };
  }
  if (a.kind === "short") {
    return { ...base, status: "gap_short", needsAttention: false, cause: "gap", reason: `No payment between ${span} (${periods}) and no hiatus on record: possibly a gifted month (a guess from the invoices).` };
  }
  return { ...base, status: "unrecorded_gap", needsAttention: true, cause: "gap", reason: `No payment between ${span} (${periods}) and no hiatus or program on record: the Hub may be missing a hiatus, or billing was missed (a guess from the invoices).` };
}

/** Why a paused subscription expects nothing: with its resume day when Stripe has one. */
function pausedWhy(subs: ReconSubscription[]): string {
  const paused = subs.find((s) => s.paused);
  if (!paused) return "the subscription is paused in Stripe";
  return paused.pauseResumesAt ? `the subscription is paused in Stripe until ${easternDay(paused.pauseResumesAt)}` : "the subscription is paused in Stripe with no resume date";
}

/**
 * Today's state from Stripe against the Hub's. Stripe is the truth for "paused now" (a paused subscription;
 * its resume day is the hiatus end) and "cancelled" (a cancelled one); the Hub's hiatus history is the only
 * record of past pauses. Returns a sentence when they disagree, or null.
 */
function hubStripeDisagreement(
  member: ReconMember,
  subs: ReconSubscription[],
  hiatuses: ReconWindow[],
  programs: ReconWindow[],
  today: string,
  lastPaidDay: string | null
): { reason: string; cause: RowCause; short?: boolean } | null {
  const alive = subs.filter((s) => LIVE_SUBSCRIPTION.has(s.status) && !s.canceledAt);
  const paused = alive.filter((s) => s.paused);
  const billing = alive.filter((s) => !s.paused);
  const current = hiatuses.filter((h) => touches(today, h));
  const hubHiatus = member.status === "on_hiatus" || current.length > 0;
  const inProgram = programs.some((p) => touches(today, p));

  if (hubHiatus && paused.length === 0 && billing.length > 0) return { reason: "The Hub says the member is on hiatus, but the Stripe subscription is not paused and will keep billing.", cause: "hiatus" };
  if (!hubHiatus && paused.length > 0 && member.status !== "cancelled" && !inProgram) {
    const shorts = paused.map((s) => ({ s, periods: pausePeriods(s, lastPaidDay) }));
    if (shorts.every((p) => p.periods !== null && p.periods <= SHORT_PAUSE_MAX_BILLING_PERIODS)) {
      const until = easternDay(shorts[0].s.pauseResumesAt as string);
      return { reason: `The Stripe subscription is paused until ${until}, about ${shorts[0].periods === 0 ? "less than one" : "one"} billing period: possibly a gifted month, so not treated as a hiatus (a guess from the pause length).`, cause: null, short: true };
    }
    return { reason: "The Stripe subscription is paused, but the Hub has no hiatus covering today.", cause: "hiatus" };
  }
  if (hubHiatus && paused.length > 0) {
    const resumes = paused.map((s) => (s.pauseResumesAt ? easternDay(s.pauseResumesAt) : null)).sort().at(-1) ?? null;
    const ends = current.map((h) => h.endDate);
    const hubEnd = ends.length > 0 && !ends.includes(null) ? ((ends as string[]).sort().at(-1) ?? null) : null;
    if (resumes && hubEnd && resumes !== hubEnd) return { reason: `The hiatus ends on ${hubEnd} in the Hub, but the Stripe pause resumes on ${resumes} (${Math.abs(dayDiff(resumes, hubEnd))} days ${resumes > hubEnd ? "later" : "earlier"}).`, cause: "hiatus" };
    if (!resumes && hubEnd) return { reason: `The hiatus ends on ${hubEnd} in the Hub, but the Stripe pause has no resume date, so nothing will resume billing.`, cause: "hiatus" };
    if (resumes && !hubEnd) return { reason: `The Stripe pause resumes on ${resumes}, but the Hub has no end date for the hiatus.`, cause: "hiatus" };
  }
  if (member.status === "cancelled" && alive.length > 0) return { reason: "The Hub says the member is cancelled, but the Stripe subscription is still live and will bill or resume.", cause: null };
  if (member.status === "active" && subs.length > 0 && alive.length === 0 && programs.length === 0 && !inProgram) return { reason: "The Hub says the member is active, but every Stripe subscription is cancelled.", cause: null };
  return null;
}

const tries = (n: number) => `${n} ${n === 1 ? "try" : "tries"}`;

// ---------------------------------------------------------------- the membership schedule

interface Expected {
  date: string;
  month: string;
  /** inside: strictly within a hiatus or a program; edge: on its first or last day; outside: neither. */
  zone: "inside" | "edge" | "outside";
  zoneReason: string | null;
  paused: boolean;
  /** The day of the month the subscription bills on. */
  anchorDay: number;
  tx: ScheduleTransaction | null;
}

/**
 * One member's membership: the billing days their live subscriptions give, minus the hiatuses and program
 * cohorts that include membership, matched to their membership invoices.
 */
function buildMembershipSchedule(
  member: ReconMember,
  invoices: ReconInvoice[],
  subscriptions: ReconSubscription[],
  hiatuses: ReconWindow[],
  programs: ReconWindow[],
  txs: ScheduleTransaction[],
  today: string,
  lookbackMonths: number | null,
  left: { otherInvoices: number; oneOffCharges: number }
): PurchaseSchedule | null {
  const firstDay = lookbackMonths === null ? "0000-01-01" : `${addMonths(monthOf(today), -lookbackMonths)}-01`;
  const subs = subscriptions.filter((s) => s.status !== "incomplete_expired");

  // Expected billing days: the creation day, then each month's billing day while the subscription lives.
  const byMonth = new Map<string, Expected>();
  for (const sub of subs) {
    const start = easternDay(sub.createdAt);
    const ended = sub.canceledAt ? easternDay(sub.canceledAt) : sub.status === "canceled" ? start : null;
    const anchorDay = Number(easternDay(sub.billingAnchor ?? sub.createdAt).slice(8, 10));
    const dates = [start];
    for (let month = monthOf(start); month <= monthOf(today); month = addMonths(month, 1)) {
      const date = billingDate(month, anchorDay);
      if (date > start) dates.push(date);
    }
    for (const date of dates) {
      if (date < firstDay || date >= today || (ended !== null && date >= ended && date !== start)) continue;
      const month = monthOf(date);
      if (byMonth.has(month) && byMonth.get(month)!.date <= date) continue;
      const hiatus = hiatuses.find((h) => touches(date, h));
      const program = programs.find((p) => touches(date, p));
      const insideHiatus = hiatuses.some((h) => strictlyInside(date, h));
      const insideProgram = programs.some((p) => strictlyInside(date, p));
      byMonth.set(month, {
        date,
        month,
        zone: insideHiatus || insideProgram ? "inside" : hiatus || program ? "edge" : "outside",
        zoneReason: insideHiatus ? "on hiatus" : insideProgram ? "in a program that includes membership" : hiatus ? "on the first or last day of a hiatus" : program ? "on the first or last day of a program that includes membership" : null,
        paused: sub.paused && (!sub.pauseResumesAt || date < easternDay(sub.pauseResumesAt)),
        anchorDay,
        tx: null,
      });
    }
  }
  const expected = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Match each payment to the nearest expected day within the tolerance; each side is used once.
  const candidates = txs
    .filter((t) => t.invoiceStatus === "paid" || t.invoiceStatus === "open" || t.invoiceStatus === "uncollectible")
    .flatMap((tx) => expected.map((e) => ({ tx, e, gap: Math.abs(dayDiff(tx.day, e.date)) })))
    .filter((p) => p.gap <= MATCH_TOLERANCE_DAYS)
    .sort((a, b) => a.gap - b.gap || a.e.date.localeCompare(b.e.date) || a.tx.invoiceId.localeCompare(b.tx.invoiceId));
  const used = new Set<string>();
  for (const { tx, e } of candidates) {
    if (e.tx || used.has(tx.invoiceId)) continue;
    e.tx = tx;
    used.add(tx.invoiceId);
  }

  const lastPaidAmount = (before: string, currency: string | null) => {
    const prior = invoices
      .filter((i) => i.status === "paid" && i.amountPaidCents > 0 && easternDay(i.createdAt) < before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return prior ? { cents: prior.amountPaidCents, currency: prior.currency ?? currency ?? "usd" } : null;
  };
  const active = member.status === "active";
  const rows: Omit<ScheduleRow, "key">[] = [];

  // Stripe stores no pause start, but a paused subscription leaves draft or void invoices instead of charges.
  // A payment with such an invoice within a billing period before it and another within one after it, before the resume day, sits inside the
  // current pause (a heuristic, like the pause length); one with none after it came before the pause began.
  const pausedSubs = subs.filter((s) => s.paused && LIVE_SUBSCRIPTION.has(s.status) && !s.canceledAt);
  const pauseArtifacts = invoices.filter((i) => i.status === "draft" || i.status === "void").map((i) => easternDay(i.createdAt));
  const paidWhilePaused = (day: string) =>
    pausedSubs.some((s) => !s.pauseResumesAt || day < easternDay(s.pauseResumesAt)) && pauseArtifacts.some((d) => d < day && dayDiff(day, d) <= PAUSE_ARTIFACT_WINDOW_DAYS) && pauseArtifacts.some((d) => d > day && dayDiff(d, day) <= PAUSE_ARTIFACT_WINDOW_DAYS);

  for (const e of expected) {
    const price = lastPaidAmount(e.date, null);
    const base = { expectedDate: e.date, expectedAmountCents: e.tx ? e.tx.billedCents : (price?.cents ?? null), month: e.month, currency: price?.currency ?? "usd" };
    if (e.tx) {
      const status = transactionStatus(e.tx);
      const pausePaid = status === "paid" && e.tx.keptCents > 0 && e.zone !== "inside" && paidWhilePaused(e.tx.day);
      const flagged = (status === "paid" && e.zone === "inside" && e.tx.keptCents > 0) || pausePaid;
      const out: RowStatus = flagged ? "charged_when_not_expected" : status;
      const reason = flagged
        ? `${money(e.tx.keptCents)} was paid on ${e.tx.day} while ${pausePaid ? "the subscription was paused in Stripe" : `the member was ${e.zoneReason}`}.`
        : out === "paid"
          ? e.tx.attempts > 1 || e.tx.failureCodes.length > 0
            ? `${money(e.tx.keptCents)} paid on ${e.tx.day} after ${tries(e.tx.attempts)}${e.tx.failureCodes.length ? ` (earlier: ${e.tx.failureCodes.join(", ")})` : ""}.`
            : e.tx.refundedCents > 0
              ? `${money(e.tx.keptCents)} paid on ${e.tx.day}; ${money(e.tx.refundedCents)} was refunded.`
              : `${money(e.tx.keptCents)} paid on ${e.tx.day}.`
          : out === "refunded"
            ? `${money(e.tx.refundedCents)} paid on ${e.tx.day} and refunded in full.`
            : out === "open"
              ? `${money(e.tx.billedCents)} invoiced on ${e.tx.day} is still unpaid after ${tries(e.tx.attempts)}.`
              : e.tx.invoiceStatus === "uncollectible"
                ? `${money(e.tx.billedCents)} invoiced on ${e.tx.day} was written off as uncollectible after ${tries(e.tx.attempts)}${e.tx.failureCodes.length ? ` (${e.tx.failureCodes.join(", ")})` : ""}.`
                : `${money(e.tx.billedCents)} invoiced on ${e.tx.day} is unpaid; the card was declined${e.tx.failureCodes.length ? ` (${e.tx.failureCodes.join(", ")})` : ""} after ${tries(e.tx.attempts)}.`;
      rows.push({
        ...base,
        status: out,
        reason,
        needsAttention: out === "charged_when_not_expected" || ((out === "open" || out === "failed") && active),
        cause: pausePaid ? "pause" : flagged ? (e.zoneReason === "on hiatus" ? "hiatus" : "program") : null,
        transactions: [e.tx],
      });
      continue;
    }
    const sameMonth = invoices.filter((i) => monthOf(easternDay(i.createdAt)) === e.month && !used.has(i.stripeInvoiceId));
    if (e.zone !== "outside" || e.paused) {
      const why = e.zone === "outside" ? pausedWhy(subs) : e.zoneReason;
      const cause: RowCause = e.zone === "outside" ? null : e.zoneReason === "on hiatus" ? "hiatus" : e.zoneReason?.includes("program") ? "program" : "hiatus";
      rows.push({ ...base, status: "not_expected", reason: `No payment, and none expected: ${why}.`, needsAttention: false, cause, transactions: [] });
      continue;
    }
    const hint = sameMonth.some((i) => i.status === "draft") ? "the only invoice is a draft that was never finalized" : sameMonth.some((i) => i.status === "void") ? "the only invoice is void" : "Stripe made no membership invoice";
    // A billing day soon after a hiatus ended: the question is whether the resume skipped a month.
    const ended = hiatuses
      .filter((h) => h.endDate !== null && h.endDate <= e.date && dayDiff(e.date, h.endDate) <= AFTER_HIATUS_DAYS)
      .sort((a, b) => (b.endDate as string).localeCompare(a.endDate as string))[0];
    const onBillingDay = ended && Number((ended.endDate as string).slice(8, 10)) === e.anchorDay;
    rows.push({
      ...base,
      status: "missed",
      reason: `Billing was due on ${e.date} but ${hint}.${ended ? ` A hiatus ended on ${ended.endDate}${onBillingDay ? ", the billing day" : ""}.` : ""}`,
      needsAttention: active,
      cause: ended ? "after_hiatus" : null,
      transactions: [],
    });
  }

  // Payments that matched no expected day.
  for (const tx of txs) {
    if (used.has(tx.invoiceId) || tx.day < firstDay) continue;
    if (tx.invoiceStatus === "draft" || tx.invoiceStatus === "void") continue;
    const status = transactionStatus(tx);
    const hiatus = hiatuses.find((h) => strictlyInside(tx.day, h));
    const program = programs.find((p) => strictlyInside(tx.day, p));
    const pausePaid = status === "paid" && tx.keptCents > 0 && !hiatus && !program && paidWhilePaused(tx.day);
    const inside = status === "paid" && tx.keptCents > 0 && (hiatus || program || pausePaid);
    const price = lastPaidAmount(tx.day, null);
    const out: RowStatus = inside ? "charged_when_not_expected" : status === "paid" ? "unexpected" : status;
    rows.push({
      expectedDate: null,
      expectedAmountCents: null,
      month: monthOf(tx.day),
      currency: price?.currency ?? "usd",
      status: out,
      reason: inside
        ? `${money(tx.keptCents)} was paid on ${tx.day} while ${pausePaid ? "the subscription was paused in Stripe" : `the member was ${hiatus ? `on hiatus (${hiatus.startDate} to ${hiatus.endDate ?? "no end date"})` : "in a program that includes membership"}`}.`
        : out === "unexpected"
          ? `${money(tx.keptCents)} was paid on ${tx.day} and matches no billing day.`
          : out === "refunded"
            ? `${money(tx.refundedCents)} paid on ${tx.day} and refunded in full, matching no billing day.`
            : `${money(tx.billedCents)} invoiced on ${tx.day} is ${out === "open" ? "unpaid" : "failed"} and matches no billing day.`,
      needsAttention: out === "charged_when_not_expected" || out === "unexpected" || ((out === "open" || out === "failed") && active),
      cause: inside ? (pausePaid ? "pause" : hiatus ? "hiatus" : "program") : null,
      transactions: [tx],
    });
  }

  // The switch from a program to membership: the program is over, the member is active, and nothing bills them.
  const graceEnd = addDays(today, -PROGRAM_END_GRACE_DAYS);
  if (active && programs.length > 0 && !programs.some((p) => p.endDate === null || p.endDate >= graceEnd)) {
    const lastEnd = programs.map((p) => p.endDate as string).sort().at(-1) as string;
    const live = subs.some((s) => LIVE_SUBSCRIPTION.has(s.status) && !s.canceledAt && !s.paused);
    const billedSince = txs.some((t) => t.keptCents > 0 && t.day >= lastEnd);
    // A live subscription's missed days are already rows above, with the month named.
    if (!live && !billedSince && lastEnd >= firstDay) {
      const why = subs.some((s) => s.paused) ? "the subscription is still paused" : subs.length === 0 ? "there is no Stripe subscription" : "the subscription is cancelled";
      rows.push({
        expectedDate: lastEnd,
        expectedAmountCents: lastPaidAmount(lastEnd, null)?.cents ?? null,
        month: monthOf(lastEnd),
        currency: "usd",
        status: "missed",
        reason: `The program that includes membership ended on ${lastEnd} and membership billing has not started: ${why}.`,
        needsAttention: true,
        cause: "program",
        transactions: [],
      });
    }
  }

  // The Hub's hiatus history checked against the payments: gaps in billing, with or without a hiatus over them.
  const gaps = inferBillingGaps(
    txs.filter((t) => t.keptCents > 0 && t.billedCents > 0).map((t) => t.day),
    txs.filter((t) => t.invoiceStatus === "open" || t.invoiceStatus === "uncollectible").map((t) => t.day),
    subs,
    programs
  );
  for (const audit of auditHiatuses(gaps, hiatuses)) if (audit.gap.resumed >= firstDay) rows.push(auditRow(audit));

  // Where the Hub and Stripe disagree about now: Stripe's subscription is the truth about who is paused or cancelled today.
  const lastPaidDay = txs.filter((t) => t.keptCents > 0).map((t) => t.day).sort().at(-1) ?? null;
  const disagreement = hubStripeDisagreement(member, subs, hiatuses, programs, today, lastPaidDay);
  if (disagreement) {
    rows.push({
      expectedDate: null,
      expectedAmountCents: null,
      month: monthOf(today),
      currency: "usd",
      status: disagreement.short ? "paused_short" : "hub_stripe_disagree",
      reason: disagreement.reason,
      needsAttention: !disagreement.short,
      cause: disagreement.cause,
      transactions: [],
    });
  }

  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.expectedDate ?? a.transactions[0]?.day ?? today).localeCompare(b.expectedDate ?? b.transactions[0]?.day ?? today));
  const seen = new Map<string, number>();
  const keyed = rows.map((row): ScheduleRow => {
    const base = `${member.id}:membership:${row.month}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...row, key: n === 1 ? base : `${base}:${n}` };
  });
  // The header's range is the whole history, whatever the rows cover: the first subscription or invoice up to the end.
  const billed = txs.filter((t) => t.invoiceStatus !== "draft" && t.invoiceStatus !== "void");
  const starts = [...subs.map((s) => easternDay(s.createdAt)), ...billed.map((t) => t.day)].sort();
  const notes: string[] = [];
  const before = billed.filter((t) => t.day < firstDay).length;
  if (before > 0) notes.push(`${before} earlier ${before === 1 ? "invoice is" : "invoices are"} not listed: this view starts on ${firstDay}. The member's own Transactions tab covers the whole history.`);
  const empty = txs.length - billed.length;
  if (empty > 0) notes.push(`${empty} draft or void ${empty === 1 ? "invoice" : "invoices"} billed nothing and ${empty === 1 ? "is" : "are"} not listed; they only show a pause or a billing run that never went out.`);
  const { otherInvoices, oneOffCharges } = left;
  if (otherInvoices > 0) notes.push(`${otherInvoices} ${otherInvoices === 1 ? "invoice" : "invoices"} for other products ${otherInvoices === 1 ? "is" : "are"} not membership billing; see the flat list.`);
  if (oneOffCharges > 0) notes.push(`${oneOffCharges} one-off ${oneOffCharges === 1 ? "payment" : "payments"} with no invoice ${oneOffCharges === 1 ? "is" : "are"} not membership billing; see the flat list.`);
  const live = subs.filter((s) => LIVE_SUBSCRIPTION.has(s.status) && !s.canceledAt);
  return {
    purchaseType: "membership",
    label: "Membership",
    memberId: member.id,
    start: starts[0] ?? null,
    end: live.length > 0 ? null : (subs.map((s) => (s.canceledAt ? easternDay(s.canceledAt) : null)).filter((d): d is string => !!d).sort().at(-1) ?? null),
    rows: keyed,
    notes,
  };
}

/** Every purchase schedule over one set of inputs. Only members with something to show get one. */
export function buildSchedules(input: ReconInput): PurchaseSchedule[] {
  const chargesByInvoice = group(input.charges, (c) => c.stripeInvoiceId);
  const chargeById = new Map(input.charges.map((c) => [c.stripeChargeId, c]));
  const allInvoicesByCustomer = group(input.invoices, (i) => i.stripeCustomerId);
  const invoiceCharges = new Set(input.invoices.map((i) => i.stripeChargeId).filter((c): c is string => !!c));
  const oneOffByCustomer = group(
    input.charges.filter((c) => !c.stripeInvoiceId && !invoiceCharges.has(c.stripeChargeId)),
    (c) => c.stripeCustomerId
  );
  const invoicesByCustomer = group(
    input.invoices.filter((i) => i.stripeProductId && input.membershipProductIds.has(i.stripeProductId)),
    (i) => i.stripeCustomerId
  );
  const subsByCustomer = group(input.subscriptions, (s) => s.stripeCustomerId);
  const hiatusByMember = group(input.hiatuses, (h) => h.memberId);
  const programsByMember = group(input.programWindows, (p) => p.memberId);
  const lookback = input.lookbackMonths === undefined ? DEFAULT_LOOKBACK_MONTHS : input.lookbackMonths;

  const schedules: PurchaseSchedule[] = [];
  for (const member of input.members) {
    if (member.stripeCustomerIds.length === 0) continue;
    const invoices = member.stripeCustomerIds.flatMap((c) => invoicesByCustomer.get(c) ?? []);
    const schedule = buildMembershipSchedule(
      member,
      invoices,
      member.stripeCustomerIds.flatMap((c) => subsByCustomer.get(c) ?? []),
      hiatusByMember.get(member.id) ?? [],
      programsByMember.get(member.id) ?? [],
      transactionsOf(invoices, chargesByInvoice, chargeById),
      input.today,
      lookback,
      {
        otherInvoices: member.stripeCustomerIds.reduce((n, c) => n + (allInvoicesByCustomer.get(c)?.length ?? 0), 0) - invoices.length,
        oneOffCharges: member.stripeCustomerIds.reduce((n, c) => n + (oneOffByCustomer.get(c)?.length ?? 0), 0),
      }
    );
    if (schedule) schedules.push(schedule);
  }
  // Events, programs and courses add their builders here.
  return schedules;
}

/** How many rows of each status, and how many need attention, over some schedules. */
export function summarize(schedules: PurchaseSchedule[]): { byStatus: Record<RowStatus, number>; needsAttention: number; membersWithProblems: number } {
  const byStatus = Object.fromEntries(ROW_STATUSES.map((s) => [s, 0])) as Record<RowStatus, number>;
  let needsAttention = 0;
  const members = new Set<string>();
  for (const schedule of schedules) {
    for (const row of schedule.rows) {
      byStatus[row.status] += 1;
      if (row.needsAttention) {
        needsAttention += 1;
        members.add(schedule.memberId);
      }
    }
  }
  return { byStatus, needsAttention, membersWithProblems: members.size };
}
