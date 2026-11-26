import { describe, expect, it } from "vitest";
import {
  SHORT_PAUSE_MAX_BILLING_PERIODS,
  auditHiatuses,
  buildSchedules,
  easternDay,
  inferBillingGaps,
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
    expect(rows.filter((r) => r.status !== "hub_stripe_disagree").map((r) => r.expectedDate)).toEqual(["2026-01-09", "2026-02-09", "2026-03-09"]);
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

  it("words an unpaid invoice by what Stripe did: still unpaid, declined, or written off", () => {
    const unpaid = (extra: Partial<ReconInvoice>, charges: ReconCharge[] = []) =>
      byDate(rowsOf({ invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "open", amountPaidCents: 0, ...extra })], charges }), "2026-03-09");
    // A payment came after it (April, May), so the member is paying again.
    expect(unpaid({})).toMatchObject({ status: "unpaid_earlier", needsAttention: true });
    expect(unpaid({})?.reason).toContain("$47.00 invoiced on 2026-03-09 is still unpaid after 1 try.");
    const declined = unpaid({ attemptCount: 2 }, [charge("ch_a", "in_03", { status: "failed", failureCode: "insufficient_funds" })]);
    expect(declined?.reason).toContain("the card was declined (insufficient_funds) after 2 tries.");
    expect(unpaid({ status: "uncollectible" })?.reason).toContain("was written off as uncollectible after 1 try.");
  });

  it("does not raise an unpaid row for a member who is not active", () => {
    const rows = rowsOf({ invoices: [...monthly(["03"]), invoice("in_03", "2026-03-09T15:00:00Z", { status: "open", amountPaidCents: 0 })] }, "cancelled");
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "unpaid_earlier", needsAttention: false });
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

const disagree = (rows: ScheduleRow[]) => rows.find((r) => r.status === "hub_stripe_disagree");

describe("what Stripe says about now", () => {
  it("expects billing again from a pause's resume day, not before", () => {
    const rows = rowsOf({
      subscriptions: [sub({ paused: true, pauseBehavior: "void", pauseResumesAt: "2026-04-20T15:00:00Z" })],
      invoices: monthly(["02", "03", "04", "05"]),
    });
    expect(byDate(rows, "2026-03-09")).toMatchObject({ status: "not_expected", reason: expect.stringContaining("paused in Stripe until 2026-04-20") });
    expect(byDate(rows, "2026-04-09")?.status).toBe("not_expected");
    expect(byDate(rows, "2026-05-09")).toMatchObject({ status: "missed", needsAttention: true });
  });

  it("expects no further billing from an indefinite pause, so nothing is missed", () => {
    const rows = rowsOf({ subscriptions: [sub({ paused: true, pauseBehavior: "void", pauseResumesAt: null })], invoices: monthly(["03", "04", "05"]) });
    expect(rows.filter((r) => r.status === "missed")).toEqual([]);
    expect(byDate(rows, "2026-05-09")?.reason).toContain("no resume date");
  });

  it("stops expecting billing for a cancelled subscription and says when the Hub still calls the member active", () => {
    const rows = rowsOf({ subscriptions: [sub({ status: "canceled", canceledAt: "2026-03-20T15:00:00Z" })], invoices: monthly(["04", "05"]) });
    expect(rows.filter((r) => r.status === "missed")).toEqual([]);
    expect(disagree(rows)?.reason).toBe("The Hub says the member is active, but every Stripe subscription is cancelled.");
    expect(disagree(rowsOf({ subscriptions: [sub({ status: "canceled", canceledAt: "2026-03-20T15:00:00Z" })], invoices: monthly(["04", "05"]) }, "cancelled"))).toBeUndefined();
  });

  it("flags a Hub hiatus whose subscription is not paused", () => {
    const rows = rowsOf({ hiatuses: [window("2026-05-01", "2026-06-10")] });
    expect(disagree(rows)).toMatchObject({ needsAttention: true, cause: "hiatus", reason: expect.stringContaining("not paused and will keep billing") });
    expect(disagree(rowsOf({}, "on_hiatus"))?.reason).toContain("not paused");
  });

  it("flags a paused subscription the Hub has no hiatus for, but not one inside a program or a cancelled member's", () => {
    const paused = sub({ paused: true, pauseResumesAt: "2026-08-10T15:00:00Z" });
    expect(disagree(rowsOf({ subscriptions: [paused] }))?.reason).toBe("The Stripe subscription is paused, but the Hub has no hiatus covering today.");
    expect(disagree(rowsOf({ subscriptions: [paused], programWindows: [window("2026-05-01", "2026-07-01")] }))).toBeUndefined();
    expect(disagree(rowsOf({ subscriptions: [paused] }, "cancelled"))?.reason).toContain("cancelled");
  });

  it("compares the Hub's hiatus end with the pause's resume day in Eastern days", () => {
    const hiatuses = [window("2026-05-01", "2026-06-10")];
    const resume = (iso: string | null) => rowsOf({ hiatuses, subscriptions: [sub({ paused: true, pauseResumesAt: iso })] }, "on_hiatus");
    expect(disagree(resume("2026-06-10T15:00:00Z"))).toBeUndefined();
    // 03:30 UTC on the 10th is 23:30 EDT on the 9th: one day early.
    expect(disagree(resume("2026-06-10T03:30:00Z"))?.reason).toBe("The hiatus ends on 2026-06-10 in the Hub, but the Stripe pause resumes on 2026-06-09 (1 days earlier).");
    expect(disagree(resume("2026-06-24T15:00:00Z"))?.reason).toContain("14 days later");
    expect(disagree(resume(null))?.reason).toContain("no resume date, so nothing will resume billing");
    expect(disagree(rowsOf({ hiatuses: [window("2026-05-01", null)], subscriptions: [sub({ paused: true, pauseResumesAt: "2026-06-10T15:00:00Z" })] }, "on_hiatus"))?.reason).toContain("no end date for the hiatus");
    expect(disagree(rowsOf({ hiatuses: [window("2026-05-01", null)], subscriptions: [sub({ paused: true })] }, "on_hiatus"))).toBeUndefined();
  });

  it("flags a member the Hub cancelled whose subscription is still live, paused or not", () => {
    expect(disagree(rowsOf({}, "cancelled"))?.reason).toContain("cancelled, but the Stripe subscription is still live");
    expect(disagree(rowsOf({ subscriptions: [sub({ paused: true })] }, "cancelled"))?.reason).toContain("cancelled");
  });

  it("is quiet when the Hub and Stripe agree, and leaves a program's own row to the program", () => {
    expect(disagree(rowsOf())).toBeUndefined();
    const rows = rowsOf({ programWindows: [window("2026-01-01", "2026-04-30")], subscriptions: [sub({ status: "canceled", canceledAt: "2026-01-02T15:00:00Z" })], invoices: [] });
    expect(disagree(rows)).toBeUndefined();
    expect(rows.some((r) => r.status === "missed" && r.cause === "program")).toBe(true);
  });
});

describe("why a row is what it is (for filtering)", () => {
  it("marks charges inside a hiatus or a program, and a billing day soon after a hiatus ended", () => {
    const charged = rowsOf({ hiatuses: [window("2026-02-20", "2026-04-15")] });
    expect(byDate(charged, "2026-03-09")?.cause).toBe("hiatus");
    expect(byDate(rowsOf({ programWindows: [window("2026-02-01", "2026-03-15")] }), "2026-02-09")?.cause).toBe("program");
    expect(byDate(rowsOf({ hiatuses: [window("2026-02-20", "2026-04-15")], invoices: monthly(["03"]) }), "2026-03-09")?.cause).toBe("hiatus");
    // The hiatus ended on the 9th, the billing day, and the 9th had no invoice (edge day: not expected). The next month is the first that is missed.
    const missed = rowsOf({ hiatuses: [window("2026-02-20", "2026-04-09")], invoices: monthly(["04", "05"]) });
    expect(byDate(missed, "2026-04-09")?.status).toBe("not_expected");
    expect(byDate(missed, "2026-05-09")).toMatchObject({ status: "missed", cause: "after_hiatus" });
    expect(byDate(missed, "2026-05-09")?.reason).toContain("A hiatus ended on 2026-04-09, the billing day.");
    expect(byDate(rowsOf({ invoices: monthly(["03"]) }), "2026-03-09")?.cause).toBeNull();
  });
});

describe("a short pause is not a hiatus", () => {
  // The last payment is 2026-03-09 (April and May are not paid), so a pause is counted from the billing day after it.
  const paused = (resumesAt: string | null) => rowsOf({ subscriptions: [sub({ paused: true, pauseResumesAt: resumesAt })], invoices: monthly(["04", "05"]) });
  const short = (rows: ScheduleRow[]) => rows.find((r) => r.status === "paused_short");

  it("names the threshold: one billing period", () => {
    expect(SHORT_PAUSE_MAX_BILLING_PERIODS).toBe(1);
  });

  it("reads a pause of one billing period as a possible gifted month, which is not a problem", () => {
    const rows = paused("2026-04-20T15:00:00Z");
    expect(short(rows)).toMatchObject({ needsAttention: false, cause: null });
    expect(short(rows)?.reason).toContain("possibly a gifted month");
    expect(disagree(rows)).toBeUndefined();
  });

  it("reads a pause of two billing periods as a hiatus the Hub does not have", () => {
    const rows = paused("2026-05-20T15:00:00Z");
    expect(short(rows)).toBeUndefined();
    expect(disagree(rows)?.reason).toBe("The Stripe subscription is paused, but the Hub has no hiatus covering today.");
  });

  it("reads a pause with no resume date as a hiatus", () => {
    expect(disagree(paused(null))).toMatchObject({ needsAttention: true });
    expect(short(paused(null))).toBeUndefined();
  });

  it("flips at the threshold: resuming on the second billing day is still short, a day after is not", () => {
    expect(short(paused("2026-05-09T15:00:00Z"))).toBeDefined(); // only April 9 falls in the pause
    expect(short(paused("2026-05-10T15:00:00Z"))).toBeUndefined(); // April 9 and May 9
    expect(disagree(paused("2026-05-10T15:00:00Z"))).toBeDefined();
    expect(short(paused("2026-04-09T15:00:00Z"))?.reason).toContain("less than one billing period");
  });

  it("expects no charge during a short pause either, and a charge during one is a finding", () => {
    const quiet = paused("2026-04-20T15:00:00Z");
    expect(byDate(quiet, "2026-04-09")).toMatchObject({ status: "not_expected" });
    // A draft invoice is what a pause leaves; a payment after it, before the resume day, was taken during the pause.
    const charged = rowsOf({
      subscriptions: [sub({ paused: true, pauseResumesAt: "2026-04-20T15:00:00Z" })],
      invoices: [
        ...monthly(["04", "05"]),
        invoice("in_draft", "2026-04-09T15:00:00Z", { status: "draft", amountPaidCents: 0 }),
        invoice("in_paid", "2026-04-12T15:00:00Z"),
        invoice("in_draft2", "2026-05-09T15:00:00Z", { status: "draft", amountPaidCents: 0 }),
      ],
    });
    expect(charged.find((r) => r.transactions[0]?.invoiceId === "in_paid")).toMatchObject({ status: "charged_when_not_expected", cause: "pause", needsAttention: true });
    // The same payment with no pause artifact before it is not flagged as a pause charge.
    const unflagged = rowsOf({ subscriptions: [sub({ paused: true, pauseResumesAt: "2026-04-20T15:00:00Z" })], invoices: [...monthly(["04", "05"]), invoice("in_paid", "2026-04-12T15:00:00Z")] });
    expect(unflagged.find((r) => r.transactions[0]?.invoiceId === "in_paid")?.cause).toBeNull();
    // A draft before it but none after it: that pause ended, and the payment came after it.
    const resumed = rowsOf({
      subscriptions: [sub({ paused: true, pauseResumesAt: "2026-08-20T15:00:00Z" })],
      invoices: [...monthly(["04", "05"]), invoice("in_draft", "2026-04-09T15:00:00Z", { status: "draft", amountPaidCents: 0 }), invoice("in_paid", "2026-04-12T15:00:00Z")],
    });
    expect(resumed.find((r) => r.transactions[0]?.invoiceId === "in_paid")?.cause).toBeNull();
  });
});

describe("the invoices check the Hub's hiatus records", () => {
  const paid = (...days: string[]) => days.map((d) => invoice(`in_${d}`, `${d}T15:00:00Z`));
  const gapsOf = (days: string[], over: { problems?: string[]; subs?: ReconSubscription[]; programs?: ReconWindow[] } = {}) =>
    inferBillingGaps(days, over.problems ?? [], over.subs ?? [sub()], over.programs ?? []);
  // Paid on the 9th, then nothing in April and May: billing resumes 2026-06-09.
  const twoMonthGap = ["2026-01-09", "2026-02-09", "2026-03-09", "2026-06-09"];
  const statusOf = (rows: ScheduleRow[], status: ScheduleRow["status"]) => rows.find((r) => r.status === status);

  it("infers a gap of two billing periods between two payments, and none for ordinary months", () => {
    expect(gapsOf(twoMonthGap)).toEqual([{ lastPaid: "2026-03-09", resumed: "2026-06-09", firstMissed: "2026-04-09", missedPeriods: 2 }]);
    expect(gapsOf(["2026-01-09", "2026-02-09", "2026-03-11", "2026-04-08"])).toEqual([]);
  });

  it("confirms a Hub hiatus that matches the gap", () => {
    const rows = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-04-01", "2026-06-09")] });
    expect(statusOf(rows, "hiatus_confirmed")).toMatchObject({ needsAttention: false, cause: "hiatus", expectedDate: "2026-06-09" });
    expect(statusOf(rows, "hiatus_confirmed")?.reason).toContain("confirmed by the payments");
  });

  it("flags a gap with no hiatus and no program as unrecorded, and a one-period gap as short", () => {
    const unrecorded = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap) });
    expect(statusOf(unrecorded, "unrecorded_gap")).toMatchObject({ needsAttention: true, cause: "gap" });
    expect(statusOf(unrecorded, "unrecorded_gap")?.reason).toContain("2 billing periods");
    const short = rowsOf({ today: "2026-06-20", invoices: paid("2026-01-09", "2026-02-09", "2026-03-09", "2026-05-09", "2026-06-09") });
    expect(statusOf(short, "gap_short")).toMatchObject({ needsAttention: false });
    expect(statusOf(short, "gap_short")?.reason).toContain("possibly a gifted month");
    expect(statusOf(short, "unrecorded_gap")).toBeUndefined();
  });

  it("shows the day difference when the hiatus is longer or shorter than the gap", () => {
    const early = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-04-01", "2026-05-09")] });
    expect(statusOf(early, "hiatus_mismatch")?.reason).toContain("ended 2026-05-09, 31 days before billing resumed (about 1 billing period more than recorded)");
    const late = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-04-01", "2026-06-25")] });
    expect(statusOf(late, "hiatus_mismatch")?.reason).toContain("16 days after billing resumed");
    const open = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-04-01", null)] });
    expect(statusOf(open, "hiatus_mismatch")?.reason).toContain("has no end date");
    const lateStart = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-05-01", "2026-06-09")] });
    expect(statusOf(lateStart, "hiatus_mismatch")).toBeDefined();
  });

  it("finds a hiatus that ended on the billing day but still skipped a month", () => {
    // Hub: hiatus ended 2026-05-09, her billing day. Stripe: nothing on the 9th, billing resumed 2026-06-09.
    const rows = rowsOf({ today: "2026-06-20", invoices: paid(...twoMonthGap), hiatuses: [window("2026-04-01", "2026-05-09")] });
    const row = statusOf(rows, "hiatus_mismatch");
    expect(row).toMatchObject({ cause: "hiatus_billing_day", needsAttention: true });
    expect(row?.reason).toContain("The hiatus ended on the billing day.");
    // The same hiatus resumed on the day: confirmed, not a skipped month.
    const resumed = rowsOf({ today: "2026-06-20", invoices: paid("2026-01-09", "2026-02-09", "2026-03-09", "2026-05-09"), hiatuses: [window("2026-04-01", "2026-05-09")] });
    expect(statusOf(resumed, "hiatus_mismatch")).toBeUndefined();
    expect(statusOf(resumed, "hiatus_confirmed")).toBeDefined(); // resumed on the billing day itself: the hiatus is what the payments show
  });

  it("does not take a gap explained by a failed payment, a cancellation or a program for a pause", () => {
    expect(gapsOf(twoMonthGap, { problems: ["2026-04-09"] })).toEqual([]);
    expect(gapsOf(twoMonthGap, { subs: [sub({ status: "canceled", canceledAt: "2026-03-20T15:00:00Z" })] })).toEqual([]);
    expect(gapsOf(twoMonthGap, { programs: [window("2026-03-15", "2026-06-05")] })).toEqual([]);
    // A program covering only a small part of the gap does not explain it.
    expect(gapsOf(twoMonthGap, { programs: [window("2026-05-25", "2026-06-05")] })).toHaveLength(1);
    const rows = rowsOf({ today: "2026-06-20", invoices: [...paid(...twoMonthGap), invoice("in_open", "2026-04-09T15:00:00Z", { status: "open", amountPaidCents: 0 })] });
    expect(rows.some((r) => r.status === "unrecorded_gap")).toBe(false);
  });

  it("matches the hiatus to the gap in Eastern days", () => {
    // Resumed at 00:30 EDT on 2026-06-09 (04:30Z): the 9th, so a hiatus ending on the 9th is confirmed.
    const rows = rowsOf({
      today: "2026-06-20",
      invoices: [...paid("2026-01-09", "2026-02-09", "2026-03-09"), invoice("in_resume", "2026-06-09T04:30:00Z")],
      hiatuses: [window("2026-04-01", "2026-06-09")],
    });
    expect(statusOf(rows, "hiatus_confirmed")).toBeDefined();
  });

  it("returns the audit as plain data", () => {
    const [audit] = auditHiatuses(gapsOf(twoMonthGap), [window("2026-04-01", "2026-05-09")]);
    expect(audit).toMatchObject({ kind: "mismatch", endDiffDays: 31, endedOnBillingDay: true });
  });
});

describe("a member's whole billing history", () => {
  /** Paid on the 11th, January 2024 to February 2026, a void run in 2025-06 and 2025-07, one invoice off any billing day, and an invoice for another product. */
  const history = () => {
    const out: ReconInvoice[] = [];
    for (let i = 0; i < 26; i++) {
      const month = 1 + i;
      const y = 2024 + Math.floor((month - 1) / 12);
      const m = ((month - 1) % 12) + 1;
      const id = `in_${y}_${String(m).padStart(2, "0")}`;
      const createdAt = `${y}-${String(m).padStart(2, "0")}-11T15:00:00Z`;
      out.push(y === 2025 && (m === 6 || m === 7) ? invoice(id, createdAt, { status: "void", amountPaidCents: 0 }) : invoice(id, createdAt));
    }
    out.push(invoice("in_odd", "2025-02-26T15:00:00Z"));
    out.push(invoice("in_other", "2025-03-03T15:00:00Z", { stripeProductId: "prod_other" }));
    return out;
  };
  const cancelled = sub({ status: "canceled", createdAt: "2024-01-11T15:00:00Z", billingAnchor: "2024-01-11T15:00:00Z", canceledAt: "2026-02-16T15:00:00Z" });
  const input = (over: Partial<ReconInput> = {}) => ({ today: "2026-05-20", subscriptions: [cancelled], invoices: history(), charges: [charge("ch_solo", "", { stripeInvoiceId: null })], ...over });

  it("lists every non-draft invoice, as a matched, unexpected or counted row", () => {
    const [schedule] = run({ ...input(), lookbackMonths: null });
    const listed = new Set(schedule.rows.flatMap((r) => r.transactions.map((t) => t.invoiceId)));
    const billed = history().filter((i) => (i.stripeProductId === PRODUCT) && i.status !== "draft" && i.status !== "void");
    expect(billed.length).toBe(25);
    for (const i of billed) expect(listed.has(i.stripeInvoiceId), i.stripeInvoiceId).toBe(true);
    expect(schedule.rows.find((r) => r.transactions[0]?.invoiceId === "in_odd")?.status).toBe("unexpected");
    expect(schedule).toMatchObject({ start: "2024-01-11", end: "2026-02-16" });
    expect(schedule.notes).toEqual([
      expect.stringContaining("2 draft or void invoices"),
      expect.stringContaining("1 invoice for other products"),
      expect.stringContaining("1 one-off payment with no invoice"),
    ]);
    expect(schedule.notes.some((n) => n.includes("not listed: this view starts"))).toBe(false);
  });

  it("keeps the 12-month lookback for the overview, with the header range and a note for what it leaves out", () => {
    const [schedule] = run(input());
    const first = schedule.rows[0].expectedDate ?? schedule.rows[0].transactions[0]?.day ?? "";
    expect(first >= "2025-05-01").toBe(true);
    expect(schedule).toMatchObject({ start: "2024-01-11", end: "2026-02-16" });
    expect(schedule.notes[0]).toBe("17 earlier invoices are not listed: this view starts on 2025-05-01. The member's own Transactions tab covers the whole history.");
  });

  it("starts at the first invoice when no subscription is known", () => {
    const [schedule] = run({ ...input({ subscriptions: [] }), lookbackMonths: null });
    expect(schedule.start).toBe("2024-01-11");
    expect(schedule.rows.every((r) => r.status === "unexpected" || r.status === "hub_stripe_disagree")).toBe(true);
  });
});

describe("unpaid invoices rolled into one row", () => {
  const unpaid = (id: string, createdAt: string, extra: Partial<ReconInvoice> = {}) => invoice(id, createdAt, { status: "open", amountPaidCents: 0, attemptCount: 0, ...extra });
  const sendSub = (collectionMethod?: string) => sub({ createdAt: "2026-01-02T15:00:00Z", billingAnchor: "2026-01-02T15:00:00Z", collectionMethod });
  /** Ada's case: a subscription made 2026-01-02 that emails invoices (never charges), January and February paid, March to November open. */
  const adaInvoices = () => [
    invoice("in_01", "2026-01-02T15:00:00Z"),
    invoice("in_02", "2026-02-02T15:00:00Z"),
    ...["03", "04", "05", "06", "07", "08", "09", "10", "11"].map((m) => unpaid(`in_${m}`, `2026-${m}-02T15:00:00Z`)),
  ];
  const ada = (over: Partial<ReconInput> = {}, status = "active") =>
    rowsOf({ today: "2026-11-25", subscriptions: [sendSub("send_invoice")], invoices: adaInvoices(), lookbackMonths: null, ...over }, status);
  const unpaidRows = (rows: ScheduleRow[]) => rows.filter((r) => r.status === "unpaid_behind" || r.status === "unpaid_earlier");

  it("rolls nine open invoices into one row with the total, the first month's key and every invoice listed", () => {
    const rows = ada();
    const [row, ...extra] = unpaidRows(rows);
    expect(extra).toEqual([]);
    expect(row).toMatchObject({ key: `${MEMBER}:membership:2026-03`, status: "unpaid_behind", needsAttention: true, expectedDate: "2026-03-02", expectedAmountCents: 9 * 4700 });
    expect(row.transactions.map((t) => t.invoiceId)).toEqual(["03", "04", "05", "06", "07", "08", "09", "10", "11"].map((m) => `in_${m}`));
    expect(row.reason).toContain("9 invoices unpaid since 2026-03-02, $423.00 total.");
    expect(row.reason).toContain("Nothing has been paid since.");
    expect(rows).toHaveLength(3);
  });

  it("never says tries for an invoice Stripe emails and never charges, and counts days from the Eastern day", () => {
    const [row] = unpaidRows(ada());
    expect(row.reason).toContain("Stripe emails each invoice and never charges a card; the oldest has been unpaid for 268 days.");
    expect(row.reason).not.toMatch(/tr(y|ies)/);
    const [single] = unpaidRows(ada({ invoices: [invoice("in_01", "2026-01-02T15:00:00Z"), unpaid("in_11", "2026-11-02T15:00:00Z")] }));
    expect(single.reason).toBe("$47.00 invoice emailed on 2026-11-02, unpaid for 23 days (Stripe emails this invoice and never charges a card). Nothing has been paid since.");
  });

  it("keeps the tries wording for a subscription that charges the card, or one whose method is unknown", () => {
    const [row] = unpaidRows(ada({ subscriptions: [sendSub("charge_automatically")] }));
    expect(row.reason).toContain("9 invoices unpaid since 2026-03-02, $423.00 total; the latest had 0 tries.");
    expect(row.transactions.every((t) => t.collectionMethod === "charge_automatically")).toBe(true);
    expect(unpaidRows(ada({ subscriptions: [sendSub()] }))[0].reason).toContain("0 tries");
  });

  it("counts unpaid days from the Eastern day, across midnight and the days the clocks change", () => {
    const reason = (createdAt: string, today: string) =>
      unpaidRows(rowsOf({ today, subscriptions: [sub({ createdAt, billingAnchor: createdAt, collectionMethod: "send_invoice" })], invoices: [unpaid("in_x", createdAt)], lookbackMonths: null }))[0].reason;
    // 03:30 UTC on March 9 is 23:30 on March 8 in Eastern time; 04:30 UTC is 00:30 on March 9.
    expect(reason("2026-03-09T03:30:00Z", "2026-03-12")).toContain("invoice emailed on 2026-03-08, unpaid for 4 days");
    expect(reason("2026-03-09T04:30:00Z", "2026-03-12")).toContain("invoice emailed on 2026-03-09, unpaid for 3 days");
    // Spring forward (March 8) and fall back (November 1) days are 23 and 25 hours long, but still one day.
    expect(reason("2026-03-07T15:00:00Z", "2026-03-09")).toContain("unpaid for 2 days");
    expect(reason("2026-10-31T15:00:00Z", "2026-11-02")).toContain("unpaid for 2 days");
    expect(reason("2026-03-08T15:00:00Z", "2026-03-09")).toContain("unpaid for 1 day (");
  });

  it("splits behind (nothing paid since) from paying again (a later invoice was paid)", () => {
    expect(unpaidRows(ada()).map((r) => r.status)).toEqual(["unpaid_behind"]);
    const again = unpaidRows(ada({ invoices: [invoice("in_01", "2026-01-02T15:00:00Z"), unpaid("in_02", "2026-02-02T15:00:00Z"), unpaid("in_03", "2026-03-02T15:00:00Z"), invoice("in_04", "2026-04-02T15:00:00Z")] }));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ status: "unpaid_earlier", needsAttention: true, expectedDate: "2026-02-02" });
    expect(again[0].reason).toContain("The member is paying again (an invoice was paid on 2026-04-02), but these were not collected.");
  });

  it("ends a run at a payment: unpaid, paid, unpaid is two rows with their own status", () => {
    const rows = unpaidRows(
      ada({ invoices: [invoice("in_01", "2026-01-02T15:00:00Z"), unpaid("in_02", "2026-02-02T15:00:00Z"), invoice("in_03", "2026-03-02T15:00:00Z"), unpaid("in_04", "2026-04-02T15:00:00Z"), unpaid("in_05", "2026-05-02T15:00:00Z")] })
    );
    expect(rows.map((r) => [r.status, r.transactions.length])).toEqual([["unpaid_earlier", 1], ["unpaid_behind", 2]]);
    expect(rows.map((r) => r.key)).toEqual([`${MEMBER}:membership:2026-02`, `${MEMBER}:membership:2026-04`]);
  });

  it("rolls an uncollectible invoice followed by open ones into one row", () => {
    const rows = unpaidRows(ada({ invoices: [invoice("in_01", "2026-01-02T15:00:00Z"), unpaid("in_02", "2026-02-02T15:00:00Z", { status: "uncollectible" }), unpaid("in_03", "2026-03-02T15:00:00Z")] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toContain("2 invoices unpaid since 2026-02-02, $94.00 total (1 written off as uncollectible).");
  });

  it("does not raise a cancelled member's unpaid invoices, but still rolls them up", () => {
    const rows = ada({}, "cancelled");
    expect(unpaidRows(rows)).toHaveLength(1);
    expect(unpaidRows(rows)[0].needsAttention).toBe(false);
  });

  it("keeps a stable key when a month has several rows: the rolled row first, then a counter", () => {
    const rows = ada({ invoices: [invoice("in_01", "2026-01-02T15:00:00Z"), unpaid("in_03", "2026-03-02T15:00:00Z"), invoice("in_odd", "2026-03-20T15:00:00Z")] });
    expect(rows.filter((r) => r.month === "2026-03").map((r) => [r.key, r.status])).toEqual([
      [`${MEMBER}:membership:2026-03`, "unpaid_earlier"],
      [`${MEMBER}:membership:2026-03:2`, "unexpected"],
    ]);
  });

  it("counts both unpaid statuses in the summary", () => {
    const schedules = run({
      today: "2026-11-25",
      subscriptions: [sendSub()],
      invoices: [invoice("in_1", "2026-01-02T15:00:00Z"), unpaid("in_2", "2026-02-02T15:00:00Z"), invoice("in_3", "2026-03-02T15:00:00Z"), unpaid("in_4", "2026-04-02T15:00:00Z")],
      lookbackMonths: null,
    });
    const summary = summarize(schedules);
    expect(summary.byStatus).toMatchObject({ unpaid_earlier: 1, unpaid_behind: 1 });
    expect(summary.membersWithProblems).toBe(1);
  });
});
