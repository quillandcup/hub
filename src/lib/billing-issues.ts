import { ROW_STATUS_LABELS, transactionStatus, type PurchaseSchedule, type PurchaseType, type RowStatus, type ScheduleRow } from "@/lib/billing-reconciliation";
import { ackViewFor, isAcknowledged, type AckRecord, type AckView } from "@/lib/billing-acknowledgements";
import type { BillingOverview } from "@/lib/billing-reconciliation-loader";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { stripeChargeUrl, stripeInvoiceUrl } from "@/lib/member-transactions";

/**
 * The billing reconciliation overview as a list of issues: one per schedule row that needs attention, with what is
 * at stake (an amount), how long it has been waiting (an age), how urgent it is and which "what do I do" group it
 * belongs to. Pure and serializable, so the server page builds it and the table (a client component) sorts, searches
 * and pages it. Docs: docs/architecture/BILLING_RECONCILIATION.md.
 */

// ---------------------------------------------------------------- groups

type RowKind = Pick<ScheduleRow, "status" | "cause">;

export const ISSUE_GROUPS = [
  { id: "collect", label: "Collect money", hint: "Unpaid invoices (behind, or paying again with earlier months unpaid) and billing days with no invoice" },
  { id: "hiatus", label: "Hiatus and program billing", hint: "Charged during a hiatus, a pause or a program, not billed after one ended, and billing gaps that do not match the Hub's hiatus" },
  { id: "disagree", label: "Hub and Stripe disagree", hint: "The Hub's status (hiatus, cancelled, active) does not match the Stripe subscription" },
  { id: "purchases", label: "Event, program and course purchases", hint: "Bought with no Stripe payment, paid with no explanation, or granted with no override on record" },
  { id: "unexpected", label: "Unexpected payments", hint: "A payment that matches no billing day or purchase" },
] as const;
export type IssueGroupId = (typeof ISSUE_GROUPS)[number]["id"];

/** Which group one row belongs to. Every row is in exactly one, so the groups add up to "All". */
export function issueGroupOf(purchaseType: PurchaseType, row: RowKind): IssueGroupId {
  switch (row.status) {
    case "hub_stripe_disagree":
      return "disagree";
    case "unexpected":
      return "unexpected";
    case "unpaid_behind":
    case "unpaid_earlier":
      return "collect";
    case "missed":
      return row.cause === "after_hiatus" || row.cause === "program" ? "hiatus" : "collect";
    case "charged_when_not_expected":
    case "hiatus_mismatch":
    case "unrecorded_gap":
      return "hiatus";
    default:
      return purchaseType === "membership" ? "collect" : "purchases";
  }
}

/**
 * The narrower filters the page used to have. Their ids stay valid in `?filter=` (links in docs and notes use them);
 * they narrow what the page shows to one kind of row inside the groups.
 */
export const LEGACY_FILTERS = [
  { id: "charged_hiatus", label: "Charged during a hiatus", match: (r: RowKind) => r.status === "charged_when_not_expected" && r.cause === "hiatus" },
  { id: "missed_after_hiatus", label: "Not billed after a hiatus ended", match: (r: RowKind) => r.status === "missed" && r.cause === "after_hiatus" },
  { id: "unrecorded_gap", label: "Billing gap with no hiatus", match: (r: RowKind) => r.status === "unrecorded_gap" },
  { id: "hiatus_mismatch", label: "Hiatus and billing gap differ", match: (r: RowKind) => r.status === "hiatus_mismatch" },
  { id: "billing_day", label: "Hiatus ended on the billing day, month skipped", match: (r: RowKind) => r.cause === "hiatus_billing_day" },
  { id: "program", label: "Program and membership", match: (r: RowKind) => r.cause === "program" },
  { id: "behind", label: "Behind: nothing paid since an unpaid invoice", match: (r: RowKind) => r.status === "unpaid_behind" },
  { id: "paying_again", label: "Paying again, earlier months unpaid", match: (r: RowKind) => r.status === "unpaid_earlier" },
  { id: "payment", label: "Any unpaid invoice", match: (r: RowKind) => r.status === "unpaid_behind" || r.status === "unpaid_earlier" },
  { id: "missed", label: "Missed", match: (r: RowKind) => r.status === "missed" },
  { id: "missing_payment", label: "Bought, no Stripe payment", match: (r: RowKind) => r.status === "missing_payment" },
  { id: "unexplained_payment", label: "Paid, not explained", match: (r: RowKind) => r.status === "unexplained_payment" },
  { id: "granted", label: "Granted purchases", match: (r: RowKind) => r.cause === "granted" },
] as const;
export type LegacyFilterId = (typeof LEGACY_FILTERS)[number]["id"];

export interface IssueFilter {
  /** The group chip that is chosen, or null for "All" (and when a narrower filter is in use). */
  group: IssueGroupId | null;
  legacy: (typeof LEGACY_FILTERS)[number] | null;
}

/** `?filter=` to a filter: a group id, an old narrower id, or anything else (all). */
export function parseIssueFilter(value: string | undefined): IssueFilter {
  const group = ISSUE_GROUPS.find((g) => g.id === value);
  if (group) return { group: group.id, legacy: null };
  const legacy = LEGACY_FILTERS.find((f) => f.id === value) ?? null;
  return { group: null, legacy };
}

export const HUB_STATUS_FILTERS = [
  { id: "all", label: "Any Hub status", statuses: null },
  { id: "active", label: "Active", statuses: ["active"] },
  { id: "hiatus", label: "On hiatus", statuses: ["on_hiatus"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
] as const;
export type HubStatusFilterId = (typeof HUB_STATUS_FILTERS)[number]["id"];

export const parseHubStatusFilter = (value: string | undefined): HubStatusFilterId => HUB_STATUS_FILTERS.find((f) => f.id === value)?.id ?? "all";

const HUB_STATUS_LABELS: Record<string, string> = { lead: "Lead", active: "Active", on_hiatus: "On hiatus", cancelled: "Cancelled" };
export const hubStatusLabel = (status: string) => HUB_STATUS_LABELS[status] ?? status.replace(/_/g, " ");

// ---------------------------------------------------------------- the issue

export interface IssueTransaction {
  id: string;
  /** The Eastern day it was created. */
  day: string;
  description: string;
  billedCents: number;
  keptCents: number;
  refundedCents: number;
  statusLabel: string;
  attempts: number;
  failureCodes: string[];
  stripeUrl: string;
}

export interface Issue {
  /** The schedule row's own key: stable, and what a later acknowledgement attaches to. */
  key: string;
  memberId: string;
  /** The kind of purchase the row belongs to; an acknowledgement records it. */
  purchaseType: PurchaseType;
  memberName: string;
  /** The legal name, when it differs from the name shown. */
  legalName: string | null;
  purchaseLabel: string;
  /** The offer's name when it says more than the label. */
  offerName: string | null;
  event: { slug: string; title: string } | null;
  status: RowStatus;
  statusLabel: string;
  group: IssueGroupId;
  cause: ScheduleRow["cause"];
  reason: string;
  amountCents: number | null;
  currency: string;
  /** The Eastern day the problem dates from: the expected billing day, else the first transaction. */
  sinceDay: string | null;
  /** Days from `sinceDay` to today (Eastern days), or null with no day. */
  ageDays: number | null;
  hubStatus: string;
  hubStatusLabel: string;
  transactions: IssueTransaction[];
  /**
   * What staff decided about the row (an acknowledgement), or null. `state: "applies"` takes the row off the to-do list;
   * `"changed"` means the row is not what staff saw (a payment arrived, the amount moved) and it is back on it.
   */
  ack: AckView | null;
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Whole days from one Eastern day (YYYY-MM-DD) to another. Both are calendar days, so a daylight saving change never makes a day 23 or 25 hours. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayNumber(to) - dayNumber(from)) / 86_400_000);
}

/** How long a day has been waiting, counted in Eastern days up to `today` (never negative). */
export function ageInDays(day: string | null, today: string): number | null {
  return day === null ? null : Math.max(0, daysBetween(day, today));
}

const UNPAID: ReadonlySet<RowStatus> = new Set(["unpaid_behind", "unpaid_earlier"]);
const PAID_BUT_WRONG: ReadonlySet<RowStatus> = new Set(["charged_when_not_expected", "unexpected", "unexplained_payment", "paid_override_missing"]);

/**
 * The money behind an issue, in cents, or null when none is known. Unpaid: what was billed and not collected (the
 * whole run). A payment that should not have happened: what was kept. Anything else: the amount expected, else
 * what its transactions billed.
 */
export function issueAmountCents(row: Pick<ScheduleRow, "status" | "expectedAmountCents" | "transactions">): number | null {
  const billed = row.transactions.reduce((sum, t) => sum + t.billedCents, 0);
  const kept = row.transactions.reduce((sum, t) => sum + t.keptCents, 0);
  const cents = UNPAID.has(row.status) ? billed || row.expectedAmountCents : PAID_BUT_WRONG.has(row.status) ? kept || billed : (row.expectedAmountCents ?? billed);
  return cents ? cents : null;
}

/** The day an issue dates from: the billing day it was expected on, else its earliest transaction. */
export function issueSinceDay(row: Pick<ScheduleRow, "expectedDate" | "transactions">): string | null {
  if (row.expectedDate) return row.expectedDate;
  return row.transactions.map((t) => t.day).sort()[0] ?? null;
}

function toIssue(schedule: PurchaseSchedule, row: ScheduleRow, member: ReturnType<BillingOverview["members"]["get"]>, today: string, acks: ReadonlyMap<string, AckRecord>, staff: ReadonlyMap<string, string>): Issue {
  const shown = member ? getMemberDisplayName({ name: member.name, display_name: member.displayName }) : schedule.memberId;
  const sinceDay = issueSinceDay(row);
  const what = schedule.purchase?.offerName ?? schedule.label;
  const amountCents = issueAmountCents(row);
  return {
    key: row.key,
    memberId: schedule.memberId,
    purchaseType: schedule.purchaseType,
    memberName: shown,
    legalName: member && member.name && member.name !== shown ? member.name : null,
    purchaseLabel: schedule.label,
    offerName: schedule.purchase && schedule.purchase.offerName !== schedule.label ? schedule.purchase.offerName : null,
    event: schedule.event ? { slug: schedule.event.slug, title: schedule.event.title } : null,
    status: row.status,
    statusLabel: ROW_STATUS_LABELS[row.status],
    group: issueGroupOf(schedule.purchaseType, row),
    cause: row.cause,
    reason: row.reason,
    amountCents,
    currency: row.currency,
    sinceDay,
    ageDays: ageInDays(sinceDay, today),
    hubStatus: member?.status ?? "",
    hubStatusLabel: member ? hubStatusLabel(member.status) : "",
    transactions: row.transactions.map((t) => ({
      id: t.invoiceId,
      day: t.day,
      description: `${what} ${t.kind === "charge" ? "payment" : "invoice"}`,
      billedCents: t.billedCents,
      keptCents: t.keptCents,
      refundedCents: t.refundedCents,
      statusLabel: ROW_STATUS_LABELS[transactionStatus(t)],
      attempts: t.attempts,
      failureCodes: t.failureCodes,
      stripeUrl: t.kind === "charge" ? stripeChargeUrl(t.invoiceId) : stripeInvoiceUrl(t.invoiceId),
    })),
    ack: ackViewFor({ key: row.key, status: row.status, amountCents }, acks.get(row.key), staff),
  };
}

/**
 * Every row that needs attention, one issue each, most urgent first (the acknowledged ones last). `acks` are the active
 * acknowledgements by row key and `staff` the labels of whoever made them; a row with one carries it, and `ack.state`
 * says whether it still applies.
 */
export function buildIssues(
  overview: Pick<BillingOverview, "schedules" | "members" | "today">,
  acks: ReadonlyMap<string, AckRecord> = new Map(),
  staff: ReadonlyMap<string, string> = new Map()
): Issue[] {
  const issues = overview.schedules.flatMap((schedule) =>
    schedule.rows.filter((r) => r.needsAttention).map((row) => toIssue(schedule, row, overview.members.get(schedule.memberId), overview.today, acks, staff))
  );
  return issues.sort(compareUrgency);
}

/**
 * The acknowledgement of each row of some schedules, by row key, for the member's own Transactions tab. Rows that
 * were never marked are left out; `state` is judged against the row as it is now, the same way the overview does.
 */
export function acknowledgementsForSchedules(schedules: readonly PurchaseSchedule[], acks: ReadonlyMap<string, AckRecord>, staff: ReadonlyMap<string, string> = new Map()): Record<string, AckView> {
  const out: Record<string, AckView> = {};
  for (const schedule of schedules) {
    for (const row of schedule.rows) {
      const view = ackViewFor({ key: row.key, status: row.status, amountCents: issueAmountCents(row) }, acks.get(row.key), staff);
      if (view) out[row.key] = view;
    }
  }
  return out;
}

// ---------------------------------------------------------------- urgency

/**
 * The default order: rows an acknowledgement settles come after the rest; then members who are behind (nothing paid since an unpaid invoice) first, then the most money at
 * stake, then the oldest, then by member name and key so the order never wobbles. Rows with no amount or age rank
 * after rows that have one.
 */
export function compareUrgency(
  a: Pick<Issue, "status" | "amountCents" | "ageDays" | "memberName" | "key"> & { ack?: AckView | null },
  b: Pick<Issue, "status" | "amountCents" | "ageDays" | "memberName" | "key"> & { ack?: AckView | null }
): number {
  const settled = Number(isAcknowledged(a.ack)) - Number(isAcknowledged(b.ack));
  if (settled !== 0) return settled;
  const behind = Number(b.status === "unpaid_behind") - Number(a.status === "unpaid_behind");
  if (behind !== 0) return behind;
  const amount = (b.amountCents ?? 0) - (a.amountCents ?? 0);
  if (amount !== 0) return amount;
  const age = (b.ageDays ?? -1) - (a.ageDays ?? -1);
  if (age !== 0) return age;
  return a.memberName.localeCompare(b.memberName) || a.key.localeCompare(b.key);
}

// ---------------------------------------------------------------- filtering

export interface IssueSelection {
  filter: IssueFilter;
  hub: HubStatusFilterId;
}

const inHubStatus = (issue: Issue, hub: HubStatusFilterId) => {
  const statuses = HUB_STATUS_FILTERS.find((f) => f.id === hub)?.statuses;
  return !statuses || (statuses as readonly string[]).includes(issue.hubStatus);
};

/** The issues a group chip (null: all) and a Hub status select down to. */
export function issuesIn(issues: Issue[], group: IssueGroupId | null, hub: HubStatusFilterId): Issue[] {
  return issues.filter((i) => (group === null || i.group === group) && inHubStatus(i, hub));
}

/** The issues the page shows: the chosen group (or the narrower old filter) and Hub status. */
export function selectIssues(issues: Issue[], selection: IssueSelection): Issue[] {
  const { filter, hub } = selection;
  return issuesIn(issues, filter.group, hub).filter((i) => !filter.legacy || filter.legacy.match(i));
}

/** Rows, members and money for the header. Money is summed per currency. */
export function issueTotals(issues: Issue[]): { rows: number; members: number; byCurrency: { currency: string; cents: number }[] } {
  const money = new Map<string, number>();
  for (const i of issues) if (i.amountCents) money.set(i.currency, (money.get(i.currency) ?? 0) + i.amountCents);
  return { rows: issues.length, members: new Set(issues.map((i) => i.memberId)).size, byCurrency: [...money].map(([currency, cents]) => ({ currency, cents })) };
}

// ---------------------------------------------------------------- acknowledgements

/** Splits issues into the ones still to look at and the ones an acknowledgement settles (`ack.state` "applies"). A row that changed since it was marked is back in the first. */
export function splitByAcknowledgement(issues: Issue[]): { open: Issue[]; acknowledged: Issue[] } {
  return { open: issues.filter((i) => !isAcknowledged(i.ack)), acknowledged: issues.filter((i) => isAcknowledged(i.ack)) };
}

/** `?ack=1` shows the acknowledged rows too; they are hidden by default. */
export const parseShowAcknowledged = (value: string | undefined): boolean => value === "1";
