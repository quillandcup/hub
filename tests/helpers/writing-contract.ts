import { describe, it, expect, beforeEach } from "vitest";
import type { WritingRepository } from "@/lib/data/writing";

export type SeedProject = { key: string; member: 0 | 1; title: string; archived?: boolean; createdAt: string };
export type SeedGoal = { member: 0 | 1; project?: string; measure: string; archived?: boolean };
export type SeedEntry = { member: 0 | 1; project: string; entryDate: string; measure: string; mode: "delta" | "set_total"; amount: number; createdAt: string; prickle?: boolean; note?: string; tags?: string[] };

export type WritingContractContext = {
  repo: () => WritingRepository;
  memberIds: readonly [string, string];
  /** A prickle entries can be logged against. */
  prickleId: string;
  /** Replaces the two members' projects, goals and entries with these; returns each project's id by its key. */
  seed: (data: { projects?: SeedProject[]; goals?: SeedGoal[]; entries?: SeedEntry[] }) => Promise<Record<string, string>>;
};

/** Behavior every `WritingRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineWritingContract(name: string, setup: () => WritingContractContext) {
  describe(`${name} (WritingRepository contract)`, () => {
    let ctx: WritingContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists a member's projects that aren't archived, newest first, and names the latest", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({
        projects: [
          { key: "old", member: 0, title: "Old Draft", createdAt: "2026-01-01T10:00:00Z" },
          { key: "new", member: 0, title: "New Draft", createdAt: "2026-03-01T10:00:00Z" },
          { key: "gone", member: 0, title: "Shelved", archived: true, createdAt: "2026-05-01T10:00:00Z" },
          { key: "theirs", member: 1, title: "Not Mine", createdAt: "2026-06-01T10:00:00Z" },
        ],
      });

      const mine = await ctx.repo().activeProjects(a);
      expect(mine.map((p) => p.title)).toEqual(["New Draft", "Old Draft"]);
      expect(await ctx.repo().latestActiveProjectId(a)).toBe(mine[0].id);
      expect((await ctx.repo().activeProjects(b)).map((p) => p.title)).toEqual(["Not Mine"]);
    });

    it("has nothing for a member without projects", async () => {
      const [a] = ctx.memberIds;
      await ctx.seed({});

      expect(await ctx.repo().activeProjects(a)).toEqual([]);
      expect(await ctx.repo().latestActiveProjectId(a)).toBeNull();
      expect(await ctx.repo().goalCount(a)).toBe(0);
    });

    it("knows whether a project is the member's own", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "mine", member: 0, title: "Mine", createdAt: "2026-01-01T10:00:00Z" }] });

      expect(await ctx.repo().ownsProject(a, ids.mine)).toBe(true);
      expect(await ctx.repo().ownsProject(b, ids.mine)).toBe(false);
      expect(await ctx.repo().ownsProject(a, "00000000-0000-4000-8000-000000000000")).toBe(false);
    });

    it("counts goals, archived ones too, and lists the measures of the ones in play", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }],
        goals: [
          { member: 0, project: "p", measure: "words" },
          { member: 0, measure: "time_minutes" },
          { member: 0, project: "p", measure: "pages", archived: true },
          { member: 1, measure: "words" },
        ],
      });

      expect(await ctx.repo().goalCount(a)).toBe(3);
      expect(await ctx.repo().goalCount(b)).toBe(1);
      const measures = (await ctx.repo().activeGoalMeasures(a)).map((g) => `${g.project_id ?? "-"}|${g.measure}`).sort();
      expect(measures).toEqual([`${ids.p}|words`, "-|time_minutes"].sort());
    });

    it("returns the latest entries' measures newest first, up to the limit", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }, { key: "q", member: 1, title: "Q", createdAt: "2026-01-01T10:00:00Z" }],
        entries: [
          { member: 0, project: "p", entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 100, createdAt: "2026-02-01T10:00:00Z" },
          { member: 0, project: "p", entryDate: "2026-02-02", measure: "pages", mode: "delta", amount: 2, createdAt: "2026-02-02T10:00:00Z" },
          { member: 0, project: "p", entryDate: "2026-02-03", measure: "time_minutes", mode: "delta", amount: 30, createdAt: "2026-02-03T10:00:00Z" },
          { member: 1, project: "q", entryDate: "2026-02-04", measure: "scenes", mode: "delta", amount: 1, createdAt: "2026-02-04T10:00:00Z" },
        ],
      });

      expect(await ctx.repo().recentEntryMeasures(a, 2)).toEqual([
        { project_id: ids.p, measure: "time_minutes" },
        { project_id: ids.p, measure: "pages" },
      ]);
      expect((await ctx.repo().recentEntryMeasures(b, 5)).map((e) => e.measure)).toEqual(["scenes"]);
    });

    it("lists what was logged against a prickle in the order it was logged", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }, { key: "q", member: 1, title: "Q", createdAt: "2026-01-01T10:00:00Z" }],
        entries: [
          { member: 0, project: "p", entryDate: "2026-02-02", measure: "pages", mode: "delta", amount: 2, createdAt: "2026-02-02T10:00:00Z", prickle: true },
          { member: 0, project: "p", entryDate: "2026-02-01", measure: "words", mode: "set_total", amount: 900, createdAt: "2026-02-01T10:00:00Z", prickle: true },
          { member: 0, project: "p", entryDate: "2026-02-03", measure: "words", mode: "delta", amount: 5, createdAt: "2026-02-03T10:00:00Z" },
          { member: 1, project: "q", entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 7, createdAt: "2026-02-01T10:00:00Z", prickle: true },
        ],
      });

      expect(await ctx.repo().entriesForPrickle(a, ctx.prickleId)).toEqual([
        { project_id: ids.p, measure: "words", mode: "set_total", amount: 900 },
        { project_id: ids.p, measure: "pages", mode: "delta", amount: 2 },
      ]);
      expect((await ctx.repo().entriesForPrickle(b, ctx.prickleId)).map((e) => e.amount)).toEqual([7]);
    });

    it("exports a member's entries by date with their project's title, optionally one project's", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [{ key: "p", member: 0, title: "First", createdAt: "2026-01-01T10:00:00Z" }, { key: "q", member: 0, title: "Second", createdAt: "2026-01-02T10:00:00Z" }],
        entries: [
          { member: 0, project: "q", entryDate: "2026-02-03", measure: "words", mode: "delta", amount: 30, createdAt: "2026-02-03T10:00:00Z", note: "late", tags: ["x", "y"] },
          { member: 0, project: "p", entryDate: "2026-02-01", measure: "pages", mode: "delta", amount: 2, createdAt: "2026-02-04T10:00:00Z" },
        ],
      });

      expect(await ctx.repo().exportEntries(a)).toEqual([
        { entry_date: "2026-02-01", project_title: "First", measure: "pages", mode: "delta", amount: 2, note: null, tags: [] },
        { entry_date: "2026-02-03", project_title: "Second", measure: "words", mode: "delta", amount: 30, note: "late", tags: ["x", "y"] },
      ]);
      expect((await ctx.repo().exportEntries(a, { projectId: ids.q })).map((e) => e.project_title)).toEqual(["Second"]);
    });

    it("saves an entry and returns its id", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }] });

      const id = await ctx.repo().addEntry({ memberId: a, projectId: ids.p, entryDate: "2026-02-05", measure: "words", mode: "delta", amount: 250, prickleId: ctx.prickleId });

      expect(id).toEqual(expect.any(String));
      expect(await ctx.repo().entriesForPrickle(a, ctx.prickleId)).toEqual([{ project_id: ids.p, measure: "words", mode: "delta", amount: 250 }]);
      expect(await ctx.repo().exportEntries(a)).toEqual([{ entry_date: "2026-02-05", project_title: "P", measure: "words", mode: "delta", amount: 250, note: null, tags: [] }]);
    });
  });
}
