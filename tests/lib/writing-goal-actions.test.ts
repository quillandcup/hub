import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The goal actions in app/(member)/projects/actions.ts, over the in-memory writing repository.
// RLS enforcement itself is out of scope here (the db contract covers the repository). Project
// ownership is still checked straight against writing_projects, so the Supabase fake answers only that.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  archiveGoal,
  createGoal,
  deleteGoal,
  getArchivedGoals,
  getStarredGoals,
  toggleGoalStar,
  toggleGoalVisibility,
  updateGoal,
} from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const IDENTITY = { memberId: ME, memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false };

const project = (id: string, member: string, title = "Novel") => ({
  id, member_id: member, title, description: null, cover_asset_id: null, cover_url: null, external_id: null, phase: "drafting", show_on_profile: false, created_at: "2026-01-01T00:00:00Z",
});

/** Answers the ownership check on writing_projects from the dataset; everything else is empty. */
function fakeSupabase() {
  const chain = (rows: unknown[]) => {
    const filters: [string, unknown][] = [];
    const obj: any = {
      select: () => obj,
      eq: (col: string, val: unknown) => (filters.push([col, val]), obj),
      in: () => obj,
      single: async () => ({ data: rows.find((r: any) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return obj;
  };
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from: (table: string) => chain(table === "writing_projects" ? dataset.writingProjects : []),
  };
}

const goal = (over: Record<string, unknown> = {}) => ({
  id: "wgol_1", member_id: ME, project_id: "wprj_1", title: null, description: null, external_id: null, goal_type: "habit", habit_period: "week", habit_threshold: 1,
  is_starred: false, measure: "prickles", show_on_profile: false, start_date: null, end_date: null, target_amount: null, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({ writingProjects: [project("wprj_1", ME), project("wprj_2", OTHER)], writingGoals: [goal(), goal({ id: "wgol_other", member_id: OTHER, project_id: "wprj_2" })] });
  repos = createInMemoryRepos(dataset);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase() as any);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

const failWith = (method: keyof typeof repos.writing, message = "boom") => vi.spyOn(repos.writing, method as any).mockRejectedValue(new Error(message));

describe("createGoal", () => {
  it("creates a prickles-measure habit goal with no anchor fields", async () => {
    const result = await createGoal({ projectId: "wprj_1", measure: "prickles", goalType: "habit", habitPeriod: "week" });

    expect("success" in result && result.success).toBe(true);
    const created = dataset.writingGoals.find((g) => "id" in result && g.id === result.id)!;
    expect(created).toMatchObject({ member_id: ME, project_id: "wprj_1", measure: "prickles", habit_period: "week" });
    expect(Object.keys(created).filter((k) => k.startsWith("anchor_"))).toEqual([]);
  });

  it("saves the dashboard pin from the form", async () => {
    const result = await createGoal({ projectId: "wprj_1", measure: "words", goalType: "target", targetAmount: 50000, isStarred: true, showOnProfile: false });
    expect(dataset.writingGoals.find((g) => "id" in result && g.id === result.id)).toMatchObject({ is_starred: true, show_on_profile: false });
  });

  it("leaves is_starred to the default when the input omits it", async () => {
    const result = await createGoal({ projectId: "wprj_1", measure: "words", goalType: "target", targetAmount: 100 });
    expect(dataset.writingGoals.find((g) => "id" in result && g.id === result.id)?.is_starred).toBe(false);
  });

  it("rejects a target goal without a positive target", async () => {
    expect(await createGoal({ projectId: "wprj_1", measure: "words", goalType: "target", targetAmount: 0 })).toEqual({ error: "targetAmount must be greater than 0" });
  });

  it("rejects a project that isn't the member's", async () => {
    expect(await createGoal({ projectId: "wprj_2", measure: "words", goalType: "target", targetAmount: 5 })).toEqual({ error: "Project not found" });
  });

  it("returns the database error", async () => {
    failWith("createGoal");
    expect(await createGoal({ projectId: "wprj_1", measure: "words", goalType: "target", targetAmount: 5 })).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateGoal", () => {
  it("updates the goal in place, never archiving or inserting a new one", async () => {
    const result = await updateGoal("wgol_1", { habitThreshold: 3 });

    expect(result).toEqual({ success: true });
    expect(dataset.writingGoals).toHaveLength(2);
    expect(dataset.writingGoals[0]).toMatchObject({ habit_threshold: 3, habit_period: "week", measure: "prickles", archived_at: null });
  });

  it("rejects when the goal belongs to a different member", async () => {
    expect(await updateGoal("wgol_other", { habitThreshold: 2 })).toEqual({ error: "Goal not found" });
    expect(dataset.writingGoals[1].habit_threshold).toBe(1);
  });

  it("returns the database error", async () => {
    failWith("updateGoal");
    expect(await updateGoal("wgol_1", { habitThreshold: 2 })).toEqual({ error: "boom" });
  });

  it("treats a failed lookup as not found", async () => {
    failWith("goalForEdit");
    expect(await updateGoal("wgol_1", { habitThreshold: 2 })).toEqual({ error: "Goal not found" });
  });
});

describe("deleteGoal", () => {
  it("deletes the member's goal and refreshes their pages", async () => {
    expect(await deleteGoal("wgol_1")).toEqual({ success: true });
    // Soft delete: the row stays with deleted_at set, and the member's lists no longer show it.
    expect(dataset.writingGoals.map((g) => g.id)).toEqual(["wgol_1", "wgol_other"]);
    expect(dataset.writingGoals[0].deleted_at).toEqual(expect.any(String));
    expect(dataset.writingGoals[1].deleted_at ?? null).toBeNull();
    expect(await createInMemoryRepos(dataset).writing.goalForEdit("wgol_1")).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/projects/wprj_1");
  });

  it("leaves another member's goal alone", async () => {
    expect(await deleteGoal("wgol_other")).toEqual({ error: "Goal not found" });
    expect(dataset.writingGoals).toHaveLength(2);
  });

  it("returns the database error", async () => {
    failWith("deleteGoal");
    expect(await deleteGoal("wgol_1")).toEqual({ error: "boom" });
  });
});

describe("archiveGoal", () => {
  it("archives the goal and takes it off the dashboard", async () => {
    dataset.writingGoals[0].is_starred = true;
    expect(await archiveGoal("wgol_1")).toEqual({ success: true });
    expect(dataset.writingGoals[0].archived_at).toEqual(expect.any(String));
    expect(dataset.writingGoals[0].is_starred).toBe(false);
  });

  it("leaves another member's goal alone", async () => {
    expect(await archiveGoal("wgol_other")).toEqual({ error: "Goal not found" });
    expect(dataset.writingGoals[1].archived_at).toBeNull();
  });

  it("returns the database error", async () => {
    failWith("updateGoal");
    expect(await archiveGoal("wgol_1")).toEqual({ error: "boom" });
  });
});

describe("toggleGoalStar and toggleGoalVisibility", () => {
  it("star the goal, scoped to the acting member", async () => {
    expect(await toggleGoalStar("wgol_1", true)).toEqual({ success: true });
    expect(await toggleGoalStar("wgol_other", true)).toEqual({ success: true });
    expect(dataset.writingGoals.map((g) => g.is_starred)).toEqual([true, false]);
  });

  it("updates show_on_profile scoped to the acting member and revalidates their profile", async () => {
    expect(await toggleGoalVisibility("wgol_1", true)).toEqual({ success: true });
    expect(dataset.writingGoals.map((g) => g.show_on_profile)).toEqual([true, false]);
    expect(revalidatePath).toHaveBeenCalledWith(`/members/${ME}`);
  });

  it("surface a database error", async () => {
    failWith("updateGoal");
    expect(await toggleGoalStar("wgol_1", true)).toEqual({ error: "boom" });
    expect(await toggleGoalVisibility("wgol_1", false)).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("getArchivedGoals and getStarredGoals", () => {
  it("lists the project's archived goals", async () => {
    dataset.writingGoals.push(goal({ id: "wgol_old", title: "Past", archived_at: "2026-05-01T00:00:00Z" }));
    const rows = await getArchivedGoals("wprj_1");
    expect(rows.map((r) => r.id)).toEqual(["wgol_old"]);
  });

  it("lists the starred goals with their project's title", async () => {
    dataset.writingGoals[0].is_starred = true;
    const rows = await getStarredGoals();
    expect(rows.map((r) => [r.id, r.projectTitle])).toEqual([["wgol_1", "Novel"]]);
  });

  it("is empty with nothing starred, and when the lookups fail", async () => {
    expect(await getStarredGoals()).toEqual([]);
    dataset.writingGoals[0].is_starred = true;
    failWith("starredGoals");
    expect(await getStarredGoals()).toEqual([]);
    failWith("archivedGoals");
    expect(await getArchivedGoals("wprj_1")).toEqual([]);
  });
});
