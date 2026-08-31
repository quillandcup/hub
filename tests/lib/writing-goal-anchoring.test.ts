import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/lib/hosting-actions.test.ts's mocked-Supabase-chain approach. Focused on the
// new prickles-measure anchor behavior in app/(member)/writing/actions.ts: resolving
// anchorScheduleId server-side into a snapshot (never trusting client-provided type/host/day),
// and the archive-and-fork behavior on updateGoal when a goal's anchor changes -- the fix for a
// real "editing a goal's anchor silently erases its earned streak" bug (see the plan file /
// commit message for context). RLS enforcement itself is out of scope here, same as the hosting
// tests this mirrors.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createGoal, updateGoal } from "@/app/(member)/writing/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberEmail: "m1@example.com",
  isSudo: false,
};

function chain(result: unknown) {
  const obj: any = {};
  const methods = ["select", "eq", "in", "is", "not", "order", "limit"];
  for (const m of methods) obj[m] = vi.fn(() => obj);
  obj.single = vi.fn().mockResolvedValue(result);
  obj.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return obj;
}

const SCHEDULE_A = { id: "sched-a", type_id: "type-progress", host_id: "host-1", day_of_week: 1 };
const SCHEDULE_B = { id: "sched-b", type_id: "type-sprint", host_id: "host-2", day_of_week: 2 };

interface MockOpts {
  scheduleRow?: typeof SCHEDULE_A | null;
  existingGoal?: any;
  insertedId?: string;
  writeError?: string;
}

function makeSupabaseMock({ scheduleRow = null, existingGoal = null, insertedId = "new-goal-id", writeError }: MockOpts) {
  const existingChain = chain({ data: existingGoal });
  const insertChain = chain(writeError ? { data: null, error: { message: writeError } } : { data: { id: insertedId }, error: null });
  const updateEqEq = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });
  const update = vi.fn((_updates: Record<string, unknown>) => ({ eq: vi.fn(() => ({ eq: updateEqEq })) }));
  const select = vi.fn(() => existingChain);
  const insert = vi.fn(() => insertChain);

  const from = vi.fn((table: string) => {
    if (table === "prickle_schedules") return chain({ data: scheduleRow });
    if (table === "writing_projects") return chain({ data: { id: "project-1" } }); // assertOwnsProject
    if (table === "writing_goals") return { select, insert, update };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }) },
    from,
    __select: select,
    __insert: insert,
    __update: update,
    __updateEqEq: updateEqEq,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

describe("createGoal anchor resolution", () => {
  it("resolves anchorScheduleId server-side and snapshots type/host/day, never trusting client fields directly", async () => {
    const mock = makeSupabaseMock({ scheduleRow: SCHEDULE_A });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await createGoal({
      projectId: "project-1",
      measure: "prickles",
      goalType: "habit",
      habitPeriod: "week",
      anchorScheduleId: "sched-a",
    });

    expect(result).toEqual({ success: true, id: "new-goal-id" });
    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor_schedule_id: "sched-a",
        anchor_type_id: "type-progress",
        anchor_host_id: "host-1",
        anchor_day_of_week: 1,
      })
    );
  });

  it("leaves the anchor fully null when anchorScheduleId is omitted (any writing prickle counts)", async () => {
    const mock = makeSupabaseMock({});
    vi.mocked(createClient).mockResolvedValue(mock as any);

    await createGoal({ projectId: "project-1", measure: "prickles", goalType: "habit", habitPeriod: "week" });

    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({ anchor_schedule_id: null, anchor_type_id: null, anchor_host_id: null, anchor_day_of_week: null })
    );
  });

  it("never persists an anchor for a non-prickles measure, even if anchorScheduleId is smuggled in", async () => {
    const mock = makeSupabaseMock({ scheduleRow: SCHEDULE_A });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    await createGoal({
      projectId: "project-1",
      measure: "words",
      goalType: "target",
      targetAmount: 1000,
      anchorScheduleId: "sched-a",
    });

    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({ anchor_schedule_id: null, anchor_type_id: null, anchor_host_id: null, anchor_day_of_week: null })
    );
  });

  it("rejects an anchorScheduleId that isn't a currently-confirmed schedule", async () => {
    const mock = makeSupabaseMock({ scheduleRow: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await createGoal({
      projectId: "project-1",
      measure: "prickles",
      goalType: "habit",
      habitPeriod: "week",
      anchorScheduleId: "not-a-real-schedule",
    });

    expect(result).toEqual({ error: "That schedule isn't a currently-confirmed prickle" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });
});

describe("updateGoal: archiving on anchor change", () => {
  const EXISTING_ANCHORED = {
    id: "goal-1",
    project_id: "project-1",
    member_id: "member-1",
    goal_type: "habit",
    measure: "prickles",
    target_amount: null,
    start_date: null,
    end_date: null,
    habit_period: "week",
    habit_threshold: 1,
    is_starred: true,
    anchor_schedule_id: "sched-a",
    anchor_type_id: "type-progress",
    anchor_host_id: "host-1",
    anchor_day_of_week: 1,
  };

  it("does NOT touch the anchor, and does not fork, when anchorScheduleId is omitted from the patch (e.g. a threshold-only edit)", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING_ANCHORED });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { habitThreshold: 2 });

    expect(result).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled(); // no fork
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({
        habit_threshold: 2,
        anchor_schedule_id: "sched-a",
        anchor_type_id: "type-progress",
        anchor_host_id: "host-1",
        anchor_day_of_week: 1,
      })
    );
  });

  it("does NOT fork when re-submitting the same anchor explicitly", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING_ANCHORED, scheduleRow: SCHEDULE_A });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { anchorScheduleId: "sched-a" });

    expect(result).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("THE CRITICAL CASE: archives the old goal (preserving its stats) and creates a new one when the anchor changes to a different schedule, instead of overwriting in place", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING_ANCHORED, scheduleRow: SCHEDULE_B, insertedId: "goal-2" });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { anchorScheduleId: "sched-b" });

    expect(result).toEqual({ success: true, newGoalId: "goal-2" });

    // The OLD row is archived and unstarred -- not mutated with the new anchor.
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String), is_starred: false })
    );
    const archiveUpdatePayload = mock.__update.mock.calls[0]?.[0];
    expect(archiveUpdatePayload.anchor_type_id).toBeUndefined();

    // A NEW row is inserted carrying the new anchor and the same project/period/threshold.
    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        habit_period: "week",
        habit_threshold: 1,
        anchor_schedule_id: "sched-b",
        anchor_type_id: "type-sprint",
        anchor_host_id: "host-2",
        anchor_day_of_week: 2,
      })
    );
  });

  it("also forks when clearing the anchor back to unanchored", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING_ANCHORED, insertedId: "goal-2" });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { anchorScheduleId: null });

    expect(result).toEqual({ success: true, newGoalId: "goal-2" });
    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({ anchor_schedule_id: null, anchor_type_id: null, anchor_host_id: null, anchor_day_of_week: null })
    );
  });

  it("also forks when switching measure away from prickles entirely, so the frozen attendance-based history isn't silently reinterpreted as word-count history", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING_ANCHORED, insertedId: "goal-2" });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { measure: "words", targetAmount: 500, goalType: "target" });

    expect(result).toEqual({ success: true, newGoalId: "goal-2" });
    expect(mock.__update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
  });

  it("a goal that was never anchored, and stays unanchored, never forks on an unrelated edit", async () => {
    const unanchored = { ...EXISTING_ANCHORED, anchor_schedule_id: null, anchor_type_id: null, anchor_host_id: null, anchor_day_of_week: null };
    const mock = makeSupabaseMock({ existingGoal: unanchored });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { habitThreshold: 3 });

    expect(result).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects when the goal belongs to a different member", async () => {
    const mock = makeSupabaseMock({ existingGoal: { ...EXISTING_ANCHORED, member_id: "someone-else" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { habitThreshold: 2 });

    expect(result).toEqual({ error: "Goal not found" });
    expect(mock.__update).not.toHaveBeenCalled();
  });
});
