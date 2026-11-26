import { describe, it, expect } from "vitest";
import {
  ISSUE_GROUPS,
  LEGACY_FILTERS,
  ageInDays,
  buildIssues,
  compareUrgency,
  daysBetween,
  hubStatusLabel,
  issueAmountCents,
  issueGroupOf,
  issueSinceDay,
  issueTotals,
  parseHubStatusFilter,
  parseIssueFilter,
  selectIssues,
  type Issue,
} from "@/lib/billing-issues";
import { ROW_STATUSES, easternDay, type PurchaseSchedule, type ScheduleRow, type ScheduleTransaction } from "@/lib/billing-reconciliation";

const MEMBER = "mbr_AAAAAAAAAAA1";

const tx = (id: string, day: string, extra: Partial<ScheduleTransaction> = {}): ScheduleTransaction => ({
  invoiceId: id,
  chargeIds: [],
  day,
  billedCents: 4700,
  keptCents: 0,
  refundedCents: 0,
  invoiceStatus: "open",
  failureCodes: [],
  attempts: 0,
  ...extra,
});
const row = (key: string, status: ScheduleRow["status"], extra: Partial<ScheduleRow> = {}): ScheduleRow => ({
  key,
  expectedDate: null,
  expectedAmountCents: null,
  month: "2026-03",
  status,
  reason: "r",
  needsAttention: true,
  cause: null,
  transactions: [],
  currency: "usd",
  ...extra,
});
const issue = (key: string, extra: Partial<Issue> = {}): Issue => ({
  key,
  memberId: MEMBER,
  memberName: "Ada",
  legalName: null,
  purchaseLabel: "Membership",
  offerName: null,
  event: null,
  status: "missed",
  statusLabel: "Missed",
  group: "collect",
  cause: null,
  reason: "r",
  amountCents: null,
  currency: "usd",
  sinceDay: null,
  ageDays: null,
  hubStatus: "active",
  hubStatusLabel: "Active",
  transactions: [],
  ...extra,
});

describe("days and age", () => {
  it("counts calendar days between Eastern days", () => {
    expect(daysBetween("2026-05-09", "2026-06-01")).toBe(23);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("is not thrown off by a daylight saving change (a 23 or 25 hour day)", () => {
    // Spring forward: Sunday 2026-03-08. Fall back: Sunday 2026-11-01.
    expect(ageInDays("2026-03-07", "2026-03-09")).toBe(2);
    expect(ageInDays("2026-03-08", "2026-03-09")).toBe(1);
    expect(ageInDays("2026-10-31", "2026-11-02")).toBe(2);
    expect(ageInDays("2026-11-01", "2026-11-02")).toBe(1);
    expect(ageInDays("2026-03-01", "2026-04-01")).toBe(31);
    expect(ageInDays("2026-10-01", "2026-12-01")).toBe(61);
  });

  it("reads today as the Eastern day, so 23:30 and 00:30 Eastern are a day apart whatever the server's zone", () => {
    // 2026-06-01 23:30 EDT is 2026-06-02 03:30 UTC; 00:30 EDT on the 2nd is 04:30 UTC.
    const lateEvening = easternDay("2026-06-02T03:30:00Z");
    const afterMidnight = easternDay("2026-06-02T04:30:00Z");
    expect(lateEvening).toBe("2026-06-01");
    expect(afterMidnight).toBe("2026-06-02");
    expect(ageInDays("2026-05-09", lateEvening)).toBe(23);
    expect(ageInDays("2026-05-09", afterMidnight)).toBe(24);
    // The same across the fall-back night: 00:30 EST on 2026-11-02 is 05:30 UTC, 23:30 EST on the 1st is 04:30 UTC.
    expect(ageInDays("2026-10-01", easternDay("2026-11-02T04:30:00Z"))).toBe(31);
    expect(ageInDays("2026-10-01", easternDay("2026-11-02T05:30:00Z"))).toBe(32);
  });

  it("has no age without a day, and never a negative one", () => {
    expect(ageInDays(null, "2026-06-01")).toBeNull();
    expect(ageInDays("2026-06-05", "2026-06-01")).toBe(0);
  });

  it("dates an issue from its expected day, else its earliest transaction, else none", () => {
    expect(issueSinceDay({ expectedDate: "2026-04-09", transactions: [tx("a", "2026-04-11")] })).toBe("2026-04-09");
    expect(issueSinceDay({ expectedDate: null, transactions: [tx("a", "2026-05-02"), tx("b", "2026-04-02")] })).toBe("2026-04-02");
    expect(issueSinceDay({ expectedDate: null, transactions: [] })).toBeNull();
  });
});

describe("the amount at stake", () => {
  it("is what was billed and not collected for an unpaid row, the whole run", () => {
    expect(issueAmountCents(row("a", "unpaid_behind", { expectedAmountCents: 1, transactions: [tx("i1", "2026-04-09"), tx("i2", "2026-05-09")] }))).toBe(9400);
    expect(issueAmountCents(row("a", "unpaid_earlier", { expectedAmountCents: 4700, transactions: [] }))).toBe(4700);
  });

  it("is what was kept for a payment that should not have happened", () => {
    expect(issueAmountCents(row("a", "charged_when_not_expected", { transactions: [tx("i1", "2026-04-09", { invoiceStatus: "paid", keptCents: 4200, billedCents: 4700 })] }))).toBe(4200);
    expect(issueAmountCents(row("a", "unexpected", { transactions: [tx("i1", "2026-04-09", { invoiceStatus: "paid", keptCents: 0, billedCents: 4700, refundedCents: 4700 })] }))).toBe(4700);
  });

  it("is the expected amount for a missing payment, else what its transactions billed, else nothing", () => {
    expect(issueAmountCents(row("a", "missed", { expectedAmountCents: 4700 }))).toBe(4700);
    expect(issueAmountCents(row("a", "missing_payment", { expectedAmountCents: 50000 }))).toBe(50000);
    expect(issueAmountCents(row("a", "missing_payment", { expectedAmountCents: null, transactions: [tx("i1", "2026-04-09")] }))).toBe(4700);
    expect(issueAmountCents(row("a", "hub_stripe_disagree"))).toBeNull();
    expect(issueAmountCents(row("a", "unrecorded_gap", { expectedAmountCents: 0 }))).toBeNull();
  });
});

describe("groups", () => {
  it("puts every status that needs attention in exactly one group, and every group is reachable", () => {
    const seen = new Set<string>();
    for (const status of ROW_STATUSES) {
      for (const type of ["membership", "event"] as const) {
        const group = issueGroupOf(type, { status, cause: null });
        expect(ISSUE_GROUPS.map((g) => g.id)).toContain(group);
        seen.add(group);
      }
    }
    expect([...seen].sort()).toEqual(ISSUE_GROUPS.map((g) => g.id).sort());
  });

  it("sorts rows into the groups staff act on", () => {
    expect(issueGroupOf("membership", { status: "unpaid_behind", cause: null })).toBe("collect");
    expect(issueGroupOf("membership", { status: "unpaid_earlier", cause: null })).toBe("collect");
    expect(issueGroupOf("membership", { status: "missed", cause: null })).toBe("collect");
    expect(issueGroupOf("membership", { status: "missed", cause: "after_hiatus" })).toBe("hiatus");
    expect(issueGroupOf("membership", { status: "missed", cause: "program" })).toBe("hiatus");
    expect(issueGroupOf("membership", { status: "charged_when_not_expected", cause: "pause" })).toBe("hiatus");
    expect(issueGroupOf("membership", { status: "hiatus_mismatch", cause: "hiatus_billing_day" })).toBe("hiatus");
    expect(issueGroupOf("membership", { status: "unrecorded_gap", cause: "gap" })).toBe("hiatus");
    expect(issueGroupOf("membership", { status: "hub_stripe_disagree", cause: "hiatus" })).toBe("disagree");
    expect(issueGroupOf("event", { status: "missing_payment", cause: "event" })).toBe("purchases");
    expect(issueGroupOf("course", { status: "granted_no_override", cause: "granted" })).toBe("purchases");
    expect(issueGroupOf("event", { status: "paid_override_missing", cause: "granted" })).toBe("purchases");
    expect(issueGroupOf("event", { status: "unexplained_payment", cause: "event" })).toBe("purchases");
    expect(issueGroupOf("membership", { status: "unexpected", cause: null })).toBe("unexpected");
    expect(issueGroupOf("event", { status: "unexpected", cause: "granted" })).toBe("unexpected");
  });

  it("keeps the old filter ids, and a group id wins over an old one of the same name", () => {
    expect(LEGACY_FILTERS.map((f) => f.id)).toEqual(expect.arrayContaining(["behind", "paying_again", "payment", "missed", "charged_hiatus", "missed_after_hiatus", "unrecorded_gap", "hiatus_mismatch", "billing_day", "program", "missing_payment", "unexplained_payment", "granted"]));
    expect(parseIssueFilter("collect")).toEqual({ group: "collect", legacy: null });
    expect(parseIssueFilter("disagree")).toEqual({ group: "disagree", legacy: null });
    expect(parseIssueFilter("unexpected")).toEqual({ group: "unexpected", legacy: null });
    expect(parseIssueFilter("behind")).toMatchObject({ group: null, legacy: { id: "behind" } });
    expect(parseIssueFilter("nonsense")).toEqual({ group: null, legacy: null });
    expect(parseIssueFilter(undefined)).toEqual({ group: null, legacy: null });
    expect(parseHubStatusFilter("hiatus")).toBe("hiatus");
    expect(parseHubStatusFilter("x")).toBe("all");
  });

  it("names the Hub's statuses", () => {
    expect(hubStatusLabel("on_hiatus")).toBe("On hiatus");
    expect(hubStatusLabel("alumni_gone")).toBe("alumni gone");
  });
});

describe("urgency order", () => {
  const order = (issues: Issue[]) => [...issues].sort(compareUrgency).map((i) => i.key);

  it("puts members who are behind first, whatever the amount or age", () => {
    const issues = [
      issue("big-old", { status: "unpaid_earlier", amountCents: 90000, ageDays: 400 }),
      issue("behind-small", { status: "unpaid_behind", amountCents: 100, ageDays: 1 }),
    ];
    expect(order(issues)).toEqual(["behind-small", "big-old"]);
  });

  it("then the largest amount, then the oldest", () => {
    const issues = [
      issue("old-small", { amountCents: 4700, ageDays: 300 }),
      issue("new-big", { amountCents: 50000, ageDays: 2 }),
      issue("old-same", { amountCents: 4700, ageDays: 400 }),
      issue("behind-b", { status: "unpaid_behind", amountCents: 4700, ageDays: 10 }),
      issue("behind-a", { status: "unpaid_behind", amountCents: 9400, ageDays: 5 }),
    ];
    expect(order(issues)).toEqual(["behind-a", "behind-b", "new-big", "old-same", "old-small"]);
  });

  it("puts rows with no amount or age after those with one, then by name and key so the order is stable", () => {
    const issues = [
      issue("z", { memberName: "Zed" }),
      issue("b2", { memberName: "Bea", amountCents: null, ageDays: 3 }),
      issue("a", { memberName: "Ada" }),
      issue("b1", { memberName: "Bea" }),
      issue("has-amount", { amountCents: 100, ageDays: null }),
    ];
    expect(order(issues)).toEqual(["has-amount", "b2", "a", "b1", "z"]);
  });
});

describe("buildIssues and selecting", () => {
  const schedule = (rows: ScheduleRow[], extra: Partial<PurchaseSchedule> = {}): PurchaseSchedule => ({ purchaseType: "membership", label: "Membership", memberId: MEMBER, start: null, end: null, notes: [], rows, ...extra });
  const overview = (schedules: PurchaseSchedule[], member = { id: MEMBER, name: "Ada Example", displayName: "Ada E." as string | null, status: "active" }) => ({ schedules, members: new Map([[MEMBER, member]]), today: "2026-06-01" });

  it("makes one issue per row that needs attention, with amount, age and the member as shown, keeping the row's key", () => {
    const issues = buildIssues(
      overview([
        schedule([
          row("k1", "unpaid_behind", { expectedDate: "2026-04-09", transactions: [tx("in_1", "2026-04-09", { attempts: 1, failureCodes: ["card_declined"] })] }),
          row("k2", "paid", { needsAttention: false }),
          row("k3", "hub_stripe_disagree", { reason: "disagree" }),
        ]),
      ])
    );
    expect(issues.map((i) => i.key)).toEqual(["k1", "k3"]);
    expect(issues[0]).toMatchObject({
      memberName: "Ada E.",
      legalName: "Ada Example",
      amountCents: 4700,
      ageDays: 53,
      sinceDay: "2026-04-09",
      group: "collect",
      hubStatusLabel: "Active",
      statusLabel: "Unpaid, behind",
    });
    expect(issues[0].transactions[0]).toMatchObject({ id: "in_1", stripeUrl: "https://dashboard.stripe.com/invoices/in_1", description: "Membership invoice", statusLabel: "Failed" });
    expect(issues[1]).toMatchObject({ amountCents: null, ageDays: null, sinceDay: null });
  });

  it("shows the legal name only where it differs from the name shown, and a charge links to Stripe's payment page", () => {
    const [plain] = buildIssues(overview([schedule([row("k", "unexpected", { transactions: [tx("ch_1", "2026-05-01", { kind: "charge", invoiceStatus: "paid", keptCents: 100 })] })])], { id: MEMBER, name: "Ada Example", displayName: null, status: "on_hiatus" }));
    expect(plain.memberName).toBe("Ada Example");
    expect(plain.legalName).toBeNull();
    expect(plain.hubStatusLabel).toBe("On hiatus");
    expect(plain.transactions[0]).toMatchObject({ stripeUrl: "https://dashboard.stripe.com/payments/ch_1", description: "Membership payment" });
  });

  it("falls back to the member id when the member is unknown, and names the offer of a purchase", () => {
    const issues = buildIssues({
      today: "2026-06-01",
      members: new Map(),
      schedules: [schedule([row("k", "missing_payment")], { purchaseType: "event", label: "Retreat", purchase: { purchaseId: "p", offerName: "Retreat ticket", priceText: null, day: null, amountCents: null, quantity: 1, granted: false, status: "active" }, event: { id: "e", slug: "retreat", title: "Retreat" } })],
    });
    expect(issues[0]).toMatchObject({ memberName: MEMBER, legalName: null, hubStatus: "", offerName: "Retreat ticket", event: { slug: "retreat", title: "Retreat" } });
  });

  it("selects by group, old filter and Hub status, and totals rows, members and money", () => {
    const issues = [
      issue("a", { group: "collect", status: "unpaid_behind", amountCents: 9400, memberId: "m1" }),
      issue("b", { group: "collect", status: "missed", amountCents: 4700, memberId: "m1", hubStatus: "on_hiatus" }),
      issue("c", { group: "disagree", status: "hub_stripe_disagree", memberId: "m2", hubStatus: "cancelled" }),
      issue("d", { group: "purchases", status: "missing_payment", amountCents: 100, currency: "eur", memberId: "m3" }),
    ];
    const keys = (group: Parameters<typeof selectIssues>[1]["filter"], hub: "all" | "active" | "hiatus" | "cancelled" = "all") => selectIssues(issues, { filter: group, hub }).map((i) => i.key);
    expect(keys(parseIssueFilter(undefined))).toEqual(["a", "b", "c", "d"]);
    expect(keys(parseIssueFilter("collect"))).toEqual(["a", "b"]);
    expect(keys(parseIssueFilter("behind"))).toEqual(["a"]);
    expect(keys(parseIssueFilter("collect"), "active")).toEqual(["a"]);
    expect(keys(parseIssueFilter(undefined), "hiatus")).toEqual(["b"]);
    expect(keys(parseIssueFilter(undefined), "cancelled")).toEqual(["c"]);
    expect(issueTotals(issues)).toEqual({
      rows: 4,
      members: 3,
      byCurrency: [
        { currency: "usd", cents: 14100 },
        { currency: "eur", cents: 100 },
      ],
    });
    expect(issueTotals([])).toEqual({ rows: 0, members: 0, byCurrency: [] });
  });
});
