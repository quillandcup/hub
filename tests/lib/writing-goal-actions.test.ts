import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/lib/hosting-actions.test.ts's mocked-Supabase-chain approach: createGoal and
// updateGoal in app/(member)/projects/actions.ts. RLS enforcement itself is out of scope here,
// same as the hosting tests this mirrors.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createGoal, updateGoal } from "@/app/(member)/projects/actions";
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

interface MockOpts {
  existingGoal?: any;
  insertedId?: string;
  writeError?: string;
}

function makeSupabaseMock({ existingGoal = null, insertedId = "new-goal-id", writeError }: MockOpts) {
  const existingChain = chain({ data: existingGoal });
  const insertChain = chain(writeError ? { data: null, error: { message: writeError } } : { data: { id: insertedId }, error: null });
  const updateEqEq = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });
  const update = vi.fn((_updates: Record<string, unknown>) => ({ eq: vi.fn(() => ({ eq: updateEqEq })) }));
  const select = vi.fn(() => existingChain);
  const insert = vi.fn(() => insertChain);

  const from = vi.fn((table: string) => {
    if (table === "writing_projects") return chain({ data: { id: "project-1" } }); // assertOwnsProject
    if (table === "writing_goals") return { select, insert, update };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
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

describe("createGoal", () => {
  it("creates a prickles-measure habit goal with no anchor fields", async () => {
    const mock = makeSupabaseMock({});
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await createGoal({ projectId: "project-1", measure: "prickles", goalType: "habit", habitPeriod: "week" });

    expect(result).toEqual({ success: true, id: "new-goal-id" });
    const inserted = (mock.__insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ member_id: "member-1", project_id: "project-1", measure: "prickles", habit_period: "week" });
    expect(Object.keys(inserted).filter((k) => k.startsWith("anchor_"))).toEqual([]);
  });

  it("rejects a target goal without a positive target", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({}) as any);
    const result = await createGoal({ projectId: "project-1", measure: "words", goalType: "target", targetAmount: 0 });
    expect(result).toEqual({ error: "targetAmount must be greater than 0" });
  });
});

describe("updateGoal", () => {
  const EXISTING = {
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
  };

  it("updates the goal in place, never archiving or inserting a new one", async () => {
    const mock = makeSupabaseMock({ existingGoal: EXISTING });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { habitThreshold: 3 });

    expect(result).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
    expect(mock.__update).toHaveBeenCalledTimes(1);
    const updates = (mock.__update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(updates).toMatchObject({ habit_threshold: 3, habit_period: "week", measure: "prickles" });
    expect(updates).not.toHaveProperty("archived_at");
  });

  it("rejects when the goal belongs to a different member", async () => {
    const mock = makeSupabaseMock({ existingGoal: { ...EXISTING, member_id: "someone-else" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateGoal("goal-1", { habitThreshold: 2 });

    expect(result).toEqual({ error: "Goal not found" });
    expect(mock.__update).not.toHaveBeenCalled();
  });
});
