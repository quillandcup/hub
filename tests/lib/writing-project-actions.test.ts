import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Hibernating projects and deleting a project (src/app/(member)/projects/actions.ts), over the in-memory
// writing repository. The Supabase fake answers only the lookups the identity check and the
// attendance and bookshelf reads make.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteProject, getMyPastProjects, getMyProjects, getProject, reorderMyGoals, reorderMyProjects, updateProjectPhase } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const IDENTITY = { memberId: ME, memberName: "Ada Example", memberEmail: "ada@example.com", isSudo: false };

const project = (id: string, member: string, title: string, phase = "drafting") => ({
  id, member_id: member, title, description: null, cover_asset_id: null, cover_url: null, external_id: null, phase, show_on_profile: true, deleted_at: null, created_at: "2026-01-01T00:00:00Z",
});
const goal = (id: string, projectId: string) => ({
  id, member_id: ME, project_id: projectId, title: null, description: null, external_id: null, goal_type: "target", habit_period: null, habit_threshold: null,
  is_starred: false, measure: "words", show_on_profile: false, start_date: null, end_date: null, target_amount: 100, archived_at: null, created_at: "2026-01-01T00:00:00Z",
});
const entry = (id: string, projectId: string) => ({
  id, member_id: ME, project_id: projectId, entry_date: "2026-02-01", measure: "words", mode: "delta", amount: 50, note: null, tags: [], prickle_id: null, external_id: null, created_at: "2026-02-01T10:00:00Z",
});

/** The attendance and bookshelf reads that getMyProjects makes find nothing. */
function fakeSupabase() {
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    is: () => obj,
    not: () => obj,
    order: () => obj,
    range: () => obj,
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) }, from: () => obj };
}

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({
    writingProjects: [project("wprj_1", ME, "Novel"), project("wprj_2", ME, "Essays", "complete"), project("wprj_3", ME, "Dropped", "hibernating"), project("wprj_other", OTHER, "Theirs")],
    writingGoals: [goal("wgol_1", "wprj_1")],
    writingEntries: [entry("went_1", "wprj_1")],
  });
  repos = createInMemoryRepos(dataset);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase() as any);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

describe("hibernating projects", () => {
  it("lists hibernating projects apart from the others, all still openable; complete ones stay with the rest", async () => {
    expect((await getMyProjects()).map((p) => p.title).sort()).toEqual(["Essays", "Novel"]);
    const past = await getMyPastProjects();
    expect(past.map((p) => p.title)).toEqual(["Dropped"]);
    const opened = await getProject("wprj_3");
    expect("project" in opened && opened.project.phase).toBe("hibernating");
  });

  it("moves a project to the hibernating list when its status changes, and back", async () => {
    expect(await updateProjectPhase("wprj_1", "complete")).toMatchObject({ success: true });
    expect((await getMyProjects()).map((p) => p.title)).toContain("Novel");

    expect(await updateProjectPhase("wprj_1", "hibernating")).toEqual({ success: true });
    expect((await getMyProjects()).map((p) => p.title)).not.toContain("Novel");
    expect((await getMyPastProjects()).map((p) => p.title)).toContain("Novel");

    expect(await updateProjectPhase("wprj_1", "revising")).toEqual({ success: true });
    expect((await getMyProjects()).map((p) => p.title)).toContain("Novel");
    expect(await getMyPastProjects()).toEqual([expect.objectContaining({ title: "Dropped" })]);
  });

  it("has nothing without a member", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getMyPastProjects()).toEqual([]);
  });
});

describe("deleteProject", () => {
  it("soft deletes the project with its goals and entries and hides it everywhere", async () => {
    expect(await deleteProject("wprj_1")).toEqual({ success: true });

    // The rows stay, marked deleted.
    expect(dataset.writingProjects.find((p) => p.id === "wprj_1")?.deleted_at).toEqual(expect.any(String));
    expect(dataset.writingGoals[0].deleted_at).toEqual(expect.any(String));
    expect(dataset.writingEntries[0].deleted_at).toEqual(expect.any(String));

    expect((await getMyProjects()).map((p) => p.title)).toEqual(["Essays"]);
    expect(await getProject("wprj_1")).toEqual({ error: "Project not found" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("deletes a hibernating project too", async () => {
    expect(await deleteProject("wprj_3")).toEqual({ success: true });
    expect(await getMyPastProjects()).toEqual([]);
  });

  it("refuses a project that isn't the member's, or is already deleted", async () => {
    expect(await deleteProject("wprj_other")).toEqual({ error: "Project not found" });
    expect(dataset.writingProjects.find((p) => p.id === "wprj_other")?.deleted_at).toBeNull();

    await deleteProject("wprj_1");
    expect(await deleteProject("wprj_1")).toEqual({ error: "Project not found" });
  });

  it("returns the database error and leaves the project", async () => {
    vi.spyOn(repos.writing, "deleteProject").mockRejectedValue(new Error("boom"));
    expect(await deleteProject("wprj_1")).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers an error for a member without a session", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect("error" in (await deleteProject("wprj_1"))).toBe(true);
  });
});

describe("reorderMyProjects", () => {
  it("saves the order and the projects list and dashboard are refreshed", async () => {
    expect((await getMyProjects()).map((p) => p.id)).toEqual(["wprj_2", "wprj_1"]);
    expect(await reorderMyProjects(["wprj_1", "wprj_2"])).toEqual({ success: true });
    expect((await getMyProjects()).map((p) => p.id)).toEqual(["wprj_1", "wprj_2"]);
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("leaves another member's project and the hibernating one alone when they are named", async () => {
    await reorderMyProjects(["wprj_other", "wprj_1", "wprj_3", "wprj_2"]);
    expect(dataset.writingProjects.find((p) => p.id === "wprj_other")?.sort_position ?? null).toBeNull();
    expect((await getMyProjects()).map((p) => p.id)).toEqual(["wprj_1", "wprj_2"]);
  });

  it("reorders the member being acted as when an admin is in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: OTHER, isSudo: true });
    const spy = vi.spyOn(repos.writing, "reorderProjects");
    expect(await reorderMyProjects(["wprj_other"])).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(OTHER, ["wprj_other"]);
  });

  it("refuses a malformed list without touching anything", async () => {
    const spy = vi.spyOn(repos.writing, "reorderProjects");
    expect(await reorderMyProjects("wprj_1" as unknown as string[])).toEqual({ error: "Invalid project order" });
    expect(await reorderMyProjects(["wprj_1", ""])).toEqual({ error: "Invalid project order" });
    expect(await reorderMyProjects(Array.from({ length: 501 }, (_, i) => `wprj_${i}`))).toEqual({ error: "Invalid project order" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the database error without refreshing", async () => {
    vi.spyOn(repos.writing, "reorderProjects").mockRejectedValue(new Error("boom"));
    expect(await reorderMyProjects(["wprj_1"])).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers an error for a member without a session", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect("error" in (await reorderMyProjects(["wprj_1"]))).toBe(true);
  });
});

describe("reorderMyGoals", () => {
  const goalIds = () => dataset.writingGoals.filter((g) => g.project_id === "wprj_1").sort((a, b) => (a.sort_position ?? 99) - (b.sort_position ?? 99)).map((g) => g.id);

  beforeEach(() => {
    dataset.writingGoals.push(goal("wgol_2", "wprj_1"), goal("wgol_3", "wprj_1"), goal("wgol_4", "wprj_2"));
  });

  it("saves the order, and the project page and dashboard are refreshed", async () => {
    expect(await reorderMyGoals("wprj_1", ["wgol_3", "wgol_1", "wgol_2"])).toEqual({ success: true });
    expect(goalIds()).toEqual(["wgol_3", "wgol_1", "wgol_2"]);
    expect(revalidatePath).toHaveBeenCalledWith("/projects/wprj_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("leaves another project's goals and another member's project alone", async () => {
    await reorderMyGoals("wprj_1", ["wgol_4", "wgol_2", "wgol_1"]);
    expect(dataset.writingGoals.find((g) => g.id === "wgol_4")?.sort_position ?? null).toBeNull();
    expect(goalIds()[0]).toBe("wgol_2");
    await reorderMyGoals("wprj_other", ["wgol_1"]);
    expect(dataset.writingGoals.find((g) => g.id === "wgol_1")?.sort_position).toBe(2);
  });

  it("reorders for the member being acted as when an admin is in sudo", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: OTHER, isSudo: true });
    const spy = vi.spyOn(repos.writing, "reorderGoals");
    expect(await reorderMyGoals("wprj_other", ["wgol_x"])).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(OTHER, "wprj_other", ["wgol_x"]);
  });

  it("refuses a malformed request without touching anything", async () => {
    const spy = vi.spyOn(repos.writing, "reorderGoals");
    expect(await reorderMyGoals("wprj_1", "wgol_1" as unknown as string[])).toEqual({ error: "Invalid goal order" });
    expect(await reorderMyGoals("wprj_1", ["wgol_1", ""])).toEqual({ error: "Invalid goal order" });
    expect(await reorderMyGoals("", ["wgol_1"])).toEqual({ error: "Invalid goal order" });
    expect(await reorderMyGoals("wprj_1", Array.from({ length: 501 }, (_, i) => `wgol_${i}`))).toEqual({ error: "Invalid goal order" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the database error without refreshing", async () => {
    vi.spyOn(repos.writing, "reorderGoals").mockRejectedValue(new Error("boom"));
    expect(await reorderMyGoals("wprj_1", ["wgol_1"])).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers an error for a member without a session", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect("error" in (await reorderMyGoals("wprj_1", ["wgol_1"]))).toBe(true);
  });
});
