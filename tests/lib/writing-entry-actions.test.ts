import { describe, it, expect, vi, beforeEach } from "vitest";

// The project actions that log, change, delete and total up progress entries. Entries come from
// the in-memory WritingRepository; the other tables (projects, goals, activities) are a small fake.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn().mockResolvedValue("UTC") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { WritingEntryRow, WritingGoalRow, WritingProjectRow } from "@/lib/data/writing";
import { deleteEntry, getArchivedGoals, getProjectSeries, getStarredGoals, logProgress, updateEntry } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const IDENTITY = { memberId: ME, memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const PROJECT = "wprj_AAAAAAAAAAA1";

const project: WritingProjectRow = {
  id: PROJECT,
  member_id: ME,
  title: "Novel",
  description: null,
  cover_asset_id: null, cover_url: null,
  external_id: null,
  phase: "drafting",
  show_on_profile: false,
  created_at: "2026-01-01T00:00:00Z",
};

const entry = (id: string, over: Partial<WritingEntryRow> = {}): WritingEntryRow => ({
  id,
  member_id: ME,
  project_id: PROJECT,
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

/** Every table answers with its rows, whatever the filters; inserts are recorded. */
function fakeSupabase(tables: Record<string, unknown[]> = {}) {
  const inserts: { table: string; row: unknown }[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    };
    for (const method of ["select", "eq", "in", "is", "not", "gte", "order", "delete", "update", "single", "maybeSingle"]) builder[method] = () => builder;
    return builder;
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return inserts;
}

const goalRow = (over: Partial<WritingGoalRow> = {}): WritingGoalRow => ({
  id: "wgol_AAAAAAAAAAA1",
  member_id: ME,
  project_id: PROJECT,
  title: null,
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
  target_amount: 1000,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

function useData(writingEntries: WritingEntryRow[], writingGoals: WritingGoalRow[] = []) {
  dataset = new InMemoryDataset({ writingProjects: [project], writingEntries, writingGoals });
  repos = createInMemoryRepos(dataset);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.com" } as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
  useData([]);
});

describe("logProgress", () => {
  const input = { projectId: PROJECT, entryDate: "2026-02-01", measure: "words" as const, mode: "delta" as const, amount: 250, note: "  good day ", tags: ["Draft", "draft "], prickleId: "prkl_AAAAAAAAAAA1" };

  it("saves a trimmed, de-duplicated entry for the acting member and records the activity", async () => {
    fakeSupabase({ writing_projects: [{ id: PROJECT }] });

    const result = await logProgress(input);

    expect(result).toEqual({ success: true, id: expect.any(String) });
    expect(await repos.writing.prickleEntries(ME, "prkl_AAAAAAAAAAA1")).toEqual([
      expect.objectContaining({ amount: 250, note: "good day", tags: ["draft"], project_title: "Novel" }),
    ]);
    expect(dataset.activities).toEqual([expect.objectContaining({ member_id: ME, activity_type: "writing_progress_logged", source: "writing_progress" })]);
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prkl_AAAAAAAAAAA1");
  });

  it("reports the repository's error", async () => {
    fakeSupabase({ writing_projects: [{ id: PROJECT }] });
    vi.spyOn(repos.writing, "addEntry").mockRejectedValue(new Error("insert failed"));

    expect(await logProgress(input)).toEqual({ error: "insert failed" });
  });

  it("falls back to a generic message for an error that isn't an Error", async () => {
    fakeSupabase({ writing_projects: [{ id: PROJECT }] });
    vi.spyOn(repos.writing, "addEntry").mockRejectedValue("nope");

    expect(await logProgress(input)).toEqual({ error: "Failed to log progress" });
  });
});

describe("updateEntry", () => {
  it("changes the member's entry and trims the note", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { prickle_id: "prkl_AAAAAAAAAAA1" })]);
    fakeSupabase();

    const result = await updateEntry("wpe_AAAAAAAAAAA1", { entryDate: "2026-02-02", measure: "pages", mode: "set_total", amount: 12, note: " hi ", tags: ["A", "a"], prickleId: null });

    expect(result).toEqual({ success: true });
    expect(await repos.writing.entriesForProjects(ME, [PROJECT])).toEqual([
      expect.objectContaining({ entry_date: "2026-02-02", measure: "pages", mode: "set_total", amount: 12, note: "hi", tags: ["a"] }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prkl_AAAAAAAAAAA1");
  });

  it("clears a blank note", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { note: "old" })]);
    fakeSupabase();

    await updateEntry("wpe_AAAAAAAAAAA1", { entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 1, note: "   " });

    expect((await repos.writing.entriesForProjects(ME, [PROJECT]))[0].note).toBeNull();
  });

  it("won't touch an entry that isn't the member's, or doesn't exist", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { member_id: OTHER })]);
    fakeSupabase();

    expect(await updateEntry("wpe_AAAAAAAAAAA1", { amount: 5 })).toEqual({ error: "Entry not found" });
    expect(await updateEntry("wpe_AAAAAAAAAAA9", { amount: 5 })).toEqual({ error: "Entry not found" });
  });

  it("treats a failed lookup as not found", async () => {
    useData([entry("wpe_AAAAAAAAAAA1")]);
    fakeSupabase();
    vi.spyOn(repos.writing, "findEntry").mockRejectedValue(new Error("down"));

    expect(await updateEntry("wpe_AAAAAAAAAAA1", { amount: 5 })).toEqual({ error: "Entry not found" });
  });

  it("rejects invalid input before saving", async () => {
    useData([entry("wpe_AAAAAAAAAAA1")]);
    fakeSupabase();

    expect(await updateEntry("wpe_AAAAAAAAAAA1", { amount: 5 })).toEqual({ error: "entryDate is required" });
  });

  it("reports the repository's error", async () => {
    useData([entry("wpe_AAAAAAAAAAA1")]);
    fakeSupabase();
    vi.spyOn(repos.writing, "updateEntry").mockRejectedValue(new Error("update failed"));
    expect(await updateEntry("wpe_AAAAAAAAAAA1", { entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 1 })).toEqual({ error: "update failed" });

    vi.spyOn(repos.writing, "updateEntry").mockRejectedValue("nope");
    expect(await updateEntry("wpe_AAAAAAAAAAA1", { entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 1 })).toEqual({ error: "Failed to update entry" });
  });
});

describe("deleteEntry", () => {
  it("deletes the member's entry", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { prickle_id: "prkl_AAAAAAAAAAA1" })]);
    fakeSupabase();

    expect(await deleteEntry("wpe_AAAAAAAAAAA1")).toEqual({ success: true });
    expect(await repos.writing.findEntry("wpe_AAAAAAAAAAA1")).toBeNull();
    // Soft delete: the row stays, marked deleted, until the member asks us to remove it.
    expect(dataset.writingEntries).toHaveLength(1);
    expect(dataset.writingEntries[0].deleted_at).toEqual(expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/prickles/prkl_AAAAAAAAAAA1");
  });

  it("won't delete someone else's entry", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { member_id: OTHER })]);
    fakeSupabase();

    expect(await deleteEntry("wpe_AAAAAAAAAAA1")).toEqual({ error: "Entry not found" });
    expect(await repos.writing.findEntry("wpe_AAAAAAAAAAA1")).not.toBeNull();
  });

  it("reports the repository's error", async () => {
    useData([entry("wpe_AAAAAAAAAAA1")]);
    fakeSupabase();
    vi.spyOn(repos.writing, "deleteEntry").mockRejectedValue(new Error("delete failed"));
    expect(await deleteEntry("wpe_AAAAAAAAAAA1")).toEqual({ error: "delete failed" });

    vi.spyOn(repos.writing, "deleteEntry").mockRejectedValue("nope");
    expect(await deleteEntry("wpe_AAAAAAAAAAA1")).toEqual({ error: "Failed to delete entry" });
  });
});

describe("totals", () => {
  it("builds a project's cumulative series from its entries, plus the starting balance", async () => {
    useData([
      entry("wpe_AAAAAAAAAAA1", { entry_date: "2026-02-01", amount: 100 }),
      entry("wpe_AAAAAAAAAAA2", { entry_date: "2026-02-02", amount: 50, created_at: "2026-02-02T10:00:00Z" }),
      entry("wpe_AAAAAAAAAAA3", { entry_date: "2026-02-02", amount: 7, measure: "pages" }),
    ]);
    fakeSupabase({ writing_project_starting_balances: [] });

    expect(await getProjectSeries(PROJECT, "words")).toEqual([
      { entryDate: "2026-02-01", total: 100 },
      { entryDate: "2026-02-02", total: 150 },
    ]);
  });

  it("gives archived goals their progress from the project's entries", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { amount: 300 })], [goalRow({ archived_at: "2026-06-01T00:00:00Z" })]);
    fakeSupabase();

    const [goal] = await getArchivedGoals(PROJECT);

    expect(goal).toEqual(expect.objectContaining({ id: "wgol_AAAAAAAAAAA1", kind: "target", targetAmount: 1000 }));
    expect(JSON.stringify(goal)).toContain("300");
  });

  it("gives starred goals their project's title and progress", async () => {
    useData([entry("wpe_AAAAAAAAAAA1", { amount: 300 })], [goalRow({ is_starred: true })]);
    fakeSupabase();

    const [goal] = await getStarredGoals();

    expect(goal).toEqual(expect.objectContaining({ id: "wgol_AAAAAAAAAAA1", projectTitle: "Novel" }));
    expect(JSON.stringify(goal)).toContain("300");
  });
});
