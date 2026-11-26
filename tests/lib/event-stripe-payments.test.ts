import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { offerNameKey, stripePaymentsForEvent, stripePaymentsText } from "@/lib/event-stripe-payments";
import type { EventOfferLink } from "@/lib/event-offer-window";
import { findKajabiMatchesForEvent } from "@/lib/kajabi-event-matching";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const EVENT = "evt_AAAAAAAAAAA1";
const DEPOSIT = "offer_deposit";
const PLAN = "offer_plan";
const DEPOSIT_NAME = "Example Retreat DEPOSIT for Somewhere, Jan 1-4, 2099!";
const PLAN_NAME = "5 Month Payment Plan for Example Retreat!";
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const CUS = "cus_ada";

const charge = (id: string, extra: Record<string, unknown> = {}) => ({
  stripe_charge_id: id,
  stripe_customer_id: CUS,
  amount: 25000,
  amount_refunded: 0,
  paid: true,
  status: "succeeded",
  created_at_stripe: "2098-12-01T15:00:00Z",
  description: DEPOSIT_NAME,
  ...extra,
});
const invoice = (id: string, chargeId: string | null, extra: Record<string, unknown> = {}) => ({
  stripe_invoice_id: id,
  stripe_customer_id: CUS,
  stripe_subscription_id: "sub_plan",
  stripe_charge_id: chargeId,
  amount_paid: 13000,
  created_at_stripe: "2099-01-05T15:00:00Z",
  ...extra,
});
const planSubscription = () => ({
  stripe_subscription_id: "sub_plan",
  stripe_customer_id: CUS,
  created_at_stripe: "2098-12-02T15:00:00Z",
  data: { metadata: { kjb_offer_id: PLAN }, plan: { nickname: PLAN_NAME } },
});

function repos(over: Record<string, unknown> = {}) {
  return createInMemoryRepos(
    new InMemoryDataset({
      ...eventSeed([{ id: EVENT, title: "Example Retreat", slug: "example-retreat" }]),
      members: [
        { id: ADA, name: "Ada Example", email: "ada@example.com", stripeCustomerId: CUS },
        { id: BO, name: "Bo Example", email: "bo@example.com" },
      ],
      kajabiOffers: [
        { kajabi_offer_id: DEPOSIT, name: DEPOSIT_NAME },
        { kajabi_offer_id: PLAN, name: PLAN_NAME },
      ],
      kajabiCustomers: [
        { kajabi_customer_id: "c1", email: "ada@example.com" },
        { kajabi_customer_id: "c2", email: "bo@example.com" },
      ],
      kajabiPurchases: [
        { kajabi_purchase_id: "p1", kajabi_customer_id: "c1", kajabi_offer_id: DEPOSIT, amount_in_cents: 25000, created_at_kajabi: "2098-12-01T15:00:00Z", deactivated_at: null },
        { kajabi_purchase_id: "p2", kajabi_customer_id: "c1", kajabi_offer_id: PLAN, amount_in_cents: 13000, created_at_kajabi: "2098-12-02T15:00:00Z", deactivated_at: "2099-01-20T00:00:00Z" },
        { kajabi_purchase_id: "p3", kajabi_customer_id: "c2", kajabi_offer_id: DEPOSIT, amount_in_cents: 25000, created_at_kajabi: "2098-12-03T15:00:00Z", deactivated_at: null },
      ],
      eventOffers: [
        { event_id: EVENT, kajabi_offer_id: DEPOSIT },
        { event_id: EVENT, kajabi_offer_id: PLAN },
      ],
      stripeSubscriptions: [planSubscription()],
      stripeCharges: [
        charge("ch_deposit"),
        charge("ch_inv1", { amount: 13000, amount_refunded: 13000, refunded: true, description: "Subscription creation", stripe_invoice_id: "in_1" }),
        charge("ch_inv2", { amount: 13000, amount_refunded: 13000, refunded: true, description: "Subscription update", stripe_invoice_id: "in_2" }),
      ],
      stripeInvoices: [invoice("in_1", "ch_inv1"), invoice("in_2", "ch_inv2", { created_at_stripe: "2099-02-05T15:00:00Z" })],
      ...over,
    } as never)
  );
}

const links: EventOfferLink[] = [
  { kajabi_offer_id: DEPOSIT, purchased_from: null, purchased_until: null },
  { kajabi_offer_id: PLAN, purchased_from: null, purchased_until: null },
];
const names = new Map([
  [DEPOSIT, DEPOSIT_NAME],
  [PLAN, PLAN_NAME],
]);
const run = (r: ReturnType<typeof repos>, l = links, who = new Map<string, string | null>([[ADA, CUS]])) => stripePaymentsForEvent(r, l, names, who);

describe("stripePaymentsForEvent", () => {
  it("a forfeited deposit plus a refunded payment plan: charged 510, refunded 260, net 250", async () => {
    const result = await run(repos());
    expect(result.get(ADA)).toEqual({ charged_cents: 51000, refunded_cents: 26000 });
    expect(stripePaymentsText(result.get(ADA)!)).toBe("$510 charged · $260 refunded · net $250");
  });

  it("counts a payment once when its invoice and its charge are both stored, and when an offer is linked twice", async () => {
    const result = await run(repos(), [...links, { kajabi_offer_id: DEPOSIT, purchased_from: "2098-11-01", purchased_until: null }]);
    expect(result.get(ADA)).toEqual({ charged_cents: 51000, refunded_cents: 26000 });
  });

  it("with nothing refunded it is just what was paid", async () => {
    const result = await run(repos({ stripeSubscriptions: [], stripeInvoices: [], stripeCharges: [charge("ch_deposit")] }));
    expect(result.get(ADA)).toEqual({ charged_cents: 25000, refunded_cents: 0 });
    expect(stripePaymentsText(result.get(ADA)!)).toBe("$250 paid");
  });

  it("matches the offer name ignoring case, punctuation and spacing, and skips failed charges", async () => {
    const r = repos({
      stripeSubscriptions: [],
      stripeInvoices: [],
      stripeCharges: [charge("ch_a", { description: "example  retreat deposit for somewhere jan 1-4 2099" }), charge("ch_failed", { paid: false, status: "failed" })],
    });
    expect((await run(r)).get(ADA)).toEqual({ charged_cents: 25000, refunded_cents: 0 });
    expect(offerNameKey("Quill & Cup: Retreat!")).toBe("quill cup retreat");
  });

  it("leaves out a member with no Stripe customer, and charges of other offers", async () => {
    const r = repos({ stripeSubscriptions: [], stripeInvoices: [], stripeCharges: [charge("ch_other", { description: "Something else" })] });
    expect((await run(r)).size).toBe(0);
    expect((await run(repos(), links, new Map([[BO, null]]))).size).toBe(0);
  });

  it("leaves out a charge outside the link's purchase window, and a plan started outside it", async () => {
    const late = [
      { kajabi_offer_id: DEPOSIT, purchased_from: "2099-06-01", purchased_until: null },
      { kajabi_offer_id: PLAN, purchased_from: "2099-06-01", purchased_until: null },
    ];
    expect((await run(repos(), late)).size).toBe(0);
    // Instalments after the window's end still count when the plan started inside it.
    const planOnly = [{ kajabi_offer_id: PLAN, purchased_from: "2098-12-01", purchased_until: "2098-12-31" }];
    expect((await run(repos(), planOnly)).get(ADA)).toEqual({ charged_cents: 26000, refunded_cents: 26000 });
  });

  it("counts an invoice with no stored charge at its amount paid", async () => {
    const r = repos({ stripeCharges: [], stripeInvoices: [invoice("in_1", null)] });
    expect((await run(r)).get(ADA)).toEqual({ charged_cents: 13000, refunded_cents: 0 });
  });
});

describe("stripePaymentsText", () => {
  it("says so when there is nothing, and shows cents when not whole dollars", () => {
    expect(stripePaymentsText(null)).toBe("no Stripe payments found");
    expect(stripePaymentsText({ charged_cents: 10625, refunded_cents: 0 })).toBe("$106.25 paid");
  });
});

describe("findKajabiMatchesForEvent buyers' Stripe money", () => {
  it("shows Stripe's figure, never Kajabi's amount, and null for a buyer with no Stripe customer", async () => {
    const { buyers } = await findKajabiMatchesForEvent(repos(), EVENT);
    const byName = Object.fromEntries(buyers.map((b) => [b.member_name, b]));
    expect(byName["Ada Example"].stripe).toEqual({ charged_cents: 51000, refunded_cents: 26000 });
    expect(byName["Bo Example"].stripe).toBeNull();
    expect(buyers.every((b) => !("amount_in_cents" in b))).toBe(true);
  });
});
