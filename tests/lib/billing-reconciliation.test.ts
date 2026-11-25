import { describe, expect, it } from "vitest";
import {
  buildSchedules,
  easternDay,
  summarize,
  type ReconCharge,
  type ReconInput,
  type ReconInvoice,
  type ReconSubscription,
  type ReconWindow,
  type ScheduleRow,
} from "@/lib/billing-reconciliation";

const MEMBER = "mbr_AAAAAAAAAAA1";
const CUSTOMER = "cus_1";
const PRODUCT = "prod_member";

const invoice = (id: string, createdAt: string, extra: Partial<ReconInvoice> = {}): ReconInvoice => ({
  stripeInvoiceId: id,
  stripeCustomerId: CUSTOMER,
  stripeSubscriptionId: "sub_1",
  stripeProductId: PRODUCT,
  status: "paid",
  amountDueCents: 4700,
  amountPaidCents: 4700,
  currency: "usd",
  createdAt,
  attemptCount: 1,
  stripeChargeId: null,
  ...extra,
});
const charge = (id: string, invoiceId: string, extra: Partial<ReconCharge> = {}): ReconCharge => ({
  stripeChargeId: id,
  stripeCustomerId: CUSTOMER,
  stripeInvoiceId: invoiceId,
  status: "succeeded",
  amountCents: 4700,
  amountRefundedCents: 0,
  failureCode: null,
  ...extra,
});
const sub = (extra: Partial<ReconSubscription> = {}): ReconSubscription => ({
  stripeSubscriptionId: "sub_1",
  stripeCustomerId: CUSTOMER,
  status: "active",
  createdAt: "2026-01-09T15:00:00Z",
  canceledAt: null,
  billingAnchor: "2026-01-09T15:00:00Z",
  paused: false,
  ...extra,
});
const window = (startDate: string, endDate: string | null): ReconWindow => ({ memberId: MEMBER, startDate, endDate });

/** Paid invoices on the 9th at 10:00 Eastern from January to May. */
const monthly = (skip: string[] = []) =>
  ["01", "02", "03", "04", "05"].filter((m) => !skip.includes(m)).map((m) => invoice(`in_${m}`, `2026-${m}-09T15:00:00Z`));

const run = (over: Partial<ReconInput> = {}, status = "active") =>
  buildSchedules({
    today: "2026-05-20",
    members: [{ id: MEMBER, status, stripeCustomerIds: [CUSTOMER] }],
    membershipProductIds: new Set([PRODUCT]),
    invoices: monthly(),
    charges: [],
    subscriptions: [sub()],
    hiatuses: [],
    programWindows: [],
    ...over,
  });
const rowsOf = (over: Partial<ReconInput> = {}, status = "active"): ScheduleRow[] => run(over, status)[0]?.rows ?? [];
const byDate = (rows: ScheduleRow[], date: string) => rows.find((r) => r.expectedDate === date);

describe("easternDay", () => {
  it("splits at midnight Eastern, not UTC", () => {
    expect(easternDay("2026-03-09T03:30:00Z")).toBe("2026-03-08"); // 23:30 EDT
    expect(easternDay("2026-03-09T04:30:00Z")).toBe("2026-03-09"); // 00:30 EDT
    expect(easternDay("2026-01-10T04:30:00Z")).toBe("2026-01-09"); // 23:30 EST
    expect(easternDay("2026-01-10T05:30:00Z")).toBe("2026-01-10"); // 00:30 EST
  });

  it("handles the days the clocks change", () => {
    expect(easternDay("2026-03-08T06:59:00Z")).toBe("2026-03-08"); // 01:59 EST, before spring forward
    expect(easternDay("2026-03-08T07:00:00Z")).toBe("2026-03-08"); // 03:00 EDT
    expect(easternDay("2026-11-01T05:30:00Z")).toBe("2026-11-01"); // 01:30 EDT
    expect(easternDay("2026-11-01T06:30:00Z")).toBe("2026-11-01"); // 01:30 EST, the repeated hour
    expect(easternDay("2026-11-02T04:59:00Z")).toBe("2026-11-01"); // 23:59 EST
    expect(easternDay("2026-11-02T05:00:00Z")).toBe("2026-11-02");
  });
});

describe("a member who pays every month", () => {
  it("has a paid row per billing day and nothing to look at", () => {
    const rows = rowsOf();
    expect(rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ["2026-01-09", "paid"],
      ["2026-02-09", "paid"],
      ["2026-03-09", "paid"],
      ["2026-04-09", "paid"],
      ["2026-05-09", "paid"],
    ]);
    expect(rows.every((r) => !r.needsAttention)).toBe(true);
    expect(rows[1]).toMatchObject({ expectedAmountCents: 4700, month: "2026-02", reason: "$47.00 paid on 2026-02-09." });
  });

  it("gives each row a stable key by member, purchase and month", () => {
    expect(rowsOf().map((r) => r.key)).toEqual(["01", "02", "03", "04", "05"].map((m) => `${MEMBER}:membership:2026-${m}`));
  });

  it("ignores invoices for other products, and members with no customer", () => {
    expect(rowsOf({ invoices: [...monthly(), invoice("in_x", "2026-02-11T15:00:00Z", { stripeProductId: "prod_retreat" })] }).some((r) => r.status === "unexpected")).toBe(false);
    expect(run({ members: [{ id: MEMBER, status: "active", stripeCustomerIds: [] }] })).toEqual([]);
  });

  it("matches a payment a few days off its billing day, and each payment only once", () => {
    const rows = rowsOf({ invoices: [invoice("in_01", "2026-01-09T15:00:00Z"), invoice("in_02", "2026-02-12T15:00:00Z"), invoice("in_02b", "2026-02-12T16:00:00Z")] });
    expect(byDate(rows, "2026-02-09")?.status).toBe("paid");
    expect(byDate(rows, "2026-02-09")?.transactions[0].invoiceId).toBe("in_02");
    expect(rows.filter((r) => r.status === "unexpected").map((r) => r.transactions[0].invoiceId)).toEqual(["in_02b"]);
  });

  it("names a payment far from any billing day as unexpected", () => {
    const rows = rowsOf({ invoices: [...monthly(), invoice("in_extra", "2026-03-23T15:00:00Z")] });
    const extra = rows.find((r) => r.status === "unexpected");
    expect(extra).toMatchObject({ expectedDate: null, expectedAmountCents: null, month: "2026-03", needsAttention: true });
    expect(extra?.key).toBe(`${MEMBER}:membership:2026-03:2`);
  });
});

describe("missed billing", () => {
  it("flags an active member's billing day with no invoice, but not a cancelled member's", () => {
    const rows = rowsOf({ invoices: monthly(["03"]) });
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "missed", needsAttention: true, reason: "Billing was due on 2026-03-09 but Stripe made no membership invoice." });
    expect(byDate(rowsOf({ invoices: monthly(["03"]) }, "cancelled"), "2026-03-09")).toMatchObject({ status: "missed", needsAttention: false });
  });

  it("says when only a draft or void invoice exists", () => {
    const draft = rowsOf({ invoices: [...monthly(["03"]), invoice("in_d", "2026-03-09T15:00:00Z", { status: "draft", amountPaidCents: 0 })] });
    expect(byDate(draft, "2026-03-09")?.reason).toContain("draft");
    const voided = rowsOf({ invoices: [...monthly(["03"]), invoice("in_v", "2026-03-09T15:00:00Z", { status: "void", amountPaidCents: 0 })] });
    expect(byDate(voided, "2026-03-09")?.reason).toContain("void");
  });

  it("expects nothing from a paused subscription", () => {
    const rows = rowsOf({ subscriptions: [sub({ paused: true })], invoices: monthly(["04"]) });
    expect(byDate(rows, "2026-04-09")).toMatchObject({ status: "not_expected", needsAttention: false });
  });

  it("stops expecting payments once the subscription is cancelled, and never before it began", () => {
    const rows = rowsOf({ subscriptions: [sub({ status: "canceled", canceledAt: "2026-03-20T15:00:00Z" })], invoices: monthly(["04", "05"]) });
    expect(rows.map((r) => r.expectedDate)).toEqual(["2026-01-09", "2026-02-09", "2026-03-09"]);
    expect(rowsOf({ subscriptions: [sub({ createdAt: "2026-03-20T15:00:00Z", billingAnchor: "2026-03-20T15:00:00Z" })], invoices: [] }).map((r) => r.expectedDate)).toEqual(["2026-03-20", "2026-04-20"]);
  });

  it("does not expect today's billing day yet", () => {
    expect(rowsOf({ today: "2026-05-09" }).some((r) => r.expectedDate === "2026-05-09")).toBe(false);
  });

  it("clamps a billing day of the 31st to the end of a short month", () => {
    const rows = rowsOf({
      subscriptions: [sub({ createdAt: "2026-01-31T15:00:00Z", billingAnchor: "2026-01-31T15:00:00Z" })],
      invoices: [invoice("in_1", "2026-01-31T15:00:00Z"), invoice("in_2", "2026-02-28T15:00:00Z")],
    });
    expect(rows.slice(0, 3).map((r) => [r.expectedDate, r.status])).toEqual([
      ["2026-01-31", "paid"],
      ["2026-02-28", "paid"],
      ["2026-03-31", "missed"],
    ]);
  });
});

describe("hiatus", () => {
  it("does not expect a payment strictly inside a hiatus, and flags one that was taken", () => {
    const hiatuses = [window("2026-02-20", "2026-04-15")];
    const quiet = rowsOf({ hiatuses, invoices: monthly(["03"]) });
    expect(byDate(quiet, "2026-03-09")).toMatchObject({ status: "not_expected", needsAttention: false });
    const charged = rowsOf({ hiatuses });
    expect(byDate(charged, "2026-03-09")).toMatchObject({ status: "charged_when_not_expected", needsAttention: true });
    expect(byDate(charged, "2026-03-09")?.reason).toContain("on hiatus");
  });

  it("flags a payment on a day that is no billing day too", () => {
    const rows = rowsOf({ hiatuses: [window("2026-02-20", "2026-04-15")], invoices: [...monthly(["03"]), invoice("in_x", "2026-03-24T15:00:00Z")] });
    expect(rows.find((r) => r.transactions[0]?.invoiceId === "in_x")).toMatchObject({ status: "charged_when_not_expected", expectedDate: null });
  });

  it("neither expects nor flags the billing day a hiatus ends on (the resume charge)", () => {
    const hiatuses = [window("2026-02-20", "2026-04-09")];
    expect(byDate(rowsOf({ hiatuses }), "2026-04-09")).toMatchObject({ status: "paid", needsAttention: false });
    expect(byDate(rowsOf({ hiatuses, invoices: monthly(["04"]) }), "2026-04-09")).toMatchObject({ status: "not_expected", needsAttention: false });
  });

  it("neither expects nor flags the billing day a hiatus starts on", () => {
    const hiatuses = [window("2026-03-09", "2026-04-20")];
    expect(byDate(rowsOf({ hiatuses }), "2026-03-09")).toMatchObject({ status: "paid", needsAttention: false });
    expect(byDate(rowsOf({ hiatuses, invoices: monthly(["03"]) }), "2026-03-09")).toMatchObject({ status: "not_expected", needsAttention: false });
    // The one after the start is inside.
    expect(byDate(rowsOf({ hiatuses }), "2026-04-09")?.status).toBe("charged_when_not_expected");
  });

  it("counts an open-ended hiatus as running to today", () => {
    expect(byDate(rowsOf({ hiatuses: [window("2026-04-01", null)] }), "2026-05-09")?.status).toBe("charged_when_not_expected");
  });

  it("reads the day in Eastern time: 23:30 on the last hiatus day is inside, 00:30 the next day is the end day", () => {
    const hiatuses = [window("2026-02-20", "2026-04-20")];
    // 23:30 EDT on the 19th (03:30Z on the 20th) is inside the hiatus.
    const late = rowsOf({ hiatuses, invoices: [...monthly(["04"]), invoice("in_late", "2026-04-20T03:30:00Z")] });
    expect(late.find((r) => r.transactions[0]?.invoiceId === "in_late")).toMatchObject({ status: "charged_when_not_expected", month: "2026-04" });
    // 00:30 EDT on the 20th is the end day itself: not flagged.
    const early = rowsOf({ hiatuses, invoices: [...monthly(["04"]), invoice("in_early", "2026-04-20T04:30:00Z")] });
    expect(early.find((r) => r.transactions[0]?.invoiceId === "in_early")?.status).toBe("unexpected");
  });

  it("keeps the billing day across the spring daylight saving change", () => {
    // Anchored at 02:30 Eastern on the 8th of March: the charge of the 8th lands on the 8th either side of the change.
    const rows = rowsOf({
      subscriptions: [sub({ createdAt: "2026-02-08T07:30:00Z", billingAnchor: "2026-02-08T07:30:00Z" })],
      invoices: [invoice("in_a", "2026-02-08T07:30:00Z"), invoice("in_b", "2026-03-08T07:30:00Z"), invoice("in_c", "2026-04-08T06:30:00Z")],
      today: "2026-04-20",
    });
    expect(rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ["2026-02-08", "paid"],
      ["2026-03-08", "paid"],
      ["2026-04-08", "paid"],
    ]);
  });
});

describe("refunds and failures", () => {
  it("marks a payment refunded in full as refunded, and a partial refund stays paid", () => {
    const full = rowsOf({
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { stripeChargeId: "ch_03" })],
      charges: [charge("ch_03", "in_03", { amountRefundedCents: 4700 })],
    });
    expect(byDate(full, "2026-03-09")).toMatchObject({ status: "refunded", needsAttention: false });
    const part = rowsOf({
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z")],
      charges: [charge("ch_03", "in_03", { amountRefundedCents: 1000 })],
    });
    expect(byDate(part, "2026-03-09")).toMatchObject({ status: "paid", reason: "$37.00 paid on 2026-03-09; $10.00 was refunded." });
  });

  it("does not flag a refunded payment inside a hiatus", () => {
    const rows = rowsOf({
      hiatuses: [window("2026-02-20", "2026-04-15")],
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z")],
      charges: [charge("ch_03", "in_03", { amountRefundedCents: 4700 })],
    });
    expect(byDate(rows, "2026-03-09")?.status).toBe("refunded");
  });

  it("shows a failed charge that was retried and paid as paid, with the tries", () => {
    const rows = rowsOf({
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { attemptCount: 3 })],
      charges: [charge("ch_a", "in_03", { status: "failed", failureCode: "card_declined", amountRefundedCents: 0 }), charge("ch_b", "in_03")],
    });
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "paid", needsAttention: false });
    expect(byDate(rows, "2026-03-09")?.reason).toBe("$47.00 paid on 2026-03-09 after 3 tries (earlier: card_declined).");
  });

  it("separates open (unpaid, no declined charge) from failed (declined, or written off)", () => {
    const open = rowsOf({ invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "open", amountPaidCents: 0 })] });
    expect(byDate(open, "2026-03-09")).toMatchObject({ status: "open", needsAttention: true });
    const declined = rowsOf({
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "open", amountPaidCents: 0, attemptCount: 2 })],
      charges: [charge("ch_a", "in_03", { status: "failed", failureCode: "insufficient_funds" })],
    });
    expect(byDate(declined, "2026-03-09")).toMatchObject({ status: "failed", needsAttention: true });
    expect(byDate(declined, "2026-03-09")?.reason).toContain("insufficient_funds");
    const lost = rowsOf({ invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "uncollectible", amountPaidCents: 0 })] });
    expect(byDate(lost, "2026-03-09")?.status).toBe("failed");
  });

  it("does not raise failed or open for a member who is not active", () => {
    const rows = rowsOf({ invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "open", amountPaidCents: 0 })] }, "cancelled");
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "open", needsAttention: false });
  });

  it("joins a charge to its invoice from either side", () => {
    const rows = rowsOf({
      invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { stripeChargeId: "ch_03" })],
      charges: [{ ...charge("ch_03", "in_03", { amountRefundedCents: 4700 }), stripeInvoiceId: null }],
    });
    expect(byDate(rows, "2026-03-09")?.status).toBe("refunded");
  });
});

describe("programs that include membership", () => {
  const program = [window("2026-02-01", "2026-03-15")];

  it("does not expect a payment inside a program, flags one taken, and expects billing again after it", () => {
    const rows = rowsOf({ programWindows: program, invoices: monthly(["03"]) });
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "not_expected", reason: expect.stringContaining("program") });
    expect(byDate(rows, "2026-02-09")).toMatchObject({ status: "charged_when_not_expected", needsAttention: true });
    expect(byDate(rows, "2026-02-09")?.reason).toContain("in a program that includes membership");
    expect(byDate(rows, "2026-04-09")).toMatchObject({ status: "paid" });
    expect(byDate(rowsOf({ programWindows: program, invoices: monthly(["03", "04"]) }), "2026-04-09")?.status).toBe("missed");
  });

  it("treats the program's first and last day like a hiatus's: neither expected nor flagged", () => {
    const rows = rowsOf({ programWindows: [window("2026-02-09", "2026-04-09")] });
    expect(byDate(rows, "2026-02-09")).toMatchObject({ status: "paid", needsAttention: false });
    expect(byDate(rows, "2026-04-09")).toMatchObject({ status: "paid", needsAttention: false });
    expect(byDate(rows, "2026-03-09")?.status).toBe("charged_when_not_expected");
  });

  it("reports a program that ended with no membership billing after it (no subscription)", () => {
    const rows = rowsOf({ programWindows: [window("2026-01-01", "2026-04-30")], subscriptions: [], invoices: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "missed", expectedDate: "2026-04-30", needsAttention: true });
    expect(rows[0].reason).toContain("there is no Stripe subscription");
  });

  it("explains a still-paused or cancelled subscription, and stays quiet within the grace days or once billed", () => {
    const programWindows = [window("2026-01-01", "2026-04-30")];
    expect(rowsOf({ programWindows, subscriptions: [sub({ paused: true })], invoices: [] }).find((r) => r.expectedDate === "2026-04-30")?.reason).toContain("still paused");
    expect(rowsOf({ programWindows, subscriptions: [sub({ status: "canceled", canceledAt: "2026-01-02T15:00:00Z" })], invoices: [] }).find((r) => r.expectedDate === "2026-04-30")?.reason).toContain("cancelled");
    expect(rowsOf({ today: "2026-05-03", programWindows, subscriptions: [], invoices: [] })).toEqual([]);
    expect(rowsOf({ programWindows, subscriptions: [], invoices: [invoice("in_p", "2026-05-01T15:00:00Z")] }).some((r) => r.status === "missed")).toBe(false);
    expect(rowsOf({ programWindows: [window("2026-01-01", null)], subscriptions: [], invoices: [] })).toEqual([]);
    expect(rowsOf({ programWindows, subscriptions: [], invoices: [] }, "cancelled")).toEqual([]);
  });

  it("leaves a live subscription's missed billing days to the rows of those days", () => {
    const rows = rowsOf({ programWindows: [window("2026-01-01", "2026-04-01")], invoices: monthly(["05"]) });
    expect(rows.filter((r) => r.status === "missed").map((r) => r.expectedDate)).toEqual(["2026-05-09"]);
  });
});

describe("summary", () => {
  it("counts rows per status and the members who need a look", () => {
    const schedules = run({ invoices: monthly(["03"]) });
    const summary = summarize(schedules);
    expect(summary.byStatus.paid).toBe(4);
    expect(summary.byStatus.missed).toBe(1);
    expect(summary).toMatchObject({ needsAttention: 1, membersWithProblems: 1 });
  });

  it("describes the schedule: the purchase, its dates and a cancelled end", () => {
    const [schedule] = run({ subscriptions: [sub({ status: "canceled", canceledAt: "2026-03-20T15:00:00Z" })], invoices: monthly(["04", "05"]) });
    expect(schedule).toMatchObject({ purchaseType: "membership", label: "Membership", memberId: MEMBER, start: "2026-01-09", end: "2026-03-20" });
    expect(run({})[0]).toMatchObject({ start: "2026-01-09", end: null });
  });

  it("builds nothing for a member with no billing at all", () => {
    expect(run({ invoices: [], subscriptions: [] })).toEqual([]);
  });
});
