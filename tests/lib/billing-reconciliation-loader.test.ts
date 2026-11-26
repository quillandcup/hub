import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadBillingOverview, loadMemberSchedules, monthsAgoStart, toReconSubscription } from "@/lib/billing-reconciliation-loader";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const NOW = () => Date.parse("2026-05-20T16:00:00Z");

const invoice = (id: string, customer: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  stripe_invoice_id: id,
  stripe_customer_id: customer,
  stripe_product_id: "prod_m",
  status: "paid",
  amount_paid: 4700,
  amount_due: 4700,
  created_at_stripe: createdAt,
  ...extra,
});

const dataset = () =>
  new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" },
      { id: BEA, name: "Bea Example", email: "bea@example.test", status: "active", stripeCustomerId: "cus_bea" },
    ],
    stripeProducts: [
      { stripe_product_id: "prod_m", name: "Quill & Cup Membership" },
      { stripe_product_id: "prod_x", name: "A Retreat" },
    ],
    stripeSubscriptions: [
      { stripe_subscription_id: "sub_ada", stripe_customer_id: "cus_ada", status: "active", created_at_stripe: "2026-03-09T15:00:00Z", data: { billing_cycle_anchor: unix("2026-03-09T15:00:00Z") } },
      { stripe_subscription_id: "sub_bea", stripe_customer_id: "cus_bea", status: "active", created_at_stripe: "2026-03-09T15:00:00Z", data: { billing_cycle_anchor: unix("2026-03-09T15:00:00Z") } },
    ],
    stripeInvoices: [
      invoice("in_a1", "cus_ada", "2026-03-09T15:00:00Z"),
      invoice("in_a2", "cus_ada", "2026-04-09T15:00:00Z"),
      invoice("in_a3", "cus_ada", "2026-05-09T15:00:00Z"),
      invoice("in_b1", "cus_bea", "2026-03-09T15:00:00Z"),
      invoice("in_bx", "cus_bea", "2026-04-09T15:00:00Z", { stripe_product_id: "prod_x" }),
    ],
    memberHiatuses: [{ id: "hia_AAAAAAAAAAA1", member_id: BEA, start_date: "2026-04-01", end_date: "2026-04-30", reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-04-01T00:00:00Z" }],
  } as never);

describe("loadBillingOverview", () => {
  useFakeClock(NOW);

  it("builds each linked member's schedule from the repositories, naming only the members involved", async () => {
    const overview = await loadBillingOverview(createInMemoryRepos(dataset()));
    expect(overview.today).toBe("2026-05-20");
    expect(overview.counts).toEqual({ linkedMembers: 2, invoices: 5, charges: 0, subscriptions: 2, purchases: 0 });
    const ada = overview.schedules.find((s) => s.memberId === ADA)!;
    expect(ada.rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ["2026-03-09", "paid"],
      ["2026-04-09", "paid"],
      ["2026-05-09", "paid"],
    ]);
    const bea = overview.schedules.find((s) => s.memberId === BEA)!;
    // April is inside her hiatus: not expected, so the retreat invoice and the missing membership invoice are no problem; May was never billed.
    expect(bea.rows.map((r) => [r.expectedDate, r.status])).toEqual([
      ["2026-03-09", "paid"],
      ["2026-04-09", "not_expected"],
      ["2026-05-09", "missed"],
    ]);
    expect(overview.members.get(ADA)).toMatchObject({ name: "Ada Example", displayName: "Ada E." });
  });

  it("is empty when no member is linked to Stripe", async () => {
    const overview = await loadBillingOverview(createInMemoryRepos(new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", status: "active" }] } as never)));
    expect(overview.schedules).toEqual([]);
    expect(overview.counts.linkedMembers).toBe(0);
  });

  it("treats a program that includes membership as covering the months of its cohort", async () => {
    const data = dataset();
    data.programs.push({ id: "prg_1", name: "Ready Writers", slug: "rw", description: null, includes_membership: true, kajabi_offer_names: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    data.programs.push({ id: "prg_2", name: "A Course", slug: "c", description: null, includes_membership: false, kajabi_offer_names: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    for (const [i, programId] of [["1", "prg_1"], ["2", "prg_2"]] as const) {
      data.programCohorts.push({ id: `coh_${i}`, program_id: programId, name: i, starts_at: "2026-04-01", expires_at: "2026-04-30", notes: null, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
      data.programEnrollments.push({ id: `enrl_${i}`, member_id: ADA, cohort_id: `coh_${i}`, notes: null, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    }
    const overview = await loadBillingOverview(createInMemoryRepos(data));
    expect(overview.schedules.find((s) => s.memberId === ADA)!.rows.find((r) => r.expectedDate === "2026-04-09")?.status).toBe("charged_when_not_expected");
  });
});

describe("loadMemberSchedules", () => {
  useFakeClock(NOW);

  it("builds one member's schedule from invoices already read, using their hiatuses and program cohorts", async () => {
    const repos = createInMemoryRepos(dataset());
    const invoices = await repos.billing.stripeInvoices({ customerIds: ["cus_bea"] });
    const schedules = await loadMemberSchedules(repos, { id: BEA, status: "active" }, ["cus_bea"], invoices, []);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].rows.map((r) => r.status)).toEqual(["paid", "not_expected", "missed"]);
  });

  it("covers the member's whole history, where the overview looks back 12 months", async () => {
    const data = dataset();
    data.stripeInvoices.push(invoice("in_old", "cus_bea", "2024-06-09T15:00:00Z") as never);
    const repos = createInMemoryRepos(data);
    const invoices = await repos.billing.stripeInvoices({ customerIds: ["cus_bea"] });
    const [own] = await loadMemberSchedules(repos, { id: BEA, status: "active" }, ["cus_bea"], invoices, []);
    expect(own.rows.some((r) => r.transactions.some((t) => t.invoiceId === "in_old"))).toBe(true);
    expect(own.start).toBe("2024-06-09");
    const overview = (await loadBillingOverview(repos)).schedules.find((s) => s.memberId === BEA)!;
    expect(overview.rows.some((r) => r.transactions.some((t) => t.invoiceId === "in_old"))).toBe(false);
    expect(overview.notes[0]).toContain("1 earlier invoice is not listed");
  });

  it("builds nothing without a Stripe customer", async () => {
    expect(await loadMemberSchedules(createInMemoryRepos(dataset()), { id: ADA, status: "active" }, [], [], [])).toEqual([]);
  });
});

describe("helpers", () => {
  it("reads the anchor and pause from the raw subscription, and skips one without a creation time", () => {
    const row = { stripe_subscription_id: "s", stripe_customer_id: "c", status: "active", created_at_stripe: "2026-01-01T00:00:00Z", canceled_at: null } as never as Parameters<typeof toReconSubscription>[0];
    expect(toReconSubscription({ ...row, data: { billing_cycle_anchor: 1_767_225_600, pause_collection: { behavior: "void" } } })).toMatchObject({ billingAnchor: "2026-01-01T00:00:00.000Z", paused: true });
    // Paused with a resume date (Unix seconds) and without one.
    expect(toReconSubscription({ ...row, data: { pause_collection: { behavior: "void", resumes_at: 1_780_000_000 } } })).toMatchObject({
      paused: true,
      pauseBehavior: "void",
      pauseResumesAt: "2026-05-28T20:26:40.000Z",
    });
    expect(toReconSubscription({ ...row, data: { pause_collection: { behavior: "mark_uncollectible" } } })).toMatchObject({ paused: true, pauseBehavior: "mark_uncollectible", pauseResumesAt: null });
    expect(toReconSubscription({ ...row, data: { pause_collection: null } })).toMatchObject({ paused: false, pauseBehavior: null });
    expect(toReconSubscription({ ...row, data: null })).toMatchObject({ billingAnchor: null, paused: false });
    expect(toReconSubscription({ ...row, data: [] })).toMatchObject({ billingAnchor: null });
    expect(toReconSubscription({ ...row, created_at_stripe: null })).toBeNull();
  });

  it("carries the collection method from the raw subscription", () => {
    const row = { stripe_subscription_id: "s", stripe_customer_id: "c", status: "active", created_at_stripe: "2026-01-01T00:00:00Z", canceled_at: null } as never as Parameters<typeof toReconSubscription>[0];
    expect(toReconSubscription({ ...row, data: { collection_method: "send_invoice" } })).toMatchObject({ collectionMethod: "send_invoice" });
    expect(toReconSubscription({ ...row, data: { collection_method: "charge_automatically" } })).toMatchObject({ collectionMethod: "charge_automatically" });
    expect(toReconSubscription({ ...row, data: {} })).toMatchObject({ collectionMethod: null });
    expect(toReconSubscription({ ...row, data: { collection_method: 3 } })).toMatchObject({ collectionMethod: null });
  });

  it("counts months back from the first of the month", () => {
    expect(monthsAgoStart("2026-05-20", 24)).toBe("2024-05-01T00:00:00.000Z");
    expect(monthsAgoStart("2026-01-31", 1)).toBe("2025-12-01T00:00:00.000Z");
  });
});

describe("event purchases", () => {
  useFakeClock(NOW);
  const EVENT = "evt_AAAAAAAAAAA1";
  const purchaseDataset = () =>
    new InMemoryDataset({
      ...eventSeed([{ id: EVENT, title: "Spring Retreat", slug: "spring-retreat" }]),
      members: [
        { id: ADA, name: "Ada Example", email: "ada@example.test", status: "active", stripeCustomerId: "cus_ada" },
        { id: BEA, name: "Bea Example", email: "bea@example.test", status: "active" },
      ],
      kajabiOffers: [{ kajabi_offer_id: "o_ticket", name: "Spring Retreat", data: { attributes: { price_description: "$500.00 one time" } } }],
      kajabiCustomers: [
        { kajabi_customer_id: "kc_ada", email: "ada@example.test" },
        { kajabi_customer_id: "kc_bea", email: "bea@example.test" },
      ],
      kajabiPurchases: [
        { kajabi_purchase_id: "p_ada", kajabi_customer_id: "kc_ada", kajabi_offer_id: "o_ticket", amount_in_cents: 50000, created_at_kajabi: "2026-02-01T15:00:00Z", deactivated_at: null, data: { attributes: { payment_type: "single", quantity: 1 } } },
        { kajabi_purchase_id: "p_bea", kajabi_customer_id: "kc_bea", kajabi_offer_id: "o_ticket", amount_in_cents: 50000, created_at_kajabi: "2026-02-02T15:00:00Z", deactivated_at: null, data: { attributes: { payment_type: "single" } } },
      ],
      stripeCharges: [
        { stripe_charge_id: "ch_ada", stripe_customer_id: "cus_ada", amount: 50000, amount_refunded: 0, status: "succeeded", paid: true, created_at_stripe: "2026-02-01T15:00:05Z", description: "Spring Retreat", data: { metadata: { kjb_offer_id: "o_ticket" } } },
        // Bea paid under another email: a Stripe customer the Hub does not know.
        { stripe_charge_id: "ch_bea", stripe_customer_id: "cus_other", amount: 50000, amount_refunded: 0, status: "succeeded", paid: true, created_at_stripe: "2026-02-02T15:00:05Z", description: "Spring Retreat", data: { metadata: { kjb_offer_id: "o_ticket" } } },
      ],
      eventOffers: [{ event_id: EVENT, kajabi_offer_id: "o_ticket" }],
      eventAttendees: [{ id: "a1", event_id: EVENT, member_id: ADA, created_at: "2026-02-03T00:00:00Z", created_by: null }],
      eventNotAttending: [],
    } as never);

  it("lines each purchase up with the charge Kajabi made, whoever the Stripe customer is, in the overview", async () => {
    const overview = await loadBillingOverview(createInMemoryRepos(purchaseDataset()));
    expect(overview.counts.purchases).toBe(2);
    const ada = overview.schedules.find((s) => s.memberId === ADA && s.purchaseType === "event")!;
    expect(ada).toMatchObject({ label: "Spring Retreat", event: { slug: "spring-retreat" }, purchase: { offerName: "Spring Retreat", priceText: "$500.00 one time" } });
    expect(ada.rows.map((r) => r.status)).toEqual(["paid"]);
    // Bea bought but is not attending, and nothing explains the payment.
    const bea = overview.schedules.find((s) => s.memberId === BEA && s.purchaseType === "event")!;
    expect(bea.rows.map((r) => r.status).sort()).toEqual(["paid", "unexplained_payment"]);
    expect(overview.members.get(BEA)).toMatchObject({ name: "Bea Example" });
  });

  it("gives one member's view the same purchases, and only theirs", async () => {
    const repos = createInMemoryRepos(purchaseDataset());
    const schedules = await loadMemberSchedules(repos, { id: ADA, status: "active" }, ["cus_ada"], [], await repos.billing.stripeCharges({ customerIds: ["cus_ada"] }));
    const events = schedules.filter((s) => s.purchaseType === "event");
    expect(events).toHaveLength(1);
    expect(events[0].memberId).toBe(ADA);
  });
});
