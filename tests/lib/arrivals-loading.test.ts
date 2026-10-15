import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
const mocks = vi.hoisted(() => ({ history: vi.fn(), trials: vi.fn() }));
vi.mock("@/lib/kajabi/membership-history", () => ({ fetchMembershipHistory: mocks.history }));
vi.mock("@/lib/trial-window", async original => ({ ...await original<typeof import("@/lib/trial-window")>(), fetchTrialWindows: mocks.trials }));
import { getArrivals } from "@/lib/arrivals";
const since = "2026-10-01", today = "2026-10-15";
const member = { id: "ada", name: "Ada", email: "ada@example.test", staff_role: null };
const cohort = { starts_at: "2026-10-08", expires_at: "2026-12-01", programs: { name: "Ready Writers", includes_membership: true } };
function database(extra: FakeTables = {}) {
  return createFakeSupabase({
    "bronze.kajabi_purchases": { data: [{ kajabi_customer_id: "customer", kajabi_offer_id: "membership", created_at_kajabi: "2026-10-08T12:00:00Z" }] },
    "bronze.kajabi_offers": { data: [{ kajabi_offer_id: "membership", name: "Membership", data: { attributes: { subscription: true } } }] },
    "bronze.kajabi_customers": { data: [{ kajabi_customer_id: "customer", email: "ada@example.test" }] },
    members: { data: [member] }, ...extra,
  });
}
const load = (db: ReturnType<typeof database>) => getArrivals(db as unknown as SupabaseClient, since, today);
beforeEach(() => { vi.clearAllMocks(); mocks.history.mockResolvedValue([]); mocks.trials.mockResolvedValue(new Map()); });
describe("arrival loading", () => {
  it("derives a trial from the matching Stripe window, resolving aliases and duplicate purchases", async () => {
    mocks.trials.mockResolvedValue(new Map([["ada", [{ start: "2026-10-08", end: "2026-10-22" }]]]));
    const db = database({
      member_email_aliases: { data: [{ member_id: "ada", alias_email: "old@example.test", canonical_email: member.email }] },
      "bronze.kajabi_customers": { data: [{ kajabi_customer_id: "customer", email: "old@example.test" }, { kajabi_customer_id: null, email: null }] },
      "bronze.kajabi_purchases": { data: [
        { kajabi_customer_id: "customer", kajabi_offer_id: "membership", created_at_kajabi: "2026-10-09" },
        { kajabi_customer_id: "customer", kajabi_offer_id: "membership", created_at_kajabi: "2026-10-08" },
        { kajabi_customer_id: "customer", kajabi_offer_id: "membership", created_at_kajabi: null },
        { kajabi_customer_id: null, kajabi_offer_id: "membership", created_at_kajabi: "2026-10-08" },
        { kajabi_customer_id: "customer", kajabi_offer_id: "course", created_at_kajabi: "2026-10-08" },
      ] },
    });
    expect(await load(db)).toEqual([{ memberId: "ada", memberName: "Ada", arrivedOn: "2026-10-08", kind: "trial", trialEndsOn: "2026-10-22", programName: null }]);
    expect(mocks.history).toHaveBeenCalledWith(db, ["customer"]);
    expect(db.queries.find(q => q.table === "bronze.kajabi_purchases")?.calls).toContainEqual({ method: "gte", args: ["created_at_kajabi", `${since}T00:00:00Z`] });
  });
  it("calls a membership without a Stripe trial a direct arrival", async () => {
    expect(await load(database())).toEqual([expect.objectContaining({ kind: "direct", trialEndsOn: null })]);
  });
  it.each<FakeTables>([
    { "bronze.kajabi_purchases": { data: [] } },
    { "bronze.kajabi_purchases": { data: [{ kajabi_customer_id: null, kajabi_offer_id: null }] } },
    { "bronze.kajabi_offers": { data: [{ kajabi_offer_id: "membership", name: null, data: null }] } },
    { "bronze.kajabi_customers": { data: [] } },
    { members: { data: [{ ...member, staff_role: "admin" }] } },
  ])("excludes missing identities, courses, and staff", async extra => {
    expect(await load(database(extra))).toEqual([]); expect(mocks.history).not.toHaveBeenCalled();
  });
  it("loads program arrivals with object and array embeds, ignoring missing members and staff", async () => {
    const db = database({ "bronze.kajabi_purchases": { data: [] }, member_program_enrollments: q => ({ data: q.calls.some(c => c.method === "gte") ? [
      { members: [member], program_cohorts: { ...cohort, programs: [cohort.programs] } },
      { members: { ...member, id: "bea", name: "Bea" }, program_cohorts: cohort },
      { members: null, program_cohorts: cohort },
      { members: { ...member, staff_role: "staff" }, program_cohorts: cohort },
    ] : [] }) });
    expect(await load(db)).toEqual([
      expect.objectContaining({ memberId: "ada", kind: "program", programName: "Ready Writers" }),
      expect.objectContaining({ memberId: "bea", kind: "program" }),
    ]);
    expect(db.queries.find(q => q.table === "member_program_enrollments")?.calls).toContainEqual({ method: "eq", args: ["program_cohorts.programs.includes_membership", true] });
  });
  it("prefers membership facts when a program also starts that day", async () => {
    const db = database({ member_program_enrollments: q => ({ data: q.calls.some(c => c.method === "gte") ? [{ members: member, program_cohorts: cohort }] : [] }) });
    expect(await load(db)).toEqual([expect.objectContaining({ kind: "direct", programName: null })]);
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });
  it("rejects renewals, including a member who is currently on hiatus", async () => {
    mocks.history.mockResolvedValue([{ created_at_kajabi: "2025-01-01", derived_end_at: null }]);
    const db = database({ member_hiatus_history: { data: [{ id: "h", start_date: "2026-10-01", end_date: "2026-11-01", reason: null, notes: null }] } });
    expect(await load(db)).toEqual([]);
    expect(mocks.trials).toHaveBeenCalledWith(db, []);
  });
  it("allows rejoining after a membership ended, ignoring a stint that starts on the arrival", async () => {
    mocks.history.mockResolvedValue([
      { created_at_kajabi: "2025-01-01", derived_end_at: "2026-01-01" },
      { created_at_kajabi: "2026-10-08", derived_end_at: null },
    ]);
    expect(await load(database())).toEqual([expect.objectContaining({ kind: "direct" })]);
  });
  it("does not rematch someone whose earlier program already includes membership", async () => {
    const db = database({ member_program_enrollments: q => ({ data: q.calls.some(c => c.method === "gte") ? [] : [
      { cohort: [{ starts_at: "2026-09-01", expires_at: "2026-12-01", program: [{ name: "Ready Writers", includes_membership: true }] }] },
      { cohort: null },
      { cohort: { starts_at: "2026-10-08", expires_at: "2026-12-01", program: { name: "Later", includes_membership: true } } },
    ] }) });
    expect(await load(db)).toEqual([]);
  });
  it("does not rematch an existing gifted member, but ignores future overrides and courses", async () => {
    const db = database({
      member_status_overrides: { data: [
        { override_type: "gift", reason: "gift", starts_at: "2026-01-01", expires_at: null },
        { override_type: "gift", reason: "future", starts_at: "2027-01-01", expires_at: null },
      ] },
      member_program_enrollments: q => ({ data: q.calls.some(c => c.method === "gte") ? [] : [{ cohort: { starts_at: "2026-01-01", expires_at: "2026-12-01", program: { name: "Course", includes_membership: false } } }] }),
    });
    expect(await load(db)).toEqual([]);
  });
});
