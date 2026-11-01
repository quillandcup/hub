import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Repos } from "@/lib/data/repos";

const mocks = vi.hoisted(() => ({ history: vi.fn(), trials: vi.fn() }));
vi.mock("@/lib/kajabi/membership-history", () => ({ fetchMembershipHistory: mocks.history }));
vi.mock("@/lib/trial-window", async (original) => ({ ...(await original<typeof import("@/lib/trial-window")>()), fetchTrialWindows: mocks.trials }));
import { getArrivals } from "@/lib/arrivals";

const since = "2026-10-01";
const today = "2026-10-15";
const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const SAM = "mbr_AAAAAAAAAAA3";
const ADA_EMAIL = "ada@example.test";

type Seed = NonNullable<ConstructorParameters<typeof InMemoryDataset>[0]>;

const ada = { id: ADA, name: "Ada", email: ADA_EMAIL };
const purchase = (id: string, customer: string | null, offer: string | null, created: string | null) => ({
  kajabi_purchase_id: id,
  kajabi_customer_id: customer,
  kajabi_offer_id: offer,
  created_at_kajabi: created,
});
const membershipOffer = { kajabi_offer_id: "membership", name: "Membership", data: { attributes: { subscription: true } } };
const adaCustomer = { kajabi_customer_id: "customer", email: ADA_EMAIL };

/** A world where Ada bought a membership on Oct 8; `over` replaces whole tables. */
let repos: Repos;
function world(over: Seed = {}) {
  const dataset = new InMemoryDataset({
    members: [ada],
    kajabiPurchases: [purchase("p1", "customer", "membership", "2026-10-08T12:00:00Z")],
    kajabiOffers: [membershipOffer],
    kajabiCustomers: [adaCustomer],
    ...over,
  });
  repos = createInMemoryRepos(dataset);
  return dataset;
}
const load = () => getArrivals(repos, since, today);

/** Enrolls a member in a new cohort of a program (made on first use) that runs from `starts` to `expires`. */
function enroll(dataset: InMemoryDataset, memberId: string, starts: string, expires = "2026-12-01", program = { name: "Ready Writers", includes: true }) {
  let p = dataset.programs.find((x) => x.name === program.name);
  if (!p) {
    p = { id: `prg_${program.name}`, name: program.name, slug: program.name, description: null, includes_membership: program.includes, kajabi_offer_names: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    dataset.programs.push(p);
  }
  const cohortId = `coh_${dataset.programCohorts.length}`;
  dataset.programCohorts.push({ id: cohortId, program_id: p.id, name: cohortId, starts_at: starts, expires_at: expires, notes: null, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
  dataset.programEnrollments.push({ id: `enrl_${dataset.programEnrollments.length}`, member_id: memberId, cohort_id: cohortId, notes: null, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.history.mockResolvedValue([]);
  mocks.trials.mockResolvedValue(new Map());
});

describe("arrival loading", () => {
  it("derives a trial from the matching Stripe window, resolving aliases and duplicate purchases", async () => {
    mocks.trials.mockResolvedValue(new Map([[ADA, [{ start: "2026-10-08", end: "2026-10-22" }]]]));
    world({
      emailAliases: [{ id: "mea_AAAAAAAAAAA1", memberId: ADA, active: true, alias_email: "old@example.test", canonical_email: ADA_EMAIL }],
      kajabiCustomers: [{ kajabi_customer_id: "customer", email: "old@example.test" }, { kajabi_customer_id: "stranger", email: "stranger@example.test" }],
      kajabiPurchases: [
        purchase("p1", "customer", "membership", "2026-10-09"),
        purchase("p2", "customer", "membership", "2026-10-08"),
        purchase("p3", "customer", "membership", null),
        purchase("p4", null, "membership", "2026-10-08"),
        purchase("p5", "customer", "course", "2026-10-08"),
        purchase("p6", "customer", "membership", "2026-09-20"), // before the window: never read
      ],
    });
    expect(await load()).toEqual([{ memberId: ADA, memberName: "Ada", arrivedOn: "2026-10-08", kind: "trial", trialEndsOn: "2026-10-22", programName: null }]);
    expect(mocks.history).toHaveBeenCalledWith(repos, ["customer"]);
  });

  it("does not count a purchase from before the window as an arrival", async () => {
    world({ kajabiPurchases: [purchase("p1", "customer", "membership", "2026-09-30T23:00:00Z")] });
    expect(await load()).toEqual([]);
  });

  it("calls a membership without a Stripe trial a direct arrival", async () => {
    world();
    expect(await load()).toEqual([expect.objectContaining({ kind: "direct", trialEndsOn: null })]);
  });

  it.each<[string, Seed]>([
    ["no purchases", { kajabiPurchases: [] }],
    ["a purchase with no customer or offer", { kajabiPurchases: [purchase("p1", null, null, "2026-10-08")] }],
    ["an offer with no name or data", { kajabiOffers: [{ kajabi_offer_id: "membership", name: null, data: null }] }],
    ["no customer record", { kajabiCustomers: [] }],
    ["a staff member", { members: [{ ...ada, staffRole: "admin" }] }],
  ])("excludes missing identities, courses, and staff (%s)", async (_label, extra) => {
    world(extra);
    expect(await load()).toEqual([]);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("loads program arrivals, ignoring missing members, staff, other dates and programs without membership", async () => {
    const dataset = world({ kajabiPurchases: [] });
    dataset.members.push({ id: BEA, name: "Bea", email: "bea@example.test" }, { id: SAM, name: "Sam", email: "sam@example.test", staffRole: "staff" });
    enroll(dataset, ADA, "2026-10-08");
    enroll(dataset, BEA, "2026-10-09");
    enroll(dataset, "mbr_GHOSTGHOST11", "2026-10-08");
    enroll(dataset, SAM, "2026-10-08");
    enroll(dataset, BEA, "2026-09-01", "2026-09-30", { name: "Earlier", includes: true });
    enroll(dataset, BEA, "2026-10-10", "2026-12-01", { name: "Course", includes: false });
    expect(await load()).toEqual([
      expect.objectContaining({ memberId: ADA, kind: "program", programName: "Ready Writers" }),
      expect.objectContaining({ memberId: BEA, kind: "program" }),
    ]);
  });

  it("prefers membership facts when a program also starts that day", async () => {
    const dataset = world();
    enroll(dataset, ADA, "2026-10-08");
    expect(await load()).toEqual([expect.objectContaining({ kind: "direct", programName: null })]);
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it("rejects renewals, including a member who is currently on hiatus", async () => {
    mocks.history.mockResolvedValue([{ created_at_kajabi: "2025-01-01", derived_end_at: null }]);
    world({
      memberHiatuses: [{ id: "hia_AAAAAAAAAAA1", member_id: ADA, start_date: "2026-10-01", end_date: "2026-11-01", reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-10-01T00:00:00Z" }],
    });
    expect(await load()).toEqual([]);
    expect(mocks.trials).toHaveBeenCalledWith(repos, []);
  });

  it("allows rejoining after a membership ended, ignoring a stint that starts on the arrival", async () => {
    mocks.history.mockResolvedValue([
      { created_at_kajabi: "2025-01-01", derived_end_at: "2026-01-01" },
      { created_at_kajabi: "2026-10-08", derived_end_at: null },
    ]);
    world();
    expect(await load()).toEqual([expect.objectContaining({ kind: "direct" })]);
  });

  it("does not rematch someone whose earlier program already includes membership", async () => {
    const dataset = world();
    enroll(dataset, ADA, "2026-09-01");
    enroll(dataset, ADA, "2026-10-12", "2026-12-01", { name: "Course", includes: false });
    expect(await load()).toEqual([]);
  });

  it("does not rematch an existing gifted member, but ignores future overrides and courses", async () => {
    const dataset = world({
      memberStatusOverrides: [
        { id: "mso_AAAAAAAAAAA1", member_id: ADA, override_type: "gift", reason: "gift", starts_at: "2026-01-01", expires_at: null, notes: null, created_at: "2026-01-01T00:00:00Z", created_by: null, updated_at: "2026-01-01T00:00:00Z" },
        { id: "mso_AAAAAAAAAAA2", member_id: ADA, override_type: "gift", reason: "future", starts_at: "2027-01-01", expires_at: null, notes: null, created_at: "2026-01-01T00:00:00Z", created_by: null, updated_at: "2026-01-01T00:00:00Z" },
      ],
    });
    enroll(dataset, ADA, "2026-01-01", "2026-12-01", { name: "Course", includes: false });
    expect(await load()).toEqual([]);
  });

  it("lets a failing read propagate", async () => {
    world();
    repos.billing.kajabiPurchases = async () => {
      throw new Error("billing is down");
    };
    await expect(load()).rejects.toThrow("billing is down");
  });
});
