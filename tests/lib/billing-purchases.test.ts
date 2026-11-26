import { describe, expect, it } from "vitest";
import { buildPurchaseSchedules, type PurchaseReconInput, type ReconAttendee, type ReconKajabiPurchase } from "@/lib/billing-purchases";
import type { PurchaseSchedule, ReconCharge, ReconInvoice, ReconSubscription } from "@/lib/billing-reconciliation";

const M = (n: number) => `mbr_AAAAAAAAAAA${n}`;
const CUS = (n: number) => `cus_${n}`;
const EV1 = "evt_AAAAAAAAAAA1";
const EV2 = "evt_AAAAAAAAAAA2";
const TICKET = "offer_ticket";
const PLAN = "offer_plan";
const COURSE = "offer_course";

const purchase = (id: string, member: number, createdAt: string, extra: Partial<ReconKajabiPurchase> = {}): ReconKajabiPurchase => ({
  purchaseId: id,
  memberId: M(member),
  offerId: TICKET,
  createdAt,
  deactivatedAt: null,
  amountCents: 50_000,
  paymentType: "single",
  quantity: 1,
  ...extra,
});
const charge = (id: string, customer: number, createdAt: string, extra: Partial<ReconCharge> = {}): ReconCharge => ({
  stripeChargeId: id,
  stripeCustomerId: CUS(customer),
  stripeInvoiceId: null,
  status: "succeeded",
  amountCents: 50_000,
  amountRefundedCents: 0,
  failureCode: null,
  createdAt,
  kajabiOfferId: TICKET,
  description: "Spring Retreat",
  ...extra,
});
const attendee = (member: number, source: ReconAttendee["source"] = null, extra: Partial<ReconAttendee> = {}): ReconAttendee => ({ eventId: EV1, memberId: M(member), source, giverId: null, fromEventId: null, ...extra });

const base = (over: Partial<PurchaseReconInput> = {}): PurchaseReconInput => ({
  today: "2026-06-01",
  members: [1, 2, 3, 4, 5].map((n) => ({ id: M(n), status: "active", stripeCustomerIds: [CUS(n)] })),
  purchases: [],
  offers: [
    { offerId: TICKET, name: "Spring Retreat", priceText: "$500.00 one time", kind: "event" },
    { offerId: PLAN, name: "Spring Retreat Payment Plan", priceText: "$100.00 every month", kind: "event" },
    { offerId: COURSE, name: "Craft Course", priceText: "$99.00 one time", kind: "course" },
  ],
  events: [
    { id: EV1, slug: "spring-retreat", title: "Spring Retreat" },
    { id: EV2, slug: "fall-retreat", title: "Fall Retreat" },
  ],
  eventLinks: [
    { eventId: EV1, offerId: TICKET, purchasedFrom: null, purchasedUntil: null },
    { eventId: EV1, offerId: PLAN, purchasedFrom: null, purchasedUntil: null },
  ],
  attendees: [],
  notAttending: [],
  overrides: [],
  invoices: [],
  charges: [],
  subscriptions: [],
  ...over,
});

const of = (schedules: PurchaseSchedule[], member: number) => schedules.filter((s) => s.memberId === M(member));
const statuses = (schedules: PurchaseSchedule[], member: number) => of(schedules, member).flatMap((s) => s.rows.map((r) => r.status));
const attention = (schedules: PurchaseSchedule[], member: number) => of(schedules, member).flatMap((s) => s.rows.filter((r) => r.needsAttention).map((r) => r.status));

describe("an event purchase and its Stripe payment", () => {
  it("lines up a buyer who attends with the charge Kajabi made for the offer", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:05Z")], attendees: [attendee(1)] }));
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ purchaseType: "event", label: "Spring Retreat", event: { slug: "spring-retreat" }, purchase: { offerName: "Spring Retreat", priceText: "$500.00 one time", day: "2026-02-01", status: "active", granted: false } });
    expect(schedules[0].rows).toHaveLength(1);
    expect(schedules[0].rows[0]).toMatchObject({ status: "paid", needsAttention: false });
    expect(schedules[0].rows[0].transactions[0]).toMatchObject({ kind: "charge", invoiceId: "ch_1", keptCents: 50_000 });
  });

  it("finds the charge when the Stripe customer is not the member's (the email differs)", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_x", 9, "2026-02-02T15:00:00Z")], attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["paid"]);
  });

  it("prefers the member's own customer, then the equal amount, over a nearer charge", () => {
    const schedules = buildPurchaseSchedules(
      base({
        purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")],
        charges: [charge("ch_other", 9, "2026-02-01T15:00:00Z"), charge("ch_own", 1, "2026-02-03T15:00:00Z")],
        attendees: [attendee(1)],
      })
    );
    expect(schedules.find((s) => s.memberId === M(1))?.rows[0].transactions[0].invoiceId).toBe("ch_own");
  });

  it("uses each charge once: two purchases and one charge leave one of them missing a payment", () => {
    const schedules = buildPurchaseSchedules(
      base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z"), purchase("p2", 2, "2026-02-01T16:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:05Z")], attendees: [attendee(1), attendee(2)] })
    );
    expect(statuses(schedules, 1)).toEqual(["paid"]);
    expect(statuses(schedules, 2)).toEqual(["missing_payment"]);
  });

  it("matches by the offer's name when the charge carries no offer id", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:05Z", { kajabiOfferId: null, description: "SPRING retreat!" })], attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["paid"]);
  });

  it("matches a payment plan to the subscription Kajabi made and lists its invoices without guessing a total", () => {
    const sub: ReconSubscription = { stripeSubscriptionId: "sub_1", stripeCustomerId: CUS(1), status: "active", createdAt: "2026-01-10T15:00:00Z", canceledAt: null, billingAnchor: null, paused: false, kajabiOfferId: PLAN };
    const inv = (id: string, createdAt: string): ReconInvoice => ({ stripeInvoiceId: id, stripeCustomerId: CUS(1), stripeSubscriptionId: "sub_1", stripeProductId: null, status: "paid", amountDueCents: 10_000, amountPaidCents: 10_000, currency: "usd", createdAt, attemptCount: 1, stripeChargeId: null });
    const schedules = buildPurchaseSchedules(
      base({ purchases: [purchase("p1", 1, "2026-01-10T15:00:00Z", { offerId: PLAN, paymentType: "multipay", amountCents: 10_000 })], subscriptions: [sub], invoices: [inv("in_1", "2026-01-10T15:00:00Z"), inv("in_2", "2026-02-10T15:00:00Z")], attendees: [attendee(1)] })
    );
    expect(schedules[0].rows.map((r) => [r.status, r.transactions[0].invoiceId])).toEqual([["paid", "in_1"], ["paid", "in_2"]]);
    expect(schedules[0].purchase?.status).toBe("active");
    expect(attention(schedules, 1)).toEqual([]);
  });

  it("lists a deposit as one paid payment: no total is guessed, so nothing is partial or missing", () => {
    const schedules = buildPurchaseSchedules(
      base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z", { amountCents: 2500 })], charges: [charge("ch_dep", 1, "2026-02-01T15:00:00Z", { amountCents: 2500, description: "Retreat deposit" })], attendees: [attendee(1)] })
    );
    expect(schedules[0].rows.map((r) => [r.status, r.transactions[0].keptCents])).toEqual([["paid", 2500]]);
  });
});

describe("what an attendee should have paid", () => {
  it("flags a buyer on the roster whose purchase has no Stripe payment", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(attention(schedules, 1)).toEqual(["missing_payment"]);
    expect(schedules[0].rows[0].reason).toContain("no Stripe payment was found");
  });

  it("flags an attendee with no purchase and no payment at all", () => {
    const schedules = buildPurchaseSchedules(base({ attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["missing_payment"]);
    expect(schedules[0]).toMatchObject({ event: { slug: "spring-retreat" }, purchase: undefined });
  });

  it("flags a refunded buyer who is still on the roster as one who bought a ticket", () => {
    const schedules = buildPurchaseSchedules(
      base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z", { amountRefundedCents: 50_000 })], attendees: [attendee(1)] })
    );
    expect(statuses(schedules, 1).sort()).toEqual(["missing_payment", "refunded"]);
    expect(attention(schedules, 1)).toEqual(["missing_payment"]);
  });

  it("leaves a refunded buyer who is not attending alone", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 2, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 2, "2026-02-01T15:00:00Z", { amountRefundedCents: 50_000 })] }));
    expect(statuses(schedules, 2)).toEqual(["refunded"]);
    expect(attention(schedules, 2)).toEqual([]);
  });

  it("shows a failed charge as failed", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z", { status: "failed", failureCode: "card_declined" })], attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["failed"]);
  });

  it("explains a cancelled purchase with no payment without a flag", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 2, "2026-02-01T15:00:00Z", { deactivatedAt: "2026-02-20T15:00:00Z" })] }));
    expect(statuses(schedules, 2)).toEqual(["not_expected"]);
    expect(schedules[0].purchase?.status).toBe("canceled");
  });
});

describe("events that sell nothing", () => {
  it("expects no payment from the attendees of an event with no linked offer", () => {
    expect(buildPurchaseSchedules(base({ attendees: [attendee(1, null, { eventId: EV2 })] }))).toEqual([]);
  });
});

describe("tickets that expect no payment here", () => {
  it("accepts comped, gifted and transferred attendees with no payment, as neutral rows", () => {
    const schedules = buildPurchaseSchedules(base({ attendees: [attendee(1, "comped"), attendee(2, "gifted", { giverId: M(3) }), attendee(3, "transferred", { fromEventId: EV2 })] }));
    expect(statuses(schedules, 1)).toEqual(["comped"]);
    expect(statuses(schedules, 2)).toEqual(["gifted"]);
    expect(statuses(schedules, 3)).toEqual(["transferred"]);
    expect(schedules.flatMap((s) => s.rows).some((r) => r.needsAttention)).toBe(false);
  });

  it("flags a payment against a comped ticket", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1, "comped")] }));
    expect(attention(schedules, 1)).toEqual(["unexplained_payment"]);
  });
});

describe("a payer who is not attending", () => {
  const paid = { purchases: [purchase("p1", 2, "2026-02-01T15:00:00Z")], charges: [charge("ch_1", 2, "2026-02-01T15:00:00Z")] };

  it("is unexplained without a mark, a gift or a transfer", () => {
    expect(attention(buildPurchaseSchedules(base(paid)), 2)).toEqual(["unexplained_payment"]);
  });

  it("is explained by a forfeited mark and by an other mark", () => {
    const forfeited = buildPurchaseSchedules(base({ ...paid, notAttending: [{ eventId: EV1, memberId: M(2), reason: "forfeited", note: null }] }));
    expect(statuses(forfeited, 2)).toContain("forfeited");
    expect(attention(forfeited, 2)).toEqual([]);
    const other = buildPurchaseSchedules(base({ ...paid, notAttending: [{ eventId: EV1, memberId: M(2), reason: "other", note: "moved abroad" }] }));
    expect(statuses(other, 2)).toContain("marked_not_attending");
    expect(other[0].rows.at(-1)?.reason).toContain("moved abroad");
  });

  it("is explained when their ticket went to a gifted attendee, or to another event", () => {
    const gifted = buildPurchaseSchedules(base({ ...paid, attendees: [attendee(3, "gifted", { giverId: M(2) })] }));
    expect(statuses(gifted, 2)).toContain("gifted");
    expect(attention(gifted, 2)).toEqual([]);
    const moved = buildPurchaseSchedules(base({ ...paid, attendees: [attendee(2, "transferred", { eventId: EV2, fromEventId: EV1 })] }));
    expect(statuses(moved, 2)).toContain("transferred");
    expect(attention(moved, 2)).toEqual([]);
  });
});

describe("purchase days in Eastern time and offers shared by events", () => {
  const links = [
    { eventId: EV1, offerId: TICKET, purchasedFrom: null, purchasedUntil: "2026-03-08" },
    { eventId: EV2, offerId: TICKET, purchasedFrom: "2026-03-09", purchasedUntil: null },
  ];
  const eventOf = (schedules: PurchaseSchedule[], member: number) => of(schedules, member)[0]?.event?.id;

  it("puts a purchase on the event whose window holds its Eastern day, at both edges of the spring-forward day", () => {
    const schedules = buildPurchaseSchedules(
      base({
        eventLinks: links,
        purchases: [purchase("p1", 1, "2026-03-09T03:30:00Z"), purchase("p2", 2, "2026-03-09T04:30:00Z")], // 23:30 EDT on the 8th, 00:30 EDT on the 9th
        attendees: [],
      })
    );
    expect(eventOf(schedules, 1)).toBe(EV1);
    expect(eventOf(schedules, 2)).toBe(EV2);
  });

  it("handles the fall-back day: 01:30 EDT and the repeated 01:30 EST are the same Eastern day", () => {
    const schedules = buildPurchaseSchedules(
      base({
        eventLinks: [{ eventId: EV1, offerId: TICKET, purchasedFrom: "2026-11-01", purchasedUntil: "2026-11-01" }],
        purchases: [purchase("p1", 1, "2026-11-01T05:30:00Z"), purchase("p2", 2, "2026-11-01T06:30:00Z"), purchase("p3", 3, "2026-11-02T05:30:00Z")],
      })
    );
    expect(eventOf(schedules, 1)).toBe(EV1);
    expect(eventOf(schedules, 2)).toBe(EV1);
    expect(schedules.some((s) => s.memberId === M(3))).toBe(false);
  });

  it("skips a purchase that falls in no window of its offer", () => {
    expect(buildPurchaseSchedules(base({ eventLinks: [{ eventId: EV1, offerId: TICKET, purchasedFrom: "2027-01-01", purchasedUntil: null }], purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z")] }))).toEqual([]);
  });

  it("keeps an attendee's payment on the event of its window when the offer serves two events", () => {
    const schedules = buildPurchaseSchedules(
      base({ eventLinks: links, purchases: [purchase("p1", 1, "2026-03-20T15:00:00Z")], charges: [charge("ch_1", 1, "2026-03-20T15:00:00Z")], attendees: [attendee(1, null, { eventId: EV2 })] })
    );
    expect(of(schedules, 1)).toHaveLength(1);
    expect(eventOf(schedules, 1)).toBe(EV2);
    expect(statuses(schedules, 1)).toEqual(["paid"]);
  });
});

describe("a payment with no purchase on record", () => {
  it("lists a charge of an event's offer under the member whose customer paid it, and counts it for the roster", () => {
    const schedules = buildPurchaseSchedules(base({ charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(schedules).toHaveLength(1);
    expect(schedules[0].notes).toEqual(["No Kajabi purchase is on record for these payments."]);
    expect(statuses(schedules, 1)).toEqual(["paid"]);
  });

  it("ignores a charge of a customer that is nobody's, and one outside every window", () => {
    expect(buildPurchaseSchedules(base({ charges: [charge("ch_1", 9, "2026-02-01T15:00:00Z")] }))).toEqual([]);
    expect(buildPurchaseSchedules(base({ eventLinks: [{ eventId: EV1, offerId: TICKET, purchasedFrom: "2027-01-01", purchasedUntil: null }], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")] }))).toEqual([]);
  });
});

describe("granted purchases (no price)", () => {
  const granted = (extra: Partial<ReconKajabiPurchase> = {}) => purchase("pg", 1, "2026-02-01T15:00:00Z", { amountCents: 0, ...extra });
  const override = (type: string) => [{ memberId: M(1), type, reason: "Paid by check", startsAt: null, expiresAt: null }];

  it("with a gift override expects no payment and says why", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], overrides: override("gift"), attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["granted_no_payment"]);
    expect(schedules[0].rows[0].reason).toContain("gift (Paid by check)");
    expect(schedules[0].purchase?.granted).toBe(true);
  });

  it("with a direct-Stripe override shows the Stripe payment under the granted purchase", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], overrides: override("direct_stripe"), charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(statuses(schedules, 1)).toEqual(["granted_paid_stripe"]);
    expect(attention(schedules, 1)).toEqual([]);
  });

  it("with a direct-Stripe override but no payment needs a look", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], overrides: override("direct_stripe") }));
    expect(attention(schedules, 1)).toEqual(["missing_payment"]);
  });

  it("with no override on record needs a look", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()] }));
    expect(attention(schedules, 1)).toEqual(["granted_no_override"]);
  });

  it("with a payment and no direct-Stripe override asks staff to record one", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(attention(schedules, 1)).toEqual(["paid_override_missing"]);
  });

  it("with a gift override and a payment flags the payment as unexpected", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], overrides: override("gift"), charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(attention(schedules, 1)).toEqual(["unexpected"]);
  });

  it("ignores an override that is not in force on the purchase day", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [granted()], overrides: [{ memberId: M(1), type: "gift", reason: null, startsAt: null, expiresAt: "2026-01-31" }] }));
    expect(attention(schedules, 1)).toEqual(["granted_no_override"]);
  });
});

describe("row keys, which an acknowledgement is bound to", () => {
  it("names the purchase, so two purchases of one offer by one member never share a key", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z"), purchase("p2", 1, "2026-03-01T15:00:00Z")], attendees: [attendee(1)] }));
    const keys = of(schedules, 1).flatMap((s) => s.rows.map((r) => r.key));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys.some((k) => k.includes(":p1:"))).toBe(true);
    expect(keys.some((k) => k.includes(":p2:"))).toBe(true);
  });

  it("stays the same when the row's status changes (a payment arrives), so the acknowledgement can tell it changed", () => {
    const purchases = [purchase("p1", 1, "2026-02-01T15:00:00Z")];
    const before = buildPurchaseSchedules(base({ purchases, attendees: [attendee(1)] }));
    const after = buildPurchaseSchedules(base({ purchases, attendees: [attendee(1)], charges: [charge("ch_1", 1, "2026-02-01T15:00:05Z")] }));
    expect(before[0].rows[0].status).toBe("missing_payment");
    expect(after[0].rows[0].status).toBe("paid");
    expect(after[0].rows[0].key).toBe(before[0].rows[0].key);
  });

  it("does not depend on what order the purchases arrive in", () => {
    const a = purchase("p1", 1, "2026-02-01T15:00:00Z");
    const b = purchase("p2", 1, "2026-03-01T15:00:00Z");
    const keysOf = (purchases: ReconKajabiPurchase[]) => buildPurchaseSchedules(base({ purchases, attendees: [attendee(1)] })).flatMap((s) => s.rows.map((r) => r.key)).sort();
    expect(keysOf([a, b])).toEqual(keysOf([b, a]));
  });
});

describe("programs and courses", () => {
  it("lists a course purchase with its payment and no expectation about attending", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z", { offerId: COURSE, amountCents: 9900 })], charges: [charge("ch_1", 1, "2026-02-01T15:00:00Z", { kajabiOfferId: COURSE, amountCents: 9900 })] }));
    expect(schedules[0]).toMatchObject({ purchaseType: "course", label: "Craft Course", event: undefined });
    expect(statuses(schedules, 1)).toEqual(["paid"]);
  });

  it("builds nothing for a membership or another kind of offer", () => {
    const offers = [{ offerId: "m", name: "Quill & Cup Membership", priceText: null, kind: "membership" as const }, { offerId: "o", name: "Other", priceText: null, kind: "other" as const }];
    expect(buildPurchaseSchedules(base({ offers, purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z", { offerId: "m" }), purchase("p2", 1, "2026-02-01T15:00:00Z", { offerId: "o" })] }))).toEqual([]);
  });

  it("gives every schedule a unique key", () => {
    const schedules = buildPurchaseSchedules(base({ purchases: [purchase("p1", 1, "2026-02-01T15:00:00Z"), purchase("p2", 1, "2026-02-01T15:00:00Z")], attendees: [attendee(1)] }));
    expect(new Set(schedules.map((s) => s.key)).size).toBe(schedules.length);
    expect(new Set(schedules.flatMap((s) => s.rows.map((r) => r.key))).size).toBe(schedules.flatMap((s) => s.rows).length);
  });
});
