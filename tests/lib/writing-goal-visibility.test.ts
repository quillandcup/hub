import { describe, it, expect, vi, beforeEach } from "vitest";

// The goal row's lock/globe toggle (toggleGoalVisibility) and the goal form's
// "Pin to my dashboard" checkbox (isStarred on createGoal) -- see tests/lib/writing-project-details.test.ts
// for the mocking approach.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createGoal, toggleGoalVisibility } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberEmail: "m1@example.com",
  isSudo: false,
};

function makeSupabaseMock({ updateError }: { updateError?: string } = {}) {
  const updateEq2 = vi.fn().mockResolvedValue(updateError ? { error: { message: updateError } } : { error: null });
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const goalUpdate = vi.fn(() => ({ eq: updateEq1 }));

  const insertSingle = vi.fn().mockResolvedValue({ data: { id: "goal-new" }, error: null });
  const goalInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: insertSingle })) }));

  const projectSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "project-1" }, error: null }) })),
    })),
  }));

  const from = vi.fn((table: string) => {
    if (table === "writing_goals") return { update: goalUpdate, insert: goalInsert };
    if (table === "writing_projects") return { select: projectSelect };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from,
    __goalUpdate: goalUpdate,
    __updateEq1: updateEq1,
    __updateEq2: updateEq2,
    __goalInsert: goalInsert,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toggleGoalVisibility", () => {
  it("updates show_on_profile scoped to the acting member and revalidates their profile", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await toggleGoalVisibility("goal-1", true);
    expect(result).toEqual({ success: true });
    expect(mock.__goalUpdate).toHaveBeenCalledWith({ show_on_profile: true });
    expect(mock.__updateEq1).toHaveBeenCalledWith("id", "goal-1");
    expect(mock.__updateEq2).toHaveBeenCalledWith("member_id", "member-1");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
  });

  it("surfaces an update error", async () => {
    const mock = makeSupabaseMock({ updateError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await toggleGoalVisibility("goal-1", false)).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createGoal", () => {
  it("saves the dashboard pin from the form", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await createGoal({
      projectId: "project-1",
      measure: "words",
      goalType: "target",
      targetAmount: 50000,
      isStarred: true,
      showOnProfile: false,
    });
    expect(result).toEqual({ success: true, id: "goal-new" });
    expect(mock.__goalInsert).toHaveBeenCalledWith(
      expect.objectContaining({ is_starred: true, show_on_profile: false })
    );
  });

  it("leaves is_starred to the column default when the input omits it", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await createGoal({ projectId: "project-1", measure: "words", goalType: "target", targetAmount: 100 });
    expect(mock.__goalInsert).toHaveBeenCalledWith(expect.not.objectContaining({ is_starred: expect.anything() }));
  });
});
