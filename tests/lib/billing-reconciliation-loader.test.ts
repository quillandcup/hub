import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadBillingOverview, loadMemberSchedules, monthsAgoStart, toReconSubscription } from "@/lib/billing-reconciliation-loader";
import { useFakeClock } from "@/tests/helpers/fake-clock";

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
    expect(overview.counts).toEqual({ linkedMembers: 2, invoices: 5, charges: 0, subscriptions: 2 });
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

  it("counts months back from the first of the month", () => {
    expect(monthsAgoStart("2026-05-20", 24)).toBe("2024-05-01T00:00:00.000Z");
    expect(monthsAgoStart("2026-01-31", 1)).toBe("2025-12-01T00:00:00.000Z");
  });
});
