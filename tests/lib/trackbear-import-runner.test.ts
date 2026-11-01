import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryWritingRepository } from "@/lib/data/writing";
import { runTrackbearImport, type CoverCopier } from "@/lib/trackbear-import-runner";
import { trackbearExternalId } from "@/lib/trackbear-import";
import { makeTrackbearData } from "@/tests/fixtures/trackbear/data";

// The import runner over the in-memory writing repository (the db suite runs it against Postgres).

const ME = "mbr_AAAAAAAAAAA1";
const PROJECT_UUID = "11111111-1111-4111-8111-111111111111";

let dataset: InMemoryDataset;
let writing: InMemoryWritingRepository;
const copier: CoverCopier = async (filename) => ({ url: `https://example.test/${filename}.jpg`, assetId: null });

beforeEach(() => {
  dataset = new InMemoryDataset();
  writing = new InMemoryWritingRepository(dataset);
});

describe("runTrackbearImport", () => {
  it("brings over projects, balances, entries, goals and covers, then does nothing the second time", async () => {
    const first = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(first.created).toEqual({ projects: 2, entries: 4, goals: 2, startingBalances: 2, covers: 1 });
    expect(dataset.writingProjects.find((p) => p.external_id === trackbearExternalId(PROJECT_UUID))?.cover_url).toMatch(/^https:\/\/example\.test\//);

    const second = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(second.created).toEqual({ projects: 0, entries: 0, goals: 0, startingBalances: 0, covers: 0 });
    expect(second.alreadyImported).toEqual({ projects: 2, entries: 4, goals: 2 });
    expect(dataset.writingProjects).toHaveLength(2);
    expect(dataset.writingEntries).toHaveLength(4);
  });

  it("overwrites what Hub has with the export's values, and reports what changed", async () => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    const project = dataset.writingProjects.find((p) => p.external_id === trackbearExternalId(PROJECT_UUID))!;
    const balances = () => dataset.writingBalances.filter((b) => b.project_id === project.id);
    const goal = dataset.writingGoals.find((g) => g.external_id === trackbearExternalId("20202020-2020-4020-8020-202020202020"))!;
    const entry = dataset.writingEntries.find((e) => e.external_id === trackbearExternalId("10101010-1010-4010-8010-101010101010"))!;

    // The time balance went missing, the word balance and others were changed in Hub.
    dataset.writingBalances.splice(dataset.writingBalances.findIndex((b) => b.project_id === project.id && b.measure === "time_minutes"), 1);
    balances().find((b) => b.measure === "words")!.amount = 24657;
    Object.assign(project, { title: "Renamed in Hub", phase: "drafting" });
    Object.assign(goal, { end_date: "2026-03-13", target_amount: 1, title: null, is_starred: true });
    Object.assign(entry, { amount: 7, note: "edited", tags: [] });

    const again = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(again.created).toEqual({ projects: 0, entries: 0, goals: 0, startingBalances: 0, covers: 0 });
    expect(again.updated).toEqual({ projects: 1, entries: 1, goals: 1, startingBalances: 2 });
    expect(balances().map((b) => [b.measure, b.amount]).sort()).toEqual([["time_minutes", 90], ["words", 12000]]);
    expect(project).toMatchObject({ title: "The Hedgehog's Journey", phase: "on_hold" });
    expect(goal).toMatchObject({ title: "Finish draft", target_amount: expect.any(Number), is_starred: true });
    expect(goal.target_amount).not.toBe(1);
    expect(goal.end_date).not.toBe("2026-03-13");
    expect(entry).toMatchObject({ amount: 1500, note: "Great session", tags: ["drafting", "sprint"] });

    const third = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    expect(third.updated).toEqual({ projects: 0, entries: 0, goals: 0, startingBalances: 0 });
  });

  it("leaves what exists only in Hub, and what the member deleted, alone", async () => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    const project = dataset.writingProjects.find((p) => p.external_id === trackbearExternalId(PROJECT_UUID))!;
    const deleted = dataset.writingEntries.find((e) => e.external_id === trackbearExternalId("10101010-1010-4010-8010-101010101010"))!;
    Object.assign(deleted, { amount: 7, deleted_at: "2026-02-01T00:00:00Z" });
    dataset.writingBalances.push({ project_id: project.id, member_id: ME, measure: "pages", amount: 40 });
    // An entry made in Hub, with no TrackBear counterpart.
    dataset.writingEntries.push({ ...deleted, id: "wpe_AAAAAAAAAAA9", external_id: null, amount: 1, deleted_at: null } as never);
    const before = dataset.writingEntries.length;

    const again = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(again.updated.entries).toBe(0);
    expect(deleted.amount).toBe(7);
    expect(dataset.writingEntries).toHaveLength(before);
    expect(dataset.writingBalances.find((b) => b.project_id === project.id && b.measure === "pages")?.amount).toBe(40);
  });

  it("reports a cover that can't be copied or saved, and carries on", async () => {
    const failing: CoverCopier = async () => ({ error: "too big" });
    const result = await runTrackbearImport(writing, ME, makeTrackbearData(), failing);

    expect(result.created.covers).toBe(0);
    expect(result.created.projects).toBe(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "dropped", detail: "Cover: too big" }));

    const other = new InMemoryWritingRepository(new InMemoryDataset());
    vi.spyOn(other, "updateProject").mockRejectedValue(new Error("write failed"));
    const saved = await runTrackbearImport(other, ME, makeTrackbearData(), copier);

    expect(saved.created.covers).toBe(0);
    expect(saved.issues).toContainEqual(expect.objectContaining({ severity: "dropped", detail: "Cover: write failed" }));
    vi.spyOn(other, "updateProject").mockRejectedValue("odd");
    const odd = await runTrackbearImport(new InMemoryWritingRepository(new InMemoryDataset()), ME, makeTrackbearData(), copier);
    expect(odd.created.covers).toBe(1);

    const stringFailure = new InMemoryWritingRepository(new InMemoryDataset());
    vi.spyOn(stringFailure, "updateProject").mockRejectedValue("odd");
    const result2 = await runTrackbearImport(stringFailure, ME, makeTrackbearData(), copier);
    expect(result2.issues).toContainEqual(expect.objectContaining({ detail: "Cover: odd" }));
  });

  it("saves the library image a cover was copied to, named after the project, and says nothing about resizing", async () => {
    const titles: (string | undefined)[] = [];
    const library: CoverCopier = async (filename, _memberId, title) => {
      titles.push(title);
      return { url: `/api/media/media_AAAAAAAAAAA1/book_cover_shelf`, assetId: "media_AAAAAAAAAAA1" };
    };

    const result = await runTrackbearImport(writing, ME, makeTrackbearData(), library);

    expect(result.created.covers).toBe(1);
    expect(titles).toEqual([expect.any(String)]);
    expect(titles[0]).toBeTruthy();
    expect(dataset.writingProjects.filter((p) => p.cover_asset_id === "media_AAAAAAAAAAA1")).toHaveLength(1);
    expect(dataset.writingProjects.find((p) => p.cover_asset_id)?.cover_url).toBe("/api/media/media_AAAAAAAAAAA1/book_cover_shelf");
    expect(result.issues.filter((i) => i.severity === "changed")).toEqual([]);
  });

  it("finds the ids of projects a concurrent import created first", async () => {
    const real = writing.importProjects.bind(writing);
    vi.spyOn(writing, "importProjects").mockImplementation(async (rows) => {
      await real(rows);
      return [];
    });

    const result = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(result.created.projects).toBe(0);
    expect(result.created.entries).toBe(4);
    const projectIds = new Set(dataset.writingProjects.map((p) => p.id));
    expect(dataset.writingEntries.every((e) => projectIds.has(e.project_id))).toBe(true);
  });

  it.each([
    ["importProjects", "Failed to create projects"],
    ["importStartingBalances", "Failed to save starting balances"],
    ["importEntries", "Failed to save progress entries"],
    ["importGoals", "Failed to save goals"],
  ] as const)("names what failed when %s throws", async (method, message) => {
    vi.spyOn(writing, method).mockRejectedValue(new Error("boom"));

    await expect(runTrackbearImport(writing, ME, makeTrackbearData(), copier)).rejects.toThrow(`${message}: boom`);
  });

  it.each([
    ["updateProject", "Failed to update projects"],
    ["replaceStartingBalances", "Failed to update starting balances"],
    ["overwriteImportedEntries", "Failed to update progress entries"],
  ] as const)("names an update that fails: %s", async (method, message) => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    // Make Hub differ from the export in all three places, so each update has something to do.
    Object.assign(dataset.writingProjects[0], { title: "x" });
    dataset.writingBalances.length = 0;
    Object.assign(dataset.writingEntries[0], { amount: 1 });
    vi.spyOn(writing, method).mockRejectedValue(new Error("boom"));

    await expect(runTrackbearImport(writing, ME, makeTrackbearData(), copier)).rejects.toThrow(`${message}: boom`);
  });

  it("names a goal update that fails, and a failure that is not an Error", async () => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    for (const goal of dataset.writingGoals) Object.assign(goal, { title: null, description: null, target_amount: 1 });
    vi.spyOn(writing, "overwriteImportedGoal").mockRejectedValue("odd");

    await expect(runTrackbearImport(writing, ME, makeTrackbearData(), copier)).rejects.toThrow("Failed to update goals: odd");
  });
});
