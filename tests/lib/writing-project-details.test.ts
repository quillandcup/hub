import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Project actions in app/(member)/projects/actions.ts over the in-memory writing repository: they
// scope every read and write to the acting member's id (never a client-passed one).

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "browser") }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ getMyBooks: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createProject,
  getMyProjects,
  getProject,
  getProjectSeries,
  setStartingBalances,
  toggleProjectVisibility,
  updateProjectCover,
  updateProjectDetails,
  updateProjectPhase,
} from "@/app/(member)/projects/actions";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const IDENTITY = { memberId: ME, memberName: "Ada Example", memberEmail: "ada@example.test", isSudo: false };

const project = (id: string, memberId: string, over: Partial<InMemoryDataset["writingProjects"][number]> = {}) => ({
  id,
  member_id: memberId,
  title: `Title ${id}`,
  description: null,
  cover_asset_id: null,
  cover_url: null,
  external_id: null,
  phase: "drafting",
  show_on_profile: false,
  archived_at: null,
  created_at: "2026-01-01T10:00:00Z",
  ...over,
});

const entry = (id: string, projectId: string, over: Partial<InMemoryDataset["writingEntries"][number]> = {}) => ({
  id,
  member_id: ME,
  project_id: projectId,
  prickle_id: null,
  entry_date: "2026-02-01",
  measure: "words",
  mode: "delta",
  amount: 100,
  note: null,
  tags: [],
  external_id: null,
  created_at: "2026-02-01T10:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  dataset = new InMemoryDataset({ writingProjects: [project("wprj_AAAAAAAAAAA1", ME), project("wprj_BBBBBBBBBBB1", OTHER)] });
  repos = createInMemoryRepos(dataset);
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "auth-user-1", email: "ada@example.test" });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

const PROJECT = "wprj_AAAAAAAAAAA1";
const THEIRS = "wprj_BBBBBBBBBBB1";

describe("createProject", () => {
  it("creates a project for the acting member with a trimmed title", async () => {
    const result = await createProject("  My Novel  ", "planning");

    expect(result).toEqual({ success: true, id: expect.any(String) });
    const created = dataset.writingProjects.find((p) => p.title === "My Novel");
    expect(created).toMatchObject({ member_id: ME, phase: "planning" });
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  });

  it("refuses a blank title and an unknown phase", async () => {
    expect(await createProject("   ")).toEqual({ error: "Title is required" });
    expect(await createProject("X", "nonsense" as never)).toEqual({ error: "Invalid phase" });
    expect(dataset.writingProjects).toHaveLength(2);
  });

  it("surfaces a database failure", async () => {
    vi.spyOn(repos.writing, "createProject").mockRejectedValue(new Error("boom"));

    expect(await createProject("Novel")).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    vi.spyOn(repos.writing, "createProject").mockRejectedValue("nope");

    expect(await createProject("Novel")).toEqual({ error: "Failed to create project" });
  });

  it("needs a signed-in member with a member record", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await createProject("Novel")).toEqual({ error: "Not authenticated" });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "auth-user-1", email: "ada@example.test" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await createProject("Novel")).toEqual({ error: "No member record" });
  });
});

describe("updateProjectDetails", () => {
  it("rejects when there is no authenticated user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect(await updateProjectDetails(PROJECT, { title: "New Title", description: "" })).toEqual({ error: "Not authenticated" });
  });

  it("rejects a blank title before touching the database", async () => {
    const spy = vi.spyOn(repos.writing, "updateProject");

    expect(await updateProjectDetails(PROJECT, { title: "   ", description: "" })).toEqual({ error: "Title is required" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("trims title and description, scopes to the acting member, and revalidates", async () => {
    const result = await updateProjectDetails(PROJECT, { title: "  My Novel  ", description: "  A tale.  " });

    expect(result).toEqual({ success: true });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)).toMatchObject({ title: "My Novel", description: "A tale." });
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`);
  });

  it("stores a blank description as null", async () => {
    await updateProjectDetails(PROJECT, { title: "My Novel", description: "   " });

    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.description).toBeNull();
  });

  it("leaves another member's project alone", async () => {
    await updateProjectDetails(THEIRS, { title: "Hijacked", description: "" });

    expect(dataset.writingProjects.find((p) => p.id === THEIRS)?.title).toBe(`Title ${THEIRS}`);
  });

  it("surfaces an update error", async () => {
    vi.spyOn(repos.writing, "updateProject").mockRejectedValue(new Error("boom"));

    expect(await updateProjectDetails(PROJECT, { title: "My Novel", description: "" })).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    vi.spyOn(repos.writing, "updateProject").mockRejectedValue("nope");

    expect(await updateProjectDetails(PROJECT, { title: "My Novel", description: "" })).toEqual({ error: "Failed to save project" });
  });
});

describe("updateProjectCover", () => {
  it("saves and clears the cover URL", async () => {
    expect(await updateProjectCover(PROJECT, "https://example.com/cover.jpg")).toEqual({ success: true });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.cover_url).toBe("https://example.com/cover.jpg");

    await updateProjectCover(PROJECT, null);
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.cover_url).toBeNull();
  });

  const asset = async (owner: string, sha: string) =>
    repos.media.add({ storage_path: `originals/${owner}/${sha}.png`, mime_type: "image/png", width: 1200, height: 1800, bytes: 1, sha256: sha, title: sha, owner_member_id: owner });

  it("stores a library cover with its asset, and releases the one it replaces", async () => {
    const first = await asset(ME, "first");
    const second = await asset(ME, "second");

    expect(await updateProjectCover(PROJECT, `/api/media/${first.id}/book_cover_shelf`)).toEqual({ success: true });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)).toMatchObject({ cover_url: `/api/media/${first.id}/book_cover_shelf`, cover_asset_id: first.id });

    await updateProjectCover(PROJECT, `/api/media/${second.id}/book_cover_shelf`);
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.cover_asset_id).toBe(second.id);
    expect((await repos.media.byId(first.id))?.deleted_at).not.toBeNull(); // nothing uses the first any more
    expect((await repos.media.byId(second.id))?.deleted_at).toBeNull();

    await updateProjectCover(PROJECT, null);
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)).toMatchObject({ cover_url: null, cover_asset_id: null });
    expect((await repos.media.byId(second.id))?.deleted_at).not.toBeNull();
  });

  it("keeps a replaced cover that a published book still shows", async () => {
    const shared = await asset(ME, "shared");
    const next = await asset(ME, "next");
    await updateProjectCover(PROJECT, `/api/media/${shared.id}/book_cover_shelf`);
    dataset.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ME, title: "Published", published_date: "2026-01-01", cover_asset_id: shared.id });

    await updateProjectCover(PROJECT, `/api/media/${next.id}/book_cover_shelf`);
    expect((await repos.media.byId(shared.id))?.deleted_at).toBeNull();
  });

  it("refuses someone else's image, a deleted one and a made-up one, and leaves the cover as it was", async () => {
    const mine = await asset(ME, "mine");
    const theirs = await asset(OTHER, "theirs");
    const gone = await asset(ME, "gone");
    await repos.media.remove(gone.id);
    await updateProjectCover(PROJECT, `/api/media/${mine.id}/book_cover_shelf`);

    for (const bad of [theirs.id, gone.id, "media_AAAAAAAAAAAA"]) {
      expect(await updateProjectCover(PROJECT, `/api/media/${bad}/book_cover_shelf`)).toEqual({ error: "That cover isn't one of yours: upload it again" });
    }
    expect(await updateProjectCover(PROJECT, "javascript:alert(1)")).toEqual({ error: "Cover image failed to upload correctly — try again" });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.cover_asset_id).toBe(mine.id);
  });
});

describe("toggleProjectVisibility and updateProjectPhase", () => {
  it("shows a project on the profile and revalidates the profile", async () => {
    expect(await toggleProjectVisibility(PROJECT, true)).toEqual({ success: true });

    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.show_on_profile).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/members/${ME}`);
  });

  it("surfaces a visibility error", async () => {
    vi.spyOn(repos.writing, "updateProject").mockRejectedValue(new Error("boom"));

    expect(await toggleProjectVisibility(PROJECT, true)).toEqual({ error: "boom" });
  });

  it("changes the phase, refusing one that can't be set by hand", async () => {
    expect(await updateProjectPhase(PROJECT, "revising")).toEqual({ success: true });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.phase).toBe("revising");

    expect(await updateProjectPhase(PROJECT, "published" as never)).toEqual({ error: "Invalid phase" });
    expect(dataset.writingProjects.find((p) => p.id === PROJECT)?.phase).toBe("revising");
  });

  it("surfaces a phase error", async () => {
    vi.spyOn(repos.writing, "updateProject").mockRejectedValue(new Error("boom"));

    expect(await updateProjectPhase(PROJECT, "revising")).toEqual({ error: "boom" });
  });
});

describe("setStartingBalances", () => {
  it("reports 'Project not found' when the project isn't owned by the acting member", async () => {
    expect(await setStartingBalances(THEIRS, { words: 1000 })).toEqual({ error: "Project not found" });
    expect(dataset.writingBalances).toEqual([]);
  });

  it("reports 'Project not found' when looking the project up fails", async () => {
    vi.spyOn(repos.writing, "ownsProject").mockRejectedValue(new Error("boom"));

    expect(await setStartingBalances(PROJECT, { words: 1000 })).toEqual({ error: "Project not found" });
  });

  it("saves measures with a positive amount and clears the rest, never prickles", async () => {
    dataset.writingBalances.push({ project_id: PROJECT, member_id: ME, measure: "pages", amount: 9 });
    const spy = vi.spyOn(repos.writing, "replaceStartingBalances");

    const result = await setStartingBalances(PROJECT, { words: 5000, pages: 0 });

    expect(result).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(ME, PROJECT, [{ measure: "words", amount: 5000 }], ["time_minutes", "pages", "chapters", "scenes", "lines"]);
    expect(dataset.writingBalances).toEqual([{ project_id: PROJECT, member_id: ME, measure: "words", amount: 5000 }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT}`);
  });

  it("clears everything when every measure is blank", async () => {
    dataset.writingBalances.push({ project_id: PROJECT, member_id: ME, measure: "words", amount: 9 });
    const spy = vi.spyOn(repos.writing, "replaceStartingBalances");

    expect(await setStartingBalances(PROJECT, {})).toEqual({ success: true });
    expect(spy.mock.calls[0][2]).toEqual([]);
    expect(dataset.writingBalances).toEqual([]);
  });

  it("surfaces a database error", async () => {
    vi.spyOn(repos.writing, "replaceStartingBalances").mockRejectedValue(new Error("boom"));

    expect(await setStartingBalances(PROJECT, { words: 5000 })).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-Error failure", async () => {
    vi.spyOn(repos.writing, "replaceStartingBalances").mockRejectedValue("nope");

    expect(await setStartingBalances(PROJECT, { words: 5000 })).toEqual({ error: "Failed to save starting balances" });
  });
});

describe("getMyProjects and getProject", () => {
  beforeEach(() => {
    dataset.writingProjects.push(project("wprj_AAAAAAAAAAA2", ME, { title: "Newer", created_at: "2026-03-01T10:00:00Z" }));
    dataset.writingProjects.push(project("wprj_AAAAAAAAAAA3", ME, { title: "Shelved", archived_at: "2026-04-01T00:00:00Z" }));
    dataset.writingEntries.push(
      entry("wpe_AAAAAAAAAAA1", PROJECT, { amount: 100 }),
      entry("wpe_AAAAAAAAAAA2", PROJECT, { amount: 50, entry_date: "2026-02-02", created_at: "2026-02-02T10:00:00Z" }),
      entry("wpe_BBBBBBBBBBB1", THEIRS, { member_id: OTHER, amount: 999 }),
    );
    dataset.writingBalances.push({ project_id: PROJECT, member_id: ME, measure: "words", amount: 1000 });
    dataset.writingGoals.push({
      id: "wgol_AAAAAAAAAAA1",
      member_id: ME,
      project_id: PROJECT,
      title: "Draft it",
      description: null,
      external_id: null,
      goal_type: "target",
      habit_period: null,
      habit_threshold: null,
      is_starred: false,
      measure: "words",
      show_on_profile: false,
      start_date: null,
      end_date: null,
      target_amount: 2000,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  it("lists the active projects newest first with totals, starting balances and goals", async () => {
    const projects = await getMyProjects();

    expect(projects.map((p) => p.title)).toEqual(["Newer", `Title ${PROJECT}`]);
    const mine = projects[1];
    expect(mine.startingBalances).toEqual({ words: 1000 });
    expect(mine.totalsByMeasure).toEqual({ words: 1150 });
    expect(mine.goals).toEqual([expect.objectContaining({ kind: "target", title: "Draft it", targetAmount: 2000, current: 150 })]);
  });

  it("is empty for someone who is not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect(await getMyProjects()).toEqual([]);
  });

  it("returns one project with its entries newest first", async () => {
    const result = await getProject(PROJECT);

    if ("error" in result) throw new Error(result.error);
    expect(result.project.totalsByMeasure).toEqual({ words: 1150 });
    expect(result.entries.map((e) => e.amount)).toEqual([50, 100]);
    expect(result.entries[0]).toMatchObject({ projectId: PROJECT, prickleId: null, prickleLabel: null, tags: [] });
  });

  it("labels an entry with the prickle it was logged against", async () => {
    dataset.members.push({ id: "mbr_CCCCCCCCCCC1", name: "Fern Example" });
    dataset.prickleTypes.push({ id: "ptyp_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false });
    dataset.prickles.push({ id: "prkl_AAAAAAAAAAA1", typeId: "ptyp_AAAAAAAAAAA1", hostId: "mbr_CCCCCCCCCCC1", title: null, startTime: "2026-02-03T15:00:00Z", endTime: "2026-02-03T16:00:00Z", source: "calendar", calendarEventId: null });
    dataset.writingEntries.push(entry("wpe_AAAAAAAAAAA3", PROJECT, { prickle_id: "prkl_AAAAAAAAAAA1", entry_date: "2026-02-03" }));

    const result = await getProject(PROJECT);

    if ("error" in result) throw new Error(result.error);
    expect(result.entries[0].prickleId).toBe("prkl_AAAAAAAAAAA1");
    expect(result.entries[0].prickleLabel).toContain("Sprint");
    expect(result.entries[0].prickleLabel).toContain("with Fern");
  });

  it("says not found for another member's project, and passes on a sign-in problem", async () => {
    expect(await getProject(THEIRS)).toEqual({ error: "Project not found" });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await getProject(PROJECT)).toEqual({ error: "Not authenticated" });
  });
});

describe("getProjectSeries", () => {
  it("shifts the series by the project's starting balance for that measure", async () => {
    dataset.writingBalances.push({ project_id: PROJECT, member_id: ME, measure: "words", amount: 1000 });
    dataset.writingBalances.push({ project_id: PROJECT, member_id: ME, measure: "pages", amount: 7 });
    dataset.writingEntries.push(
      entry("wpe_AAAAAAAAAAA1", PROJECT, { amount: 100 }),
      entry("wpe_AAAAAAAAAAA2", PROJECT, { amount: 50, entry_date: "2026-02-02", created_at: "2026-02-02T10:00:00Z" }),
    );

    expect(await getProjectSeries(PROJECT, "words")).toEqual([
      { entryDate: "2026-02-01", total: 1100 },
      { entryDate: "2026-02-02", total: 1150 },
    ]);
  });

  it("starts from nothing when the project has no balance for that measure", async () => {
    dataset.writingEntries.push(entry("wpe_AAAAAAAAAAA1", PROJECT, { amount: 100 }));

    expect(await getProjectSeries(PROJECT, "words")).toEqual([{ entryDate: "2026-02-01", total: 100 }]);
  });
});
