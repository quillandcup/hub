import { describe, expect, it } from "vitest";
import { careDmPlanState, type CareDmPlan } from "@/lib/care-dm-state";
import type { CareSettings } from "@/lib/care";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEMBER = "mbr_AAAAAAAAAAA1";
const NOW = new Date("2026-03-20T15:00:00.000Z");
const SETTINGS: CareSettings = { engagementDays: 30, lapseGraceDays: 14, quietDays: 7 };
const owners = [{ id: OTHER, name: "Olly E.", role: "community_manager" }];

const plan = (over: Partial<CareDmPlan> = {}): CareDmPlan => ({
  id: "care_AAAAAAAAAAA1",
  member_id: MEMBER,
  owned_by: ME,
  opened_by: ME,
  renewed_from: null,
  opened_at: "2026-03-10T15:00:00.000Z",
  period_ends_on: "2026-04-09",
  closed_at: null,
  last_staff_message_at: "2026-03-18T15:00:00.000Z",
  last_member_message_at: null,
  ...over,
});
const state = (plans: CareDmPlan[], tracked = true) => careDmPlanState({ userId: ME, plans, tracked, now: NOW, owners, settings: SETTINGS });

describe("careDmPlanState: what a DM row says about the member's care plans", () => {
  it("is none for a member with no care plan at all, tracked or not (a DM tracked without a plan changes nothing)", () => {
    expect(state([], false)).toEqual({ kind: "none" });
    expect(state([], true)).toEqual({ kind: "none" });
  });

  it("is in_plan for her own open plan, with its place in the chain and where it stands, and says whether the DM is tracked", () => {
    expect(state([plan()])).toEqual({ kind: "in_plan", tracked: true, ordinal: "first", status: "waiting", tab: "active" });
    expect(state([plan()], false)).toMatchObject({ kind: "in_plan", tracked: false });
  });

  it("counts the chain of renewals for the ordinal and ignores the closed plans before it", () => {
    const first = plan({ id: "care_AAAAAAAAAAA1", closed_at: "2026-03-01T00:00:00.000Z" });
    const second = plan({ id: "care_AAAAAAAAAAA2", renewed_from: first.id, closed_at: "2026-03-05T00:00:00.000Z" });
    const third = plan({ id: "care_AAAAAAAAAAA3", renewed_from: second.id });
    expect(state([third, second, first])).toMatchObject({ kind: "in_plan", ordinal: "third" });
  });

  it.each([
    ["the member wrote last", { last_member_message_at: "2026-03-19T15:00:00.000Z" }, "needs_reply", "active"],
    ["it has gone quiet", { last_staff_message_at: "2026-03-10T15:00:00.000Z" }, "gone_quiet", "active"],
    ["its period ended and is in the grace window", { period_ends_on: "2026-03-15" }, "review_due", "active"],
    ["nobody dealt with it long after its period ended", { period_ends_on: "2026-02-01" }, "lapsed", "earlier"],
  ])("takes its status and tab from the plan: %s", (_label, over, status, tab) => {
    expect(state([plan(over)])).toMatchObject({ kind: "in_plan", status, tab });
  });

  it("is earlier_plan when every plan has ended, whoever held them, and the DM being tracked makes no difference", () => {
    const closed = plan({ closed_at: "2026-03-15T00:00:00.000Z" });
    expect(state([closed])).toEqual({ kind: "earlier_plan" });
    expect(state([closed], false)).toEqual({ kind: "earlier_plan" });
    expect(state([plan({ owned_by: OTHER, closed_at: "2026-03-15T00:00:00.000Z" })])).toEqual({ kind: "earlier_plan" });
  });

  it("is held_by_other for an open plan someone else holds, named by their display name, with no track offered", () => {
    expect(state([plan({ owned_by: OTHER })])).toEqual({ kind: "held_by_other", ownerName: "Olly E.", ordinal: "first", status: "waiting", tab: "active" });
  });

  it("takes the opener as the owner of a plan nobody owns, so it is hers when she opened it and someone else's when not", () => {
    expect(state([plan({ owned_by: null, opened_by: ME })])).toMatchObject({ kind: "in_plan" });
    expect(state([plan({ owned_by: null, opened_by: OTHER })])).toMatchObject({ kind: "held_by_other", ownerName: "Olly E." });
  });

  it("says a plan with no owner and no opener has none, and uses a neutral name for someone no longer on the team", () => {
    expect(state([plan({ owned_by: null, opened_by: null })])).toMatchObject({ kind: "held_by_other", ownerName: null });
    expect(state([plan({ owned_by: "33333333-3333-4333-8333-333333333333" })])).toMatchObject({ kind: "held_by_other", ownerName: "A staff member" });
  });

  it("looks only at the open plan when an old closed one is hers and the open one is someone else's", () => {
    const old = plan({ id: "care_AAAAAAAAAAA1", closed_at: "2026-02-01T00:00:00.000Z" });
    const now = plan({ id: "care_AAAAAAAAAAA2", owned_by: OTHER, renewed_from: old.id });
    expect(state([old, now])).toMatchObject({ kind: "held_by_other", ordinal: "second" });
  });
});
