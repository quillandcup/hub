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

export const ROW_STATUSES = ["paid", "refunded", "missed", "failed", "open", "charged_when_not_expected", "unexpected", "not_expected"] as const;
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
};

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
  /** How many months back the schedule goes. Default 12. */
  lookbackMonths?: number;
}

const DEFAULT_LOOKBACK_MONTHS = 12;
/** A transaction matches an expected day at most this many days away. */
const MATCH_TOLERANCE_DAYS = 5;
/** Days after a program ends before "membership billing never started" is reported. */
const PROGRAM_END_GRACE_DAYS = 7;

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

const tries = (n: number) => `${n} ${n === 1 ? "try" : "tries"}`;

// ---------------------------------------------------------------- the membership schedule

interface Expected {
  date: string;
  month: string;
  /** inside: strictly within a hiatus or a program; edge: on its first or last day; outside: neither. */
  zone: "inside" | "edge" | "outside";
  zoneReason: string | null;
  paused: boolean;
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
  lookbackMonths: number
): PurchaseSchedule | null {
  const firstDay = `${addMonths(monthOf(today), -lookbackMonths)}-01`;
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
        paused: sub.paused,
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

  for (const e of expected) {
    const price = lastPaidAmount(e.date, null);
    const base = { expectedDate: e.date, expectedAmountCents: e.tx ? e.tx.billedCents : (price?.cents ?? null), month: e.month, currency: price?.currency ?? "usd" };
    if (e.tx) {
      const status = transactionStatus(e.tx);
      const flagged = status === "paid" && e.zone === "inside" && e.tx.keptCents > 0;
      const out: RowStatus = flagged ? "charged_when_not_expected" : status;
      const reason = flagged
        ? `${money(e.tx.keptCents)} was paid on ${e.tx.day} while the member was ${e.zoneReason}.`
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
        transactions: [e.tx],
      });
      continue;
    }
    const sameMonth = invoices.filter((i) => monthOf(easternDay(i.createdAt)) === e.month && !used.has(i.stripeInvoiceId));
    if (e.zone !== "outside" || e.paused) {
      const why = e.zone === "outside" ? "the subscription is paused in Stripe" : e.zoneReason;
      rows.push({ ...base, status: "not_expected", reason: `No payment, and none expected: ${why}.`, needsAttention: false, transactions: [] });
      continue;
    }
    const hint = sameMonth.some((i) => i.status === "draft") ? "the only invoice is a draft that was never finalized" : sameMonth.some((i) => i.status === "void") ? "the only invoice is void" : "Stripe made no membership invoice";
    rows.push({
      ...base,
      status: "missed",
      reason: `Billing was due on ${e.date} but ${hint}.`,
      needsAttention: active,
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
    const inside = status === "paid" && tx.keptCents > 0 && (hiatus || program);
    const price = lastPaidAmount(tx.day, null);
    const out: RowStatus = inside ? "charged_when_not_expected" : status === "paid" ? "unexpected" : status;
    rows.push({
      expectedDate: null,
      expectedAmountCents: null,
      month: monthOf(tx.day),
      currency: price?.currency ?? "usd",
      status: out,
      reason: inside
        ? `${money(tx.keptCents)} was paid on ${tx.day} while the member was ${hiatus ? `on hiatus (${hiatus.startDate} to ${hiatus.endDate ?? "no end date"})` : "in a program that includes membership"}.`
        : out === "unexpected"
          ? `${money(tx.keptCents)} was paid on ${tx.day} and matches no billing day.`
          : out === "refunded"
            ? `${money(tx.refundedCents)} paid on ${tx.day} and refunded in full, matching no billing day.`
            : `${money(tx.billedCents)} invoiced on ${tx.day} is ${out === "open" ? "unpaid" : "failed"} and matches no billing day.`,
      needsAttention: out === "charged_when_not_expected" || out === "unexpected" || ((out === "open" || out === "failed") && active),
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
        transactions: [],
      });
    }
  }

  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.expectedDate ?? a.transactions[0]?.day ?? "").localeCompare(b.expectedDate ?? b.transactions[0]?.day ?? ""));
  const seen = new Map<string, number>();
  const keyed = rows.map((row): ScheduleRow => {
    const base = `${member.id}:membership:${row.month}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...row, key: n === 1 ? base : `${base}:${n}` };
  });
  const starts = subs.map((s) => easternDay(s.createdAt)).sort();
  const live = subs.filter((s) => LIVE_SUBSCRIPTION.has(s.status) && !s.canceledAt);
  return {
    purchaseType: "membership",
    label: "Membership",
    memberId: member.id,
    start: starts[0] ?? null,
    end: live.length > 0 ? null : (subs.map((s) => (s.canceledAt ? easternDay(s.canceledAt) : null)).filter((d): d is string => !!d).sort().at(-1) ?? null),
    rows: keyed,
  };
}

/** Every purchase schedule over one set of inputs. Only members with something to show get one. */
export function buildSchedules(input: ReconInput): PurchaseSchedule[] {
  const chargesByInvoice = group(input.charges, (c) => c.stripeInvoiceId);
  const chargeById = new Map(input.charges.map((c) => [c.stripeChargeId, c]));
  const invoicesByCustomer = group(
    input.invoices.filter((i) => i.stripeProductId && input.membershipProductIds.has(i.stripeProductId)),
    (i) => i.stripeCustomerId
  );
  const subsByCustomer = group(input.subscriptions, (s) => s.stripeCustomerId);
  const hiatusByMember = group(input.hiatuses, (h) => h.memberId);
  const programsByMember = group(input.programWindows, (p) => p.memberId);
  const lookback = input.lookbackMonths ?? DEFAULT_LOOKBACK_MONTHS;

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
      lookback
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
