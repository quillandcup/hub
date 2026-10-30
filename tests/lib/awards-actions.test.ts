import { describe, it, expect, vi, beforeEach } from "vitest";

// Same approach as tests/lib/bookshelf-actions.test.ts: the actions scope their reads to
// effectiveIdentity.memberId and rely on RLS for writes. These tests cover the soft delete: a
// member's delete sets deleted_at (the row stays until they ask us to remove it, /privacy) and
// every read and edit skips a deleted award.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/slack", () => ({
  notifyStaffNewAward: vi.fn().mockResolvedValue(undefined),
}));

import { deleteAward, getMyAwards, updateAward, type AwardInput } from "@/app/(member)/awards/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

const VALID_INPUT: AwardInput = { awardName: "Best Poem", workTitle: "A Poem", awardDate: "2026-03-15" };

/** A query builder where each step returns the same builder and `terminal` resolves the result. */
function chain(terminal: "order" | "single", result: unknown, calls: unknown[][]) {
  const q: Record<string, unknown> = {};
  for (const step of ["eq", "is", "select"]) {
    q[step] = vi.fn((...args: unknown[]) => {
      calls.push([step, ...args]);
      return q;
    });
  }
  q[terminal] = vi.fn(() => Promise.resolve(result));
  return q;
}

function makeSupabaseMock({ rows = [] as unknown[], single = { data: { id: "award-1" }, error: null } as unknown } = {}) {
  const selectCalls: unknown[][] = [];
  const updateCalls: unknown[][] = [];
  const select = vi.fn(() => chain("order", { data: rows, error: null }, selectCalls));
  const update = vi.fn(() => chain("single", single, updateCalls));
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from: vi.fn(() => ({ select, update })),
    __select: select,
    __update: update,
    __selectCalls: selectCalls,
    __updateCalls: updateCalls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

describe("getMyAwards", () => {
  it("lists only the member's live awards", async () => {
    const mock = makeSupabaseMock({
      rows: [{ id: "award-1", award_name: "Best Poem", category: null, work_title: "A Poem", book_id: null, project_id: null, award_date: "2026-03-15", url: null, notes: null }],
    });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    const awards = await getMyAwards();

    expect(awards).toEqual([expect.objectContaining({ id: "award-1", awardName: "Best Poem" })]);
    expect(mock.__selectCalls).toContainEqual(["eq", "member_id", "member-1"]);
    expect(mock.__selectCalls).toContainEqual(["is", "deleted_at", null]);
  });
});

describe("updateAward", () => {
  it("won't edit an award that was deleted", async () => {
    const mock = makeSupabaseMock({ single: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await updateAward("award-1", VALID_INPUT)).toEqual({ error: "Award not found" });
    expect(mock.__updateCalls).toContainEqual(["is", "deleted_at", null]);
  });
});

describe("deleteAward", () => {
  it("soft-deletes the award (sets deleted_at, keeps the row) and refreshes the pages", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await deleteAward("award-1")).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(mock.__updateCalls).toContainEqual(["eq", "id", "award-1"]);
    expect(mock.__updateCalls).toContainEqual(["is", "deleted_at", null]);
    expect(revalidatePath).toHaveBeenCalledWith("/awards");
  });

  it("reports 'Award not found' when the row isn't the member's or is already deleted", async () => {
    const mock = makeSupabaseMock({ single: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await deleteAward("someone-elses-award")).toEqual({ error: "Award not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces a database error", async () => {
    const mock = makeSupabaseMock({ single: { data: null, error: { message: "boom" } } });
    vi.mocked(createClient).mockResolvedValue(mock as never);

    expect(await deleteAward("award-1")).toEqual({ error: "boom" });
  });
});
