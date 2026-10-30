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

  it("fills in the details of an imported goal that has none", async () => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    const goal = dataset.writingGoals.find((g) => g.external_id === trackbearExternalId("20202020-2020-4020-8020-202020202020"))!;
    Object.assign(goal, { title: null, description: null, show_on_profile: false });

    const again = await runTrackbearImport(writing, ME, makeTrackbearData(), copier);

    expect(again.updated).toEqual({ goalDetails: 1 });
    expect(goal).toMatchObject({ title: "Finish draft", description: "80k by summer", show_on_profile: true });
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

  it("names a goal update that fails, and a failure that is not an Error", async () => {
    await runTrackbearImport(writing, ME, makeTrackbearData(), copier);
    for (const goal of dataset.writingGoals) Object.assign(goal, { title: null, description: null });
    vi.spyOn(writing, "backfillGoalDetails").mockRejectedValue("odd");

    await expect(runTrackbearImport(writing, ME, makeTrackbearData(), copier)).rejects.toThrow("Failed to update goals: odd");
  });
});
