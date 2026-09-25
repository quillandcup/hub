import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  planTrackbearImport,
  trackbearExternalId,
  TrackbearImportError,
  extractTrackbearExport,
  type ExistingImports,
} from "@/lib/trackbear-import";
import { makeTrackbearData } from "../fixtures/trackbear/data";

const NOTHING_IMPORTED: ExistingImports = {
  projectIdsByExternalId: new Map(),
  entryExternalIds: new Set(),
  goalExternalIds: new Set(),
};

const P1 = trackbearExternalId("11111111-1111-4111-8111-111111111111");
const P2 = trackbearExternalId("22222222-2222-4222-8222-222222222222");

describe("extractTrackbearExport", () => {
  const json = JSON.stringify(makeTrackbearData());

  it("reads trackbear-progress-data.json out of TrackBear's export zip", () => {
    const zip = zipSync({
      "trackbear-progress-data.json": strToU8(json),
      "tallies/all-tallies.csv": strToU8("id,uuid\n"),
    });
    const data = extractTrackbearExport(zip);
    expect(data.projects).toHaveLength(2);
    expect(data.tallies).toHaveLength(4);
  });

  it("accepts the bare JSON file", () => {
    expect(extractTrackbearExport(strToU8(json)).habits).toHaveLength(2);
  });

  it("rejects a zip without the JSON file", () => {
    const zip = zipSync({ "tallies/all-tallies.csv": strToU8("id\n") });
    expect(() => extractTrackbearExport(zip)).toThrow(TrackbearImportError);
  });

  it("rejects non-TrackBear JSON and garbage", () => {
    expect(() => extractTrackbearExport(strToU8('{"projects": []}'))).toThrow(/missing "tallies"/);
    expect(() => extractTrackbearExport(strToU8("not json"))).toThrow(TrackbearImportError);
  });

  it("rejects a malformed tally", () => {
    const data = makeTrackbearData();
    (data.tallies[0] as { date: string }).date = "Jan 5";
    expect(() => extractTrackbearExport(strToU8(JSON.stringify(data)))).toThrow(/progress entry \(#1\)/);
  });
});

describe("planTrackbearImport", () => {
  const plan = planTrackbearImport(makeTrackbearData(), NOTHING_IMPORTED);
  const issuesFor = (label: string) => plan.issues.filter((i) => i.label === label);

  it("maps projects, phases, visibility, cover, and starting balances", () => {
    expect(plan.newProjects).toEqual([
      {
        externalId: P1,
        title: "The Hedgehog's Journey",
        description: "A cozy fantasy.",
        phase: "on_hold",
        showOnProfile: true,
        createdAt: "2025-01-02T10:00:00.000Z",
        coverFilename: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
        startingBalances: [
          { measure: "words", amount: 12000 },
          { measure: "time_minutes", amount: 90 },
        ],
      },
      expect.objectContaining({ externalId: P2, phase: "complete", description: null, coverFilename: null }),
    ]);
  });

  it("imports every tally as a delta entry, keeping negative counts, notes, tags, and timestamps", () => {
    expect(plan.newEntries).toHaveLength(4);
    expect(plan.newEntries[0]).toEqual({
      externalId: trackbearExternalId("10101010-1010-4010-8010-101010101010"),
      projectExternalId: P1,
      entryDate: "2025-01-05",
      measure: "words",
      mode: "delta",
      amount: 1500,
      note: "Great session",
      tags: ["drafting", "sprint"],
      createdAt: "2025-01-05T20:00:00.000Z",
    });
    expect(plan.newEntries[1]).toMatchObject({ measure: "time_minutes", amount: 45, note: null, tags: [] });
    expect(plan.newEntries[2]).toMatchObject({ amount: -200 });
    expect(plan.newEntries[3]).toMatchObject({ projectExternalId: P2, measure: "lines" });
  });

  it("maps a single-project target and a daily habit", () => {
    expect(plan.newGoals).toEqual([
      {
        externalId: trackbearExternalId("20202020-2020-4020-8020-202020202020"),
        projectExternalId: P1,
        goalType: "target",
        measure: "words",
        targetAmount: 80000,
        startDate: "2025-01-01",
        endDate: "2025-06-30",
        habitPeriod: null,
        habitThreshold: null,
        isStarred: true,
        createdAt: "2025-01-02T11:00:00.000Z",
      },
      expect.objectContaining({ goalType: "habit", measure: "time_minutes", habitPeriod: "day", habitThreshold: 30 }),
    ]);
  });

  it("reports goals Hub can't represent as skipped, with the reason", () => {
    expect(issuesFor("Yearly words")).toEqual([expect.objectContaining({ severity: "skipped", detail: expect.stringMatching(/all projects/) })]);
    expect(issuesFor("Every other week")).toEqual([expect.objectContaining({ severity: "skipped", detail: expect.stringMatching(/every 2 weeks/) })]);
  });

  it("reports every field that has nowhere to go in Hub", () => {
    expect(issuesFor("The Hedgehog's Journey")).toEqual([
      expect.objectContaining({ severity: "dropped", detail: expect.stringMatching(/Starred/) }),
    ]);
    expect(issuesFor("Finish draft").map((i) => i.detail)).toEqual([
      expect.stringMatching(/^Title "Finish draft"/),
      expect.stringMatching(/^Description/),
    ]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ kind: "tag", severity: "dropped", detail: expect.stringMatching(/colors/) }));
    expect(plan.issues).toContainEqual(expect.objectContaining({ kind: "tag", severity: "skipped", label: "unused" }));
  });

  it("skips goals that filter by tag or span several projects", () => {
    const data = makeTrackbearData();
    data.targets[0].tagIds = [100];
    data.habits[0].workIds = [1, 2];
    const p = planTrackbearImport(data, NOTHING_IMPORTED);
    expect(p.newGoals).toHaveLength(0);
    expect(p.issues).toContainEqual(expect.objectContaining({ label: "Finish draft", detail: expect.stringMatching(/tagged Drafting/) }));
    expect(p.issues).toContainEqual(expect.objectContaining({ label: "Untitled habit", detail: expect.stringMatching(/Spans 2 projects/) }));
  });

  it("reports a habit's date range as dropped, since Hub habits are open-ended", () => {
    const data = makeTrackbearData();
    data.habits[0].startDate = "2025-01-01";
    const p = planTrackbearImport(data, NOTHING_IMPORTED);
    expect(p.newGoals).toContainEqual(expect.objectContaining({ goalType: "habit", startDate: null }));
    expect(p.issues).toContainEqual(expect.objectContaining({ severity: "dropped", detail: expect.stringMatching(/^Date range/) }));
  });

  it("drops a negative starting balance instead of violating Hub's CHECK", () => {
    const data = makeTrackbearData();
    data.projects[1].startingBalance = { page: -3 };
    const p = planTrackbearImport(data, NOTHING_IMPORTED);
    expect(p.newProjects[1].startingBalances).toEqual([]);
    expect(p.issues).toContainEqual(expect.objectContaining({ label: "Poems", detail: expect.stringMatching(/Negative/) }));
  });

  it("skips what's already imported, but still plans new entries on an already-imported project", () => {
    const data = makeTrackbearData();
    const p = planTrackbearImport(data, {
      projectIdsByExternalId: new Map([[P1, "hub-p1"], [P2, "hub-p2"]]),
      entryExternalIds: new Set(data.tallies.slice(0, 3).map((t) => trackbearExternalId(t.uuid))),
      goalExternalIds: new Set([trackbearExternalId(data.targets[0].uuid), trackbearExternalId(data.habits[0].uuid)]),
    });
    expect(p.newProjects).toEqual([]);
    expect(p.newEntries.map((e) => e.projectExternalId)).toEqual([P2]);
    expect(p.newGoals).toEqual([]);
    expect(p.alreadyImported).toEqual({ projects: 2, entries: 3, goals: 2 });
  });
});
