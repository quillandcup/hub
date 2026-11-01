import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  planTrackbearImport,
  trackbearExternalId,
  TrackbearImportError,
  extractTrackbearExport,
  type ExistingImports,
  type ExistingProjectDetails,
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

  it("maps a single-project target and a daily habit, with their titles, descriptions and profile flag", () => {
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
        title: "Finish draft",
        description: "80k by summer",
        showOnProfile: true,
        createdAt: "2025-01-02T11:00:00.000Z",
      },
      expect.objectContaining({
        goalType: "habit",
        measure: "time_minutes",
        habitPeriod: "day",
        habitThreshold: 30,
        title: null,
        description: null,
        showOnProfile: false,
      }),
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
    expect(issuesFor("Finish draft")).toEqual([]);
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
    expect(p.projectUpdates).toEqual([]);
    expect(p.goalUpdates).toEqual([]);
    expect(p.entryUpdates).toEqual([]);
  });

  describe("overwriting what is already in Hub", () => {
    const data = makeTrackbearData();
    const tally = data.tallies[0];
    const entryId = trackbearExternalId(tally.uuid);
    const target = trackbearExternalId(data.targets[0].uuid);
    const matchingProject: ExistingProjectDetails = { title: "The Hedgehog's Journey", description: "A cozy fantasy.", phase: "on_hold", showOnProfile: true, deleted: false };
    const matchingEntry = { projectId: "hub-p1", entryDate: "2025-01-05", measure: "words", mode: "delta", amount: 1500, note: "Great session", tags: ["drafting", "sprint"], deleted: false };

    function existingWith(overrides: Partial<ExistingImports>): ExistingImports {
      return {
        projectIdsByExternalId: new Map([[P1, "hub-p1"], [P2, "hub-p2"]]),
        entryExternalIds: new Set(),
        goalExternalIds: new Set(),
        ...overrides,
      };
    }

    it("plans nothing when Hub already matches the export", () => {
      const p = planTrackbearImport(
        data,
        existingWith({
          projectDetails: new Map([[P1, matchingProject], [P2, { title: "Poems", description: null, phase: "complete", showOnProfile: false, deleted: false }]]),
          entryExternalIds: new Set([entryId]),
          entryDetails: new Map([[entryId, matchingEntry]]),
          startingBalances: new Map([[P1, new Map([["words", 12000], ["time_minutes", 90]])]]),
        })
      );
      expect(p.projectUpdates).toEqual([]);
      expect(p.entryUpdates).toEqual([]);
      expect(p.startingBalanceUpdates).toEqual([]);
    });

    it("plans the export's project fields and starting balances over Hub's", () => {
      const p = planTrackbearImport(
        data,
        existingWith({
          projectDetails: new Map([[P1, { ...matchingProject, title: "Renamed", description: null, phase: "drafting", showOnProfile: false }]]),
          startingBalances: new Map([[P1, new Map([["words", 24657]])]]),
        })
      );
      expect(p.projectUpdates).toEqual([
        { externalId: P1, title: "The Hedgehog's Journey", description: "A cozy fantasy.", phase: "on_hold", showOnProfile: true },
      ]);
      expect(p.startingBalanceUpdates).toEqual([
        { projectExternalId: P1, measure: "words", amount: 12000 },
        { projectExternalId: P1, measure: "time_minutes", amount: 90 },
      ]);
    });

    it("keeps Hub's phase when TrackBear's is one Hub doesn't know", () => {
      const odd = makeTrackbearData();
      odd.projects[0].phase = "limbo";
      const p = planTrackbearImport(odd, existingWith({ projectDetails: new Map([[P1, { ...matchingProject, title: "Renamed" }]]) }));
      expect(p.projectUpdates[0]).toMatchObject({ externalId: P1, phase: "on_hold" });
      expect(p.issues.filter((i) => i.kind === "project" && /phase/.test(i.detail))).toEqual([]);
    });

    it("plans an entry whose amount, date, note, tags or project differ, and says nothing about ones that match", () => {
      for (const change of [{ amount: 1 }, { entryDate: "2025-01-01" }, { note: null }, { tags: ["drafting"] }, { projectId: "hub-p2" }]) {
        const p = planTrackbearImport(
          data,
          existingWith({ entryExternalIds: new Set([entryId]), entryDetails: new Map([[entryId, { ...matchingEntry, ...change }]]) })
        );
        expect(p.entryUpdates.map((e) => e.externalId)).toEqual([entryId]);
        expect(p.newEntries.map((e) => e.externalId)).not.toContain(entryId);
      }
    });

    it("plans the export's goal fields over Hub's", () => {
      const goalBefore = { projectId: "hub-p1", goalType: "target", measure: "words", targetAmount: 1, startDate: null, endDate: "2026-03-13", habitPeriod: null, habitThreshold: null, title: "Finish draft", description: "80k by summer", showOnProfile: true, deleted: false };
      const p = planTrackbearImport(data, existingWith({ goalExternalIds: new Set([target]), goalDetails: new Map([[target, goalBefore]]) }));
      expect(p.goalUpdates).toHaveLength(1);
      expect(p.goalUpdates[0]).toMatchObject({ externalId: target, targetAmount: data.targets[0].parameters?.threshold?.count });
      expect(p.newGoals.map((g) => g.externalId)).not.toContain(target);
    });

    it("leaves what the member deleted in Hub alone", () => {
      const p = planTrackbearImport(
        data,
        existingWith({
          projectDetails: new Map([[P1, { ...matchingProject, title: "Renamed", deleted: true }]]),
          entryExternalIds: new Set([entryId]),
          entryDetails: new Map([[entryId, { ...matchingEntry, amount: 1, deleted: true }]]),
          goalExternalIds: new Set([target]),
          goalDetails: new Map([[target, { projectId: "hub-p1", goalType: "target", measure: "words", targetAmount: 1, startDate: null, endDate: null, habitPeriod: null, habitThreshold: null, title: null, description: null, showOnProfile: false, deleted: true }]]),
          startingBalances: new Map(),
        })
      );
      expect(p.projectUpdates).toEqual([]);
      expect(p.startingBalanceUpdates.filter((u) => u.projectExternalId === P1)).toEqual([]);
      expect(p.entryUpdates).toEqual([]);
      expect(p.goalUpdates).toEqual([]);
    });

    it("does not report problems again for a record that was reported when it was first imported", () => {
      const odd = makeTrackbearData();
      odd.projects[0].startingBalance = { word: 5, bogus: 3 };
      odd.tallies[0].measure = "bogus";
      const p = planTrackbearImport(
        odd,
        existingWith({ entryExternalIds: new Set([entryId]), projectDetails: new Map([[P1, matchingProject]]), startingBalances: new Map() })
      );
      expect(p.issues.filter((i) => i.kind === "entry" && /bogus/.test(i.detail))).toEqual([]);
      expect(p.issues.filter((i) => /bogus/.test(i.detail))).toEqual([]);
      expect(p.startingBalanceUpdates).toEqual([{ projectExternalId: P1, measure: "words", amount: 5 }]);
    });
  });
});
