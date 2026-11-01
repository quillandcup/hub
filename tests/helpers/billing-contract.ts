import { describe, it, expect, beforeEach } from "vitest";
import type {
  BillingRepository,
  KajabiContactSeed,
  KajabiCustomerSeed,
  KajabiOfferSeed,
  KajabiPurchaseSeed,
  StripeCustomerSeed,
  StripeProductSeed,
  StripeSubscriptionSeed,
} from "@/lib/data/billing";

export type BillingSeed = {
  kajabiContacts?: KajabiContactSeed[];
  kajabiCustomers?: KajabiCustomerSeed[];
  kajabiPurchases?: KajabiPurchaseSeed[];
  kajabiOffers?: KajabiOfferSeed[];
  stripeCustomers?: StripeCustomerSeed[];
  stripeProducts?: StripeProductSeed[];
  stripeSubscriptions?: StripeSubscriptionSeed[];
};

/** The tables the imports write to, by name. */
export type BillingTable =
  | "kajabi_contacts"
  | "kajabi_customers"
  | "kajabi_purchases"
  | "kajabi_offers"
  | "kajabi_members"
  | "stripe_customers"
  | "stripe_products"
  | "stripe_subscriptions"
  | "subscription_history";

export type BillingContractContext = {
  repo: () => BillingRepository;
  /** A string no other run has used (ids, emails and names are unique across the tables). */
  unique: (label: string) => string;
  /** Replaces the rows this context made with these. */
  seed: (rows: BillingSeed) => Promise<void>;
  /** The stored rows of a table whose `column` is one of `values` (what a write left behind), read without the repository. */
  stored: (table: BillingTable, column: string, values: string[]) => Promise<Record<string, unknown>[]>;
  /** Removes what the writes in this context stored (rows whose `column` is one of `values`). */
  removeStored: (table: BillingTable, column: string, values: string[]) => Promise<void>;
};

const at = (iso: string) => Date.parse(iso);

/** Behavior every `BillingRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineBillingContract(name: string, setup: () => BillingContractContext) {
  describe(`${name} (BillingRepository contract)`, () => {
    let ctx: BillingContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const email = (label: string) => `${ctx.unique(label).toLowerCase()}@example.test`;
    const mine = <T>(rows: T[], key: (row: T) => string, seeded: string[]) => rows.filter((r) => seeded.includes(key(r)));

    it("reads contacts as references and as full rows, and one contact's record", async () => {
      const a: KajabiContactSeed = { kajabi_contact_id: ctx.unique("c-a"), email: email("a"), name: "Ada Example", data: { attributes: { bio: "hi" } } };
      const b: KajabiContactSeed = { kajabi_contact_id: ctx.unique("c-b"), email: email("b"), name: null };
      await ctx.seed({ kajabiContacts: [b, a] });
      const ids = [a.kajabi_contact_id, b.kajabi_contact_id];

      expect(mine(await ctx.repo().kajabiContacts(), (r) => r.kajabi_contact_id, ids)).toEqual(
        [a, b].sort((x, y) => (x.kajabi_contact_id < y.kajabi_contact_id ? -1 : 1)).map((c) => ({ kajabi_contact_id: c.kajabi_contact_id, email: c.email, name: c.name ?? null }))
      );
      const rows = mine(await ctx.repo().kajabiContactRows(), (r) => r.kajabi_contact_id, ids);
      expect(rows.map((r) => r.kajabi_contact_id)).toEqual([...ids].sort());
      expect(rows.find((r) => r.kajabi_contact_id === a.kajabi_contact_id)?.data).toEqual(a.data);
      expect(await ctx.repo().kajabiContactData(a.kajabi_contact_id)).toEqual(a.data);
      expect(await ctx.repo().kajabiContactData(ctx.unique("nobody"))).toBeNull();
    });

    it("reads every contact past a thousand", async () => {
      const contacts: KajabiContactSeed[] = Array.from({ length: 1050 }, (_, i) => ({
        kajabi_contact_id: ctx.unique(`many-${i}`),
        email: email(`many-${i}`),
      }));
      await ctx.seed({ kajabiContacts: contacts });

      const ids = contacts.map((c) => c.kajabi_contact_id);
      expect(mine(await ctx.repo().kajabiContacts(), (r) => r.kajabi_contact_id, ids)).toHaveLength(1050);
      expect(mine(await ctx.repo().kajabiContactRows(), (r) => r.kajabi_contact_id, ids)).toHaveLength(1050);
    });

    it("says when the newest contact, purchase and subscription was imported", async () => {
      await ctx.seed({
        kajabiContacts: [
          { kajabi_contact_id: ctx.unique("old"), email: email("old"), imported_at: "2090-01-01T00:00:00.000Z" },
          { kajabi_contact_id: ctx.unique("new"), email: email("new"), imported_at: "2091-01-01T00:00:00.000Z" },
        ],
        kajabiPurchases: [{ kajabi_purchase_id: ctx.unique("p"), imported_at: "2091-02-01T00:00:00.000Z" }],
        stripeSubscriptions: [{ stripe_subscription_id: ctx.unique("s"), stripe_customer_id: ctx.unique("cus"), status: "active", imported_at: "2091-03-01T00:00:00.000Z" }],
      });

      expect(at((await ctx.repo().lastKajabiContactImportAt())!)).toBeGreaterThanOrEqual(at("2091-01-01T00:00:00.000Z"));
      expect(at((await ctx.repo().lastKajabiPurchaseImportAt())!)).toBeGreaterThanOrEqual(at("2091-02-01T00:00:00.000Z"));
      expect(at((await ctx.repo().lastStripeSubscriptionImportAt())!)).toBeGreaterThanOrEqual(at("2091-03-01T00:00:00.000Z"));
    });

    it("finds customers by email and by id, with the record and when Kajabi last changed it", async () => {
      const a: KajabiCustomerSeed = { kajabi_customer_id: ctx.unique("k-a"), email: email("ka"), data: { n: 1 }, updated_at_kajabi: "2024-01-01T00:00:00+00:00" };
      const b: KajabiCustomerSeed = { kajabi_customer_id: ctx.unique("k-b"), email: email("kb"), data: { n: 2 }, updated_at_kajabi: "2025-01-01T00:00:00+00:00" };
      const c: KajabiCustomerSeed = { kajabi_customer_id: ctx.unique("k-c"), email: email("kc") };
      await ctx.seed({ kajabiCustomers: [c, b, a] });
      const refs = (cs: KajabiCustomerSeed[]) =>
        [...cs].sort((x, y) => (x.kajabi_customer_id < y.kajabi_customer_id ? -1 : 1)).map((x) => ({ kajabi_customer_id: x.kajabi_customer_id, email: x.email }));

      expect(await ctx.repo().kajabiCustomers({ emails: [a.email, b.email, "nobody@example.test", a.email] })).toEqual(refs([a, b]));
      expect(await ctx.repo().kajabiCustomers({ emails: [] })).toEqual([]);
      expect(await ctx.repo().kajabiCustomers({ customerIds: [c.kajabi_customer_id, a.kajabi_customer_id, ctx.unique("missing")] })).toEqual(refs([a, c]));
      expect(await ctx.repo().kajabiCustomers({ customerIds: [] })).toEqual([]);
      const profiles = await ctx.repo().kajabiCustomerProfilesByEmail([a.email, b.email]);
      expect(profiles.map((p) => p.data)).toEqual([{ n: 1 }, { n: 2 }]);
      expect(profiles.map((p) => at(p.updated_at_kajabi!))).toEqual([at("2024-01-01T00:00:00Z"), at("2025-01-01T00:00:00Z")]);

      const ids = [a, b, c].map((x) => x.kajabi_customer_id);
      expect(mine(await ctx.repo().kajabiCustomers(), (r) => r.kajabi_customer_id, ids)).toEqual(refs([a, b, c]));
      expect(mine(await ctx.repo().kajabiCustomerRows(), (r) => r.kajabi_customer_id, ids).map((r) => r.email)).toEqual(refs([a, b, c]).map((r) => r.email));
    });

    it("looks customers up past one chunk of ids and emails", async () => {
      const customers: KajabiCustomerSeed[] = Array.from({ length: 250 }, (_, i) => ({
        kajabi_customer_id: ctx.unique(`bulk-${i}`),
        email: email(`bulk-${i}`),
      }));
      await ctx.seed({ kajabiCustomers: customers });

      expect(await ctx.repo().kajabiCustomers({ customerIds: customers.map((c) => c.kajabi_customer_id) })).toHaveLength(250);
      expect(await ctx.repo().kajabiCustomers({ emails: customers.map((c) => c.email) })).toHaveLength(250);
      expect(await ctx.repo().kajabiCustomerProfilesByEmail(customers.map((c) => c.email))).toHaveLength(250);
    });

    it("reads offers by name and by id, their names and the full rows", async () => {
      const a: KajabiOfferSeed = { kajabi_offer_id: ctx.unique("o-a"), name: `${ctx.unique("Zeta")} Membership`, data: { attributes: { subscription: true } }, trial_period_days: 7 };
      const b: KajabiOfferSeed = { kajabi_offer_id: ctx.unique("o-b"), name: `${ctx.unique("Alpha")} Program`, trial_period_days: null };
      const c: KajabiOfferSeed = { kajabi_offer_id: ctx.unique("o-c"), name: null };
      await ctx.seed({ kajabiOffers: [a, b, c] });

      expect(await ctx.repo().kajabiOffersByName([a.name!, "No such offer"])).toEqual([{ kajabi_offer_id: a.kajabi_offer_id, name: a.name }]);
      expect(await ctx.repo().kajabiOffersByName([])).toEqual([]);
      expect(await ctx.repo().kajabiOffersByIds([a.kajabi_offer_id, c.kajabi_offer_id, ctx.unique("missing")])).toEqual(
        [a, c]
          .sort((x, y) => (x.kajabi_offer_id < y.kajabi_offer_id ? -1 : 1))
          .map((o) => ({ kajabi_offer_id: o.kajabi_offer_id, name: o.name ?? null, data: o.data ?? {}, trial_period_days: o.trial_period_days ?? null }))
      );
      expect(await ctx.repo().kajabiOffersByIds([])).toEqual([]);
      const names = (await ctx.repo().kajabiOfferNames()).filter((n) => n === a.name || n === b.name);
      expect(names).toEqual([b.name, a.name]);
      expect((await ctx.repo().kajabiOfferNames()).every((n) => !!n)).toBe(true);
      const rows = mine(await ctx.repo().kajabiOfferRows(), (r) => r.kajabi_offer_id, [a, b, c].map((o) => o.kajabi_offer_id));
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.kajabi_offer_id === a.kajabi_offer_id)?.trial_period_days).toBe(7);
    });

    it("reads purchases by offer, creation time, customer and status", async () => {
      const offerA = ctx.unique("offer-a");
      const offerB = ctx.unique("offer-b");
      const cust1 = ctx.unique("cust-1");
      const cust2 = ctx.unique("cust-2");
      const purchase = (label: string, extra: Partial<KajabiPurchaseSeed>): KajabiPurchaseSeed => ({ kajabi_purchase_id: ctx.unique(label), ...extra });
      const p1 = purchase("p1", { kajabi_offer_id: offerA, kajabi_customer_id: cust1, status: "active", created_at_kajabi: "2024-03-01T00:00:00+00:00", data: { x: 1 } });
      const p2 = purchase("p2", { kajabi_offer_id: offerA, kajabi_customer_id: cust2, status: "canceled", created_at_kajabi: "2024-01-01T00:00:00+00:00", deactivated_at: "2024-02-01T00:00:00+00:00" });
      const p3 = purchase("p3", { kajabi_offer_id: offerB, kajabi_customer_id: cust1, status: "active", created_at_kajabi: "2025-01-01T00:00:00+00:00" });
      const p4 = purchase("p4", { kajabi_offer_id: offerB, kajabi_customer_id: cust2, status: "active", created_at_kajabi: null });
      await ctx.seed({ kajabiPurchases: [p1, p2, p3, p4] });
      const idsOf = (rows: { kajabi_purchase_id: string }[]) => rows.map((r) => r.kajabi_purchase_id);
      const sorted = (...ps: KajabiPurchaseSeed[]) => ps.map((p) => p.kajabi_purchase_id).sort();

      expect(idsOf(await ctx.repo().kajabiPurchaseRows({ offerIds: [offerA] }))).toEqual(sorted(p1, p2));
      expect(idsOf(await ctx.repo().kajabiPurchaseRows({ offerIds: [offerA, offerB], stillActive: true }))).toEqual(sorted(p1, p3, p4));
      expect(await ctx.repo().kajabiPurchaseRows({ offerIds: [] })).toEqual([]);
      expect((await ctx.repo().kajabiPurchaseRows({ offerIds: [offerA] })).find((r) => r.kajabi_purchase_id === p1.kajabi_purchase_id)?.data).toEqual({ x: 1 });
      expect(idsOf(mine(await ctx.repo().kajabiPurchaseRows(), (r) => r.kajabi_purchase_id, sorted(p1, p2, p3, p4)))).toEqual(sorted(p1, p2, p3, p4));

      expect(idsOf(await ctx.repo().kajabiPurchases({ offerIds: [offerB] }))).toEqual(sorted(p3, p4));
      // `created_at >= x` does not match a purchase with no creation time.
      expect(idsOf(await ctx.repo().kajabiPurchases({ offerIds: [offerA, offerB], createdSince: "2024-03-01T00:00:00Z" }))).toEqual(sorted(p1, p3));
      expect(await ctx.repo().kajabiPurchases({ offerIds: [] })).toEqual([]);
      const summary = (await ctx.repo().kajabiPurchases({ offerIds: [offerA] })).find((r) => r.kajabi_purchase_id === p2.kajabi_purchase_id)!;
      expect(summary).toMatchObject({ kajabi_customer_id: cust2, kajabi_offer_id: offerA, status: "canceled" });
      expect(summary).not.toHaveProperty("data");
      expect(at(summary.deactivated_at!)).toBe(at("2024-02-01T00:00:00Z"));
      expect(mine(await ctx.repo().kajabiPurchases(), (r) => r.kajabi_purchase_id, sorted(p1, p2, p3, p4))).toHaveLength(4);

      // Oldest first, a purchase with no creation time last.
      expect(idsOf(await ctx.repo().kajabiPurchasesByCustomers([cust1, cust2, ctx.unique("none")]))).toEqual([p2, p1, p3, p4].map((p) => p.kajabi_purchase_id));
      expect(await ctx.repo().kajabiPurchasesByCustomers([])).toEqual([]);
    });

    it("lists the customers with an active purchase", async () => {
      const [c1, c2, c3] = [ctx.unique("c1"), ctx.unique("c2"), ctx.unique("c3")];
      await ctx.seed({
        kajabiPurchases: [
          { kajabi_purchase_id: ctx.unique("a"), kajabi_customer_id: c1, status: "active" },
          { kajabi_purchase_id: ctx.unique("b"), kajabi_customer_id: c1, status: "active" },
          { kajabi_purchase_id: ctx.unique("c"), kajabi_customer_id: c2, status: "canceled" },
          { kajabi_purchase_id: ctx.unique("d"), kajabi_customer_id: null, status: "active" },
        ],
      });

      expect([...(await ctx.repo().activeKajabiPurchaseCustomerIds([c1, c2, c3]))]).toEqual([c1]);
      expect(await ctx.repo().activeKajabiPurchaseCustomerIds([])).toEqual(new Set());
      const all = await ctx.repo().activeKajabiPurchaseCustomerIds();
      expect(all.has(c1)).toBe(true);
      expect(all.has(c2)).toBe(false);
    });

    it("reads Stripe customers, with the record or filtered by email", async () => {
      const a: StripeCustomerSeed = { stripe_customer_id: ctx.unique("cus-a"), email: email("sa"), name: "Ada Example", data: { name: "Ada Example" } };
      const b: StripeCustomerSeed = { stripe_customer_id: ctx.unique("cus-b"), email: null };
      await ctx.seed({ stripeCustomers: [b, a] });
      const ids = [a.stripe_customer_id, b.stripe_customer_id];

      expect(mine(await ctx.repo().stripeCustomers(), (r) => r.stripe_customer_id, ids)).toEqual([
        { stripe_customer_id: a.stripe_customer_id, email: a.email, name: "Ada Example" },
        { stripe_customer_id: b.stripe_customer_id, email: null, name: null },
      ].sort((x, y) => (x.stripe_customer_id < y.stripe_customer_id ? -1 : 1)));
      expect(await ctx.repo().stripeCustomers({ emails: [a.email!, "nobody@example.test"] })).toEqual([{ stripe_customer_id: a.stripe_customer_id, email: a.email, name: "Ada Example" }]);
      expect(await ctx.repo().stripeCustomers({ emails: [] })).toEqual([]);
      const withData = mine(await ctx.repo().stripeCustomersWithData(), (r) => r.stripe_customer_id, ids);
      expect(withData.find((r) => r.stripe_customer_id === a.stripe_customer_id)).toEqual({ stripe_customer_id: a.stripe_customer_id, email: a.email, data: { name: "Ada Example" } });
    });

    it("finds Stripe products by name", async () => {
      const a: StripeProductSeed = { stripe_product_id: ctx.unique("prod-a"), name: ctx.unique("Membership A") };
      const b: StripeProductSeed = { stripe_product_id: ctx.unique("prod-b"), name: ctx.unique("Retreat") };
      await ctx.seed({ stripeProducts: [b, a] });

      expect(await ctx.repo().stripeProductsByName([a.name, "No such product"])).toEqual([{ stripe_product_id: a.stripe_product_id, name: a.name }]);
      expect((await ctx.repo().stripeProductsByName([a.name, b.name])).map((p) => p.stripe_product_id)).toEqual([a.stripe_product_id, b.stripe_product_id].sort());
      expect(await ctx.repo().stripeProductsByName([])).toEqual([]);
    });

    it("reads Stripe subscriptions by status and by customer", async () => {
      const [cus1, cus2] = [ctx.unique("cus1"), ctx.unique("cus2")];
      const sub = (label: string, customer: string, extra: Partial<StripeSubscriptionSeed> = {}): StripeSubscriptionSeed => ({
        stripe_subscription_id: ctx.unique(label),
        stripe_customer_id: customer,
        ...extra,
      });
      const s1 = sub("s1", cus1, { status: "active", created_at_stripe: "2024-01-01T00:00:00+00:00", data: { trial_end: 1 } });
      const s2 = sub("s2", cus1, { status: "canceled", canceled_at: "2024-06-01T00:00:00+00:00", created_at_stripe: "2023-01-01T00:00:00+00:00" });
      const s3 = sub("s3", cus2, { status: "trialing" });
      await ctx.seed({ stripeSubscriptions: [s3, s2, s1] });
      const sortedIds = (...ss: StripeSubscriptionSeed[]) => ss.map((s) => s.stripe_subscription_id).sort();

      expect(await ctx.repo().stripeSubscriptionStatuses(["active", "trialing"], [cus1, cus2])).toEqual([
        { stripe_customer_id: cus1, status: "active" },
        { stripe_customer_id: cus2, status: "trialing" },
      ]);
      expect(await ctx.repo().stripeSubscriptionStatuses(["canceled"], [cus1])).toEqual([{ stripe_customer_id: cus1, status: "canceled" }]);
      expect(await ctx.repo().stripeSubscriptionStatuses(["active"], [])).toEqual([]);
      expect((await ctx.repo().stripeSubscriptionStatuses(["trialing"])).some((s) => s.stripe_customer_id === cus2)).toBe(true);

      const active = (await ctx.repo().stripeSubscriptionsWithStatus("active")).filter((s) => s.stripe_customer_id === cus1);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ stripe_subscription_id: s1.stripe_subscription_id, status: "active", data: { trial_end: 1 } });

      const trials = await ctx.repo().stripeSubscriptionsByCustomers([cus1, ctx.unique("none")]);
      expect(trials.map((t) => t.stripe_customer_id)).toEqual([cus1, cus1]);
      expect(new Set(trials.map((t) => (t.canceled_at ? at(t.canceled_at) : null)))).toEqual(new Set([null, at("2024-06-01T00:00:00Z")]));
      expect(await ctx.repo().stripeSubscriptionsByCustomers([])).toEqual([]);

      expect(mine(await ctx.repo().stripeSubscriptionRows(), (r) => r.stripe_subscription_id, sortedIds(s1, s2, s3)).map((r) => r.stripe_subscription_id)).toEqual(sortedIds(s1, s2, s3));
    });

    describe("the imports' writes", () => {
      const NOW = "2026-10-01T00:00:00.000Z";
      const LATER = "2026-10-02T00:00:00.000Z";
      const one = async (table: BillingTable, column: string, value: string) => {
        const rows = await ctx.stored(table, column, [value]);
        expect(rows).toHaveLength(1);
        return rows[0];
      };

      it("adds Kajabi contacts, and replaces the same contact when imported again", async () => {
        const id = ctx.unique("w-contact");
        const row = { kajabi_contact_id: id, email: email("w1"), name: "Ada Example", data: { v: 1 }, imported_at: NOW };
        try {
          await ctx.repo().upsertKajabiContacts([row]);
          expect(await one("kajabi_contacts", "kajabi_contact_id", id)).toMatchObject({ email: row.email, name: "Ada Example", data: { v: 1 } });

          await ctx.repo().upsertKajabiContacts([{ ...row, name: "Ada E", data: { v: 2 }, imported_at: LATER }]);
          expect(await one("kajabi_contacts", "kajabi_contact_id", id)).toMatchObject({ name: "Ada E", data: { v: 2 } });
          await ctx.repo().upsertKajabiContacts([]);
        } finally {
          await ctx.removeStored("kajabi_contacts", "kajabi_contact_id", [id]);
        }
      });

      it("writes past one chunk of contacts without duplicating them on a second run", async () => {
        const rows = Array.from({ length: 1100 }, (_, i) => ({ kajabi_contact_id: ctx.unique(`w-many-${i}`), email: email(`w-many-${i}`), data: {}, imported_at: NOW }));
        const ids = rows.map((r) => r.kajabi_contact_id);
        try {
          await ctx.repo().upsertKajabiContacts(rows);
          await ctx.repo().upsertKajabiContacts(rows);
          expect((await ctx.stored("kajabi_contacts", "kajabi_contact_id", ids)).length).toBe(1100);
        } finally {
          await ctx.removeStored("kajabi_contacts", "kajabi_contact_id", ids);
        }
      });

      it("changes a contact's email, and leaves other contacts alone", async () => {
        const [a, b] = [ctx.unique("w-email-a"), ctx.unique("w-email-b")];
        const [emailA, emailB] = [email("w-ea"), email("w-eb")];
        try {
          await ctx.repo().upsertKajabiContacts([
            { kajabi_contact_id: a, email: emailA, data: {} },
            { kajabi_contact_id: b, email: emailB, data: {} },
          ]);

          await ctx.repo().setKajabiContactEmail(a, "new@example.test");

          expect(await one("kajabi_contacts", "kajabi_contact_id", a)).toMatchObject({ email: "new@example.test" });
          expect(await one("kajabi_contacts", "kajabi_contact_id", b)).toMatchObject({ email: emailB });
        } finally {
          await ctx.removeStored("kajabi_contacts", "kajabi_contact_id", [a, b]);
        }
      });

      it("adds and replaces Kajabi customers, purchases and offers", async () => {
        const customer = { kajabi_customer_id: ctx.unique("w-cust"), email: email("w-c"), data: { v: 1 }, imported_at: NOW };
        const purchase = { kajabi_purchase_id: ctx.unique("w-pur"), kajabi_customer_id: customer.kajabi_customer_id, status: "active", amount_in_cents: 100, data: {}, imported_at: NOW };
        const offer = { kajabi_offer_id: ctx.unique("w-off"), name: "Membership", trial_period_days: 7, data: {}, imported_at: NOW };
        try {
          await ctx.repo().upsertKajabiCustomers([customer]);
          await ctx.repo().upsertKajabiPurchases([purchase]);
          await ctx.repo().upsertKajabiOffers([offer]);
          await ctx.repo().upsertKajabiCustomers([{ ...customer, data: { v: 2 } }]);
          await ctx.repo().upsertKajabiPurchases([{ ...purchase, status: "canceled" }]);
          await ctx.repo().upsertKajabiOffers([{ ...offer, name: "Renamed", trial_period_days: null }]);

          expect(await one("kajabi_customers", "kajabi_customer_id", customer.kajabi_customer_id)).toMatchObject({ data: { v: 2 } });
          expect(await one("kajabi_purchases", "kajabi_purchase_id", purchase.kajabi_purchase_id)).toMatchObject({ status: "canceled", amount_in_cents: 100 });
          expect(await one("kajabi_offers", "kajabi_offer_id", offer.kajabi_offer_id)).toMatchObject({ name: "Renamed", trial_period_days: null });
          // The reads see what the writes stored.
          expect(await ctx.repo().kajabiCustomers({ customerIds: [customer.kajabi_customer_id] })).toEqual([{ kajabi_customer_id: customer.kajabi_customer_id, email: customer.email }]);
        } finally {
          await ctx.removeStored("kajabi_customers", "kajabi_customer_id", [customer.kajabi_customer_id]);
          await ctx.removeStored("kajabi_purchases", "kajabi_purchase_id", [purchase.kajabi_purchase_id]);
          await ctx.removeStored("kajabi_offers", "kajabi_offer_id", [offer.kajabi_offer_id]);
        }
      });

      it("adds one snapshot row per member of a members export, each import on top of the last", async () => {
        const address = email("w-member");
        try {
          await ctx.repo().insertKajabiMembers([{ email: address, data: { Name: "Ada Example" }, imported_at: NOW }]);
          await ctx.repo().insertKajabiMembers([{ email: address, data: { Name: "Ada Example" }, imported_at: LATER }]);
          await ctx.repo().insertKajabiMembers([]);

          expect(await ctx.stored("kajabi_members", "email", [address])).toHaveLength(2);
        } finally {
          await ctx.removeStored("kajabi_members", "email", [address]);
        }
      });

      it("adds and replaces Stripe customers, products and subscriptions", async () => {
        const customer = { stripe_customer_id: ctx.unique("w-cus"), email: email("w-s"), name: "Ada Example", data: {}, imported_at: NOW };
        const product = { stripe_product_id: ctx.unique("w-prod"), name: "Membership", active: true, data: {}, imported_at: NOW };
        const subscription = { stripe_subscription_id: ctx.unique("w-sub"), stripe_customer_id: customer.stripe_customer_id, status: "trialing", data: {}, imported_at: NOW };
        try {
          await ctx.repo().upsertStripeCustomers([customer]);
          await ctx.repo().upsertStripeProducts([product]);
          await ctx.repo().upsertStripeSubscriptions([subscription]);
          await ctx.repo().upsertStripeCustomers([{ ...customer, name: "Ada E" }]);
          await ctx.repo().upsertStripeProducts([{ ...product, active: false }]);
          await ctx.repo().upsertStripeSubscriptions([{ ...subscription, status: "active" }]);

          expect(await one("stripe_customers", "stripe_customer_id", customer.stripe_customer_id)).toMatchObject({ name: "Ada E" });
          expect(await one("stripe_products", "stripe_product_id", product.stripe_product_id)).toMatchObject({ active: false });
          expect(await one("stripe_subscriptions", "stripe_subscription_id", subscription.stripe_subscription_id)).toMatchObject({ status: "active" });
          expect(await ctx.repo().stripeSubscriptionStatuses(["active"], [customer.stripe_customer_id])).toEqual([{ stripe_customer_id: customer.stripe_customer_id, status: "active" }]);
        } finally {
          await ctx.removeStored("stripe_customers", "stripe_customer_id", [customer.stripe_customer_id]);
          await ctx.removeStored("stripe_products", "stripe_product_id", [product.stripe_product_id]);
          await ctx.removeStored("stripe_subscriptions", "stripe_subscription_id", [subscription.stripe_subscription_id]);
        }
      });

      it("keeps one subscription export row per subscription and import time, and says how many it wrote", async () => {
        const id = ctx.unique("w-ksub");
        const row = { kajabi_subscription_id: id, customer_email: email("w-h"), status: "Active", imported_at: NOW, data: { v: 1 } };
        try {
          expect(await ctx.repo().upsertSubscriptionHistory([row])).toBe(1);
          // The same export again changes nothing; a later export adds a snapshot.
          expect(await ctx.repo().upsertSubscriptionHistory([{ ...row, status: "Canceled" }])).toBe(1);
          expect(await ctx.repo().upsertSubscriptionHistory([{ ...row, imported_at: LATER }])).toBe(1);
          expect(await ctx.repo().upsertSubscriptionHistory([])).toBe(0);

          const rows = await ctx.stored("subscription_history", "kajabi_subscription_id", [id]);
          expect(rows).toHaveLength(2);
          expect(rows.map((r) => r.status).sort()).toEqual(["Active", "Canceled"]);
        } finally {
          await ctx.removeStored("subscription_history", "kajabi_subscription_id", [id]);
        }
      });
    });
  });
}
