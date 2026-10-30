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
  /** The name of that prickle's type and of its host (the second member). */
  prickleTypeName: string;
  prickleHostName: string;
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

    // --- goals ---
    it("creates a goal, reads it back for editing, and changes it only for its owner", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }] });

      const id = await ctx.repo().createGoal({ member_id: a, project_id: ids.p, goal_type: "target", measure: "words", target_amount: 5000 });
      expect(await ctx.repo().goalForEdit(id)).toEqual({
        id,
        project_id: ids.p,
        member_id: a,
        goal_type: "target",
        measure: "words",
        target_amount: 5000,
        start_date: null,
        end_date: null,
        habit_period: null,
        habit_threshold: null,
      });
      expect(await ctx.repo().goalForEdit("00000000-0000-4000-8000-000000000000")).toBeNull();

      await ctx.repo().updateGoal(b, id, { target_amount: 1 });
      expect((await ctx.repo().goalForEdit(id))?.target_amount).toBe(5000);
      await ctx.repo().updateGoal(a, id, { target_amount: 7000 });
      expect((await ctx.repo().goalForEdit(id))?.target_amount).toBe(7000);
    });

    it("deletes a goal only for its owner", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }] });
      const id = await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "words", target_amount: 100 });

      await ctx.repo().deleteGoal(b, id);
      expect(await ctx.repo().goalForEdit(id)).not.toBeNull();
      await ctx.repo().deleteGoal(a, id);
      expect(await ctx.repo().goalForEdit(id)).toBeNull();
    });

    it("lists a project's archived goals and the member's starred ones with their project's title", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "p", member: 0, title: "Novel", createdAt: "2026-01-01T10:00:00Z" },
          { key: "q", member: 1, title: "Other", createdAt: "2026-01-01T10:00:00Z" },
        ],
      });
      const done = await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "words", target_amount: 100, title: "Done", archived_at: "2026-06-01T00:00:00Z" });
      const star = await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "pages", target_amount: 10, is_starred: true });
      await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "scenes", target_amount: 3 });
      await ctx.repo().createGoal({ member_id: b, project_id: ids.q, measure: "words", target_amount: 9, is_starred: true });

      const archived = await ctx.repo().archivedGoals(a, ids.p);
      expect(archived.map((g) => [g.id, g.title])).toEqual([[done, "Done"]]);
      expect(await ctx.repo().archivedGoals(b, ids.p)).toEqual([]);

      const starred = await ctx.repo().starredGoals(a);
      expect(starred.map((g) => [g.id, g.project_title, g.is_starred])).toEqual([[star, "Novel", true]]);
      await ctx.repo().updateGoal(a, star, { archived_at: "2026-06-02T00:00:00Z", is_starred: false });
      expect(await ctx.repo().starredGoals(a)).toEqual([]);
    });

    it("lists the goals in play on projects in play, for every member", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "p", member: 0, title: "Novel", createdAt: "2026-01-01T10:00:00Z" },
          { key: "gone", member: 1, title: "Shelved", archived: true, createdAt: "2026-01-01T10:00:00Z" },
          { key: "q", member: 1, title: "Memoir", createdAt: "2026-01-01T10:00:00Z" },
        ],
      });
      const mine = await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "words", target_amount: 1 });
      await ctx.repo().createGoal({ member_id: a, project_id: ids.p, measure: "pages", target_amount: 1, archived_at: "2026-06-01T00:00:00Z" });
      await ctx.repo().createGoal({ member_id: b, project_id: ids.gone, measure: "words", target_amount: 1 });
      await ctx.repo().createGoal({ member_id: a, measure: "words", target_amount: 1 });
      const theirs = await ctx.repo().createGoal({ member_id: b, project_id: ids.q, measure: "scenes", target_amount: 1 });

      const candidates = (await ctx.repo().activeGoalCandidates()).filter((c) => c.goal_id === mine || c.goal_id === theirs);
      expect(candidates.sort((x, y) => x.measure.localeCompare(y.measure))).toEqual([
        { goal_id: theirs, member_id: b, project_id: ids.q, project_title: "Memoir", measure: "scenes" },
        { goal_id: mine, member_id: a, project_id: ids.p, project_title: "Novel", measure: "words" },
      ]);
      expect((await ctx.repo().activeGoalCandidates()).every((c) => c.project_id !== ids.gone)).toBe(true);
    });

    describe("progress entries", () => {
    // --- progress entries ---
    const entry = (over: Partial<SeedEntry> = {}): SeedEntry => ({ member: 0, project: "p", entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 10, createdAt: "2026-02-01T10:00:00Z", ...over });
    const projects: SeedProject[] = [
      { key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" },
      { key: "q", member: 0, title: "Q", createdAt: "2026-01-02T10:00:00Z" },
      { key: "theirs", member: 1, title: "Theirs", createdAt: "2026-01-03T10:00:00Z" },
    ];
    const entryIdOf = async (memberId: string, projectId: string, measure = "words") => {
      const id = await ctx.repo().addEntry({ memberId, projectId, entryDate: "2026-03-01", measure, mode: "delta", amount: 1 });
      return id;
    };

    it("finds an entry's owner and place, or nothing", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({ projects });
      const id = await ctx.repo().addEntry({ memberId: a, projectId: ids.p, entryDate: "2026-03-01", measure: "words", mode: "delta", amount: 1, prickleId: ctx.prickleId });

      expect(await ctx.repo().findEntry(id)).toEqual({ id, project_id: ids.p, member_id: a, prickle_id: ctx.prickleId });
      expect(await ctx.repo().findEntry("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("changes only what the patch names, and only the member's own entry", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects });
      const id = await ctx.repo().addEntry({ memberId: a, projectId: ids.p, entryDate: "2026-03-01", measure: "words", mode: "delta", amount: 1, note: "keep", tags: ["x"] });

      await ctx.repo().updateEntry(b, id, { amount: 999 });
      expect((await ctx.repo().entriesForProjects(a, [ids.p]))[0].amount).toBe(1);

      await ctx.repo().updateEntry(a, id, { entryDate: "2026-03-02", measure: "pages", mode: "set_total", amount: 40, tags: [], prickleId: ctx.prickleId });
      expect(await ctx.repo().entriesForProjects(a, [ids.p])).toEqual([
        expect.objectContaining({ id, entry_date: "2026-03-02", measure: "pages", mode: "set_total", amount: 40, note: "keep", tags: [] }),
      ]);
      expect((await ctx.repo().findEntry(id))?.prickle_id).toBe(ctx.prickleId);

      await ctx.repo().updateEntry(a, id, { note: null, prickleId: null });
      expect((await ctx.repo().entriesForProjects(a, [ids.p]))[0].note).toBeNull();
      expect((await ctx.repo().findEntry(id))?.prickle_id).toBeNull();
    });

    it("deletes only the member's own entry", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects });
      const id = await entryIdOf(a, ids.p);

      await ctx.repo().deleteEntry(b, id);
      expect(await ctx.repo().findEntry(id)).not.toBeNull();
      await ctx.repo().deleteEntry(a, id);
      expect(await ctx.repo().findEntry(id)).toBeNull();
    });

    it("lists a prickle's entries with their project's title, in the order logged", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({
        projects,
        entries: [
          entry({ project: "q", amount: 2, createdAt: "2026-02-02T10:00:00Z", prickle: true, note: "n", tags: ["t"] }),
          entry({ project: "p", amount: 1, createdAt: "2026-02-01T10:00:00Z", prickle: true }),
          entry({ amount: 3, createdAt: "2026-02-03T10:00:00Z" }),
          entry({ member: 1, project: "theirs", amount: 4, prickle: true }),
        ],
      });

      const mine = await ctx.repo().prickleEntries(a, ctx.prickleId);
      expect(mine.map((e) => [e.project_title, e.amount, e.prickle_id])).toEqual([
        ["P", 1, ctx.prickleId],
        ["Q", 2, ctx.prickleId],
      ]);
      expect(mine[1]).toEqual(expect.objectContaining({ entry_date: "2026-02-01", measure: "words", mode: "delta", note: "n", tags: ["t"] }));
      expect((await ctx.repo().prickleEntries(b, ctx.prickleId)).map((e) => e.project_title)).toEqual(["Theirs"]);
    });

    it("names the prickles a member linked an entry to since a moment", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({
        projects,
        entries: [
          entry({ createdAt: "2026-02-01T10:00:00Z", prickle: true }),
          entry({ createdAt: "2026-02-03T10:00:00Z" }),
          entry({ member: 1, project: "theirs", createdAt: "2026-02-04T10:00:00Z", prickle: true }),
        ],
      });

      expect([...(await ctx.repo().prickleIdsLoggedSince(a, "2026-01-31T00:00:00Z"))]).toEqual([ctx.prickleId]);
      expect((await ctx.repo().prickleIdsLoggedSince(a, "2026-02-02T00:00:00Z")).size).toBe(0);
      expect([...(await ctx.repo().prickleIdsLoggedSince(b, "2026-02-02T00:00:00Z"))]).toEqual([ctx.prickleId]);
    });

    it("lists a member's entries in the given projects", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({
        projects,
        entries: [entry({ amount: 1, note: "a", tags: ["x"] }), entry({ project: "q", amount: 2 }), entry({ member: 1, project: "theirs", amount: 3 })],
      });

      expect((await ctx.repo().entriesForProjects(a, [ids.p, ids.q])).map((e) => e.amount).sort()).toEqual([1, 2]);
      expect(await ctx.repo().entriesForProjects(a, [ids.p])).toEqual([
        { id: expect.any(String), project_id: ids.p, entry_date: "2026-02-01", measure: "words", mode: "delta", amount: 1, note: "a", tags: ["x"], created_at: expect.any(String) },
      ]);
      expect(await ctx.repo().entriesForProjects(a, [ids.theirs])).toEqual([]);
      expect(await ctx.repo().entriesForProjects(a, [])).toEqual([]);
    });

    it("lists the dated amounts of one project and measure", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({
        projects,
        entries: [entry({ amount: 1 }), entry({ amount: 2, measure: "pages" }), entry({ project: "q", amount: 3 }), entry({ member: 1, project: "theirs", amount: 4 })],
      });

      const series = await ctx.repo().seriesEntries(a, ids.p, "words");
      expect(series).toEqual([{ entry_date: "2026-02-01", mode: "delta", amount: 1, created_at: expect.any(String) }]);
    });

    it("gives a project's latest measures newest first, repeats kept, up to the limit", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({
        projects,
        entries: [
          entry({ measure: "words", createdAt: "2026-02-01T10:00:00Z" }),
          entry({ measure: "pages", createdAt: "2026-02-02T10:00:00Z" }),
          entry({ measure: "words", createdAt: "2026-02-03T10:00:00Z" }),
          entry({ project: "q", measure: "scenes", createdAt: "2026-02-04T10:00:00Z" }),
        ],
      });

      expect(await ctx.repo().recentProjectMeasures(a, ids.p, 50)).toEqual(["words", "pages", "words"]);
      expect(await ctx.repo().recentProjectMeasures(a, ids.p, 2)).toEqual(["words", "pages"]);
    });

    it("tells which members logged in which project against which prickles", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects,
        entries: [entry({ prickle: true }), entry({ project: "q" }), entry({ member: 1, project: "theirs", prickle: true })],
      });

      const rows = await ctx.repo().loggedAgainstPrickles([a, b], [ctx.prickleId]);
      expect(rows.map((r) => `${r.member_id}|${r.prickle_id}|${r.project_id}`).sort()).toEqual([`${a}|${ctx.prickleId}|${ids.p}`, `${b}|${ctx.prickleId}|${ids.theirs}`].sort());
      expect(await ctx.repo().loggedAgainstPrickles([a], [ctx.prickleId])).toHaveLength(1);
    });
    });

    // --- projects and starting balances ---

    it("creates a project, lists it with its columns and finds it by id for its owner only", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({});

      const id = await ctx.repo().createProject(a, "Fresh Start", "planning");

      expect(await ctx.repo().projectSummaries(a)).toEqual([
        { id, title: "Fresh Start", phase: "planning", created_at: expect.any(String), show_on_profile: false, cover_url: null, description: null },
      ]);
      expect((await ctx.repo().projectSummary(a, id))?.title).toBe("Fresh Start");
      expect(await ctx.repo().projectSummary(b, id)).toBeNull();
      expect(await ctx.repo().projectSummaries(b)).toEqual([]);
    });

    it("lists active projects newest first and still finds an archived one by id", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "old", member: 0, title: "Old", createdAt: "2026-01-01T10:00:00Z" },
          { key: "new", member: 0, title: "New", createdAt: "2026-03-01T10:00:00Z" },
          { key: "gone", member: 0, title: "Shelved", archived: true, createdAt: "2026-05-01T10:00:00Z" },
        ],
      });

      expect((await ctx.repo().projectSummaries(a)).map((p) => p.title)).toEqual(["New", "Old"]);
      expect((await ctx.repo().projectSummary(a, ids.gone))?.title).toBe("Shelved");
    });

    it("changes only the given fields of the member's own project", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "p", member: 0, title: "Before", createdAt: "2026-01-01T10:00:00Z" }] });

      await ctx.repo().updateProject(a, ids.p, { title: "After", description: "About it", cover_url: "https://example.test/c.jpg", show_on_profile: true, phase: "revising" });
      await ctx.repo().updateProject(b, ids.p, { title: "Hijacked" });
      await ctx.repo().updateProject(a, ids.p, { description: null });

      expect(await ctx.repo().projectSummary(a, ids.p)).toMatchObject({
        title: "After",
        description: null,
        cover_url: "https://example.test/c.jpg",
        show_on_profile: true,
        phase: "revising",
      });
    });

    it("lists a member's entries, and one project's entries newest date first with the prickle's type and host", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" },
          { key: "q", member: 0, title: "Q", createdAt: "2026-01-02T10:00:00Z" },
          { key: "theirs", member: 1, title: "T", createdAt: "2026-01-03T10:00:00Z" },
        ],
        entries: [
          { member: 0, project: "p", entryDate: "2026-02-01", measure: "words", mode: "delta", amount: 10, createdAt: "2026-02-01T10:00:00Z" },
          { member: 0, project: "p", entryDate: "2026-02-03", measure: "pages", mode: "set_total", amount: 4, createdAt: "2026-02-03T10:00:00Z", prickle: true, note: "n", tags: ["x"] },
          { member: 0, project: "q", entryDate: "2026-02-02", measure: "words", mode: "delta", amount: 7, createdAt: "2026-02-02T10:00:00Z" },
          { member: 1, project: "theirs", entryDate: "2026-02-02", measure: "words", mode: "delta", amount: 99, createdAt: "2026-02-02T10:00:00Z" },
        ],
      });

      expect((await ctx.repo().projectEntries(a)).map((e) => e.amount).sort((x, y) => x - y)).toEqual([4, 7, 10]);
      expect((await ctx.repo().projectEntries(b)).map((e) => e.amount)).toEqual([99]);

      const detailed = await ctx.repo().projectEntriesWithPrickles(a, ids.p);
      expect(detailed.map((e) => e.entry_date)).toEqual(["2026-02-03", "2026-02-01"]);
      expect(detailed[0]).toMatchObject({
        project_id: ids.p,
        measure: "pages",
        mode: "set_total",
        amount: 4,
        note: "n",
        tags: ["x"],
        prickle_id: ctx.prickleId,
        prickle: { id: ctx.prickleId, host: { name: ctx.prickleHostName, display_name: null }, type: { name: ctx.prickleTypeName } },
      });
      expect(detailed[1]).toMatchObject({ prickle_id: null, prickle: null });
      expect(await ctx.repo().projectEntriesWithPrickles(b, ids.p)).toEqual([]);
    });

    it("lists the goals in play, optionally one project's", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" },
          { key: "q", member: 0, title: "Q", createdAt: "2026-01-02T10:00:00Z" },
        ],
        goals: [
          { member: 0, project: "p", measure: "words" },
          { member: 0, project: "q", measure: "pages" },
          { member: 0, project: "p", measure: "scenes", archived: true },
          { member: 1, measure: "words" },
        ],
      });

      expect((await ctx.repo().projectGoals(a)).map((g) => g.measure).sort()).toEqual(["pages", "words"]);
      const ofP = await ctx.repo().projectGoals(a, ids.p);
      expect(ofP).toEqual([
        expect.objectContaining({ project_id: ids.p, measure: "words", goal_type: "target", is_starred: false, show_on_profile: false, title: null, description: null }),
      ]);
      expect((await ctx.repo().projectGoals(b)).map((g) => g.project_id)).toEqual([null]);
    });

    it("sets, changes and clears starting balances", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" },
          { key: "q", member: 0, title: "Q", createdAt: "2026-01-02T10:00:00Z" },
        ],
      });
      expect(await ctx.repo().startingBalance(a, ids.p, "words")).toBeNull();

      await ctx.repo().replaceStartingBalances(a, ids.p, [{ measure: "words", amount: 5000 }, { measure: "pages", amount: 12 }], ["scenes"]);
      await ctx.repo().replaceStartingBalances(a, ids.q, [{ measure: "words", amount: 1 }], []);
      expect(await ctx.repo().startingBalances(a, ids.p)).toEqual([
        { project_id: ids.p, measure: "pages", amount: 12 },
        { project_id: ids.p, measure: "words", amount: 5000 },
      ]);
      expect(await ctx.repo().startingBalances(a)).toHaveLength(3);
      expect(await ctx.repo().startingBalances(b)).toEqual([]);
      expect(await ctx.repo().startingBalance(a, ids.p, "words")).toBe(5000);

      await ctx.repo().replaceStartingBalances(a, ids.p, [{ measure: "words", amount: 6000 }], ["pages"]);
      expect(await ctx.repo().startingBalances(a, ids.p)).toEqual([{ project_id: ids.p, measure: "words", amount: 6000 }]);
      expect(await ctx.repo().startingBalance(a, ids.p, "pages")).toBeNull();
      expect(await ctx.repo().startingBalances(a, ids.q)).toHaveLength(1);
    });

    it("keeps a deleted goal and entry out of every read", async () => {
      const [a] = ctx.memberIds;
      const ids = await ctx.seed({ projects: [{ key: "p", member: 0, title: "P", createdAt: "2026-01-01T10:00:00Z" }] });
      const repo = ctx.repo();
      const keepEntry = await repo.addEntry({ memberId: a, projectId: ids.p, entryDate: "2026-03-01", measure: "words", mode: "delta", amount: 5, prickleId: ctx.prickleId });
      const gone = await repo.addEntry({ memberId: a, projectId: ids.p, entryDate: "2026-03-02", measure: "pages", mode: "delta", amount: 9, prickleId: ctx.prickleId });
      const keepGoal = await repo.createGoal({ member_id: a, project_id: ids.p, measure: "words", target_amount: 100, is_starred: true });
      const goneGoal = await repo.createGoal({ member_id: a, project_id: ids.p, measure: "pages", target_amount: 7, is_starred: true });

      await repo.deleteEntry(a, gone);
      await repo.deleteGoal(a, goneGoal);

      expect(await repo.findEntry(gone)).toBeNull();
      expect(await repo.goalForEdit(goneGoal)).toBeNull();
      expect(await repo.goalCount(a)).toBe(1);
      expect(await repo.activeGoalMeasures(a)).toEqual([{ project_id: ids.p, measure: "words" }]);
      expect((await repo.starredGoals(a)).map((g) => g.id)).toEqual([keepGoal]);
      expect((await repo.projectGoals(a)).map((g) => g.id)).toEqual([keepGoal]);
      expect((await repo.projectGoals(a, ids.p)).map((g) => g.id)).toEqual([keepGoal]);
      expect((await repo.activeGoalCandidates()).map((g) => g.goal_id)).not.toContain(goneGoal);

      expect(await repo.recentEntryMeasures(a, 10)).toEqual([{ project_id: ids.p, measure: "words" }]);
      expect(await repo.recentProjectMeasures(a, ids.p, 10)).toEqual(["words"]);
      expect(await repo.entriesForPrickle(a, ctx.prickleId)).toEqual([{ project_id: ids.p, measure: "words", mode: "delta", amount: 5 }]);
      expect((await repo.prickleEntries(a, ctx.prickleId)).map((e) => e.id)).toEqual([keepEntry]);
      expect((await repo.exportEntries(a)).map((e) => e.measure)).toEqual(["words"]);
      expect((await repo.entriesForProjects(a, [ids.p])).map((e) => e.id)).toEqual([keepEntry]);
      expect((await repo.projectEntries(a)).map((e) => e.id)).toEqual([keepEntry]);
      expect((await repo.projectEntriesWithPrickles(a, ids.p)).map((e) => e.id)).toEqual([keepEntry]);
      expect(await repo.seriesEntries(a, ids.p, "pages")).toEqual([]);
      expect(await repo.loggedAgainstPrickles([a], [ctx.prickleId])).toEqual([{ member_id: a, prickle_id: ctx.prickleId, project_id: ids.p }]);

      // Edits and a second delete leave a deleted row alone.
      await repo.updateEntry(a, gone, { amount: 999 });
      await repo.updateGoal(a, goneGoal, { target_amount: 999 });
      expect(await repo.seriesEntries(a, ids.p, "pages")).toEqual([]);
      expect(await repo.goalForEdit(goneGoal)).toBeNull();
    });

    it("does not bring back a deleted imported entry or goal when the import runs again", async () => {
      const [a] = ctx.memberIds;
      await ctx.seed({});
      const repo = ctx.repo();
      const tag = (s: string) => `trackbear:${s}-${a}`;
      const [project] = await repo.importProjects([{ member_id: a, external_id: tag("p"), title: "Imported", phase: "drafting", created_at: "2025-01-01T10:00:00Z" }]);
      const row = { member_id: a, project_id: project.id, external_id: tag("e"), entry_date: "2025-02-01", measure: "words", mode: "delta", amount: 5, note: null, tags: [], created_at: "2025-02-01T10:00:00Z" };
      await repo.importEntries([row]);
      await repo.importGoals([{ member_id: a, project_id: project.id, external_id: tag("g"), goal_type: "target", measure: "words", target_amount: 10, created_at: "2025-02-01T10:00:00Z" }]);

      const [entry] = await repo.entriesForProjects(a, [project.id]);
      await repo.deleteEntry(a, entry.id);
      const goalId = (await repo.projectGoals(a, project.id))[0].id;
      await repo.deleteGoal(a, goalId);

      expect(await repo.importEntries([row])).toBe(0);
      expect(await repo.entriesForProjects(a, [project.id])).toEqual([]);
      expect(await repo.importedEntryExternalIds(a)).toEqual([tag("e")]);
      expect((await repo.importedGoals(a)).map((g) => g.external_id)).toEqual([tag("g")]);
    });

    it("imports projects, balances, entries and goals once, skipping what is already there", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.seed({});
      const repo = ctx.repo();
      const tag = (s: string) => `trackbear:${s}-${a}`;

      const project = (externalId: string, member = a) => ({ member_id: member, external_id: externalId, title: `Imported ${externalId}`, phase: "drafting", created_at: "2025-01-01T10:00:00Z" });
      const first = await repo.importProjects([project(tag("p1")), project(tag("p2"))]);
      expect(first.map((p) => p.external_id).sort()).toEqual([tag("p1"), tag("p2")]);
      const again = await repo.importProjects([project(tag("p1")), project(tag("p3"))]);
      expect(again.map((p) => p.external_id)).toEqual([tag("p3")]);
      await repo.importProjects([project(tag("p1"), b)]);
      await repo.createProject(a, "Native", "drafting");

      const imported = await repo.importedProjects(a);
      expect(imported.map((p) => p.external_id).sort()).toEqual([tag("p1"), tag("p2"), tag("p3")]);
      expect(await repo.importedProjects(b)).toHaveLength(1);
      const p1 = imported.find((p) => p.external_id === tag("p1"))!.id;

      await repo.importStartingBalances([{ project_id: p1, member_id: a, measure: "words", amount: 100 }]);
      expect(await repo.startingBalances(a, p1)).toEqual([{ project_id: p1, measure: "words", amount: 100 }]);
      await expect(repo.importStartingBalances([{ project_id: p1, member_id: a, measure: "words", amount: 1 }])).rejects.toThrow();

      const entry = (externalId: string) => ({ member_id: a, project_id: p1, external_id: externalId, entry_date: "2025-02-01", measure: "words", mode: "delta", amount: 5, note: null, tags: ["t"], created_at: "2025-02-01T10:00:00Z" });
      expect(await repo.importEntries([entry(tag("e1")), entry(tag("e2"))])).toBe(2);
      expect(await repo.importEntries([entry(tag("e1")), entry(tag("e3"))])).toBe(1);
      expect((await repo.importedEntryExternalIds(a)).sort()).toEqual([tag("e1"), tag("e2"), tag("e3")]);
      expect(await repo.importedEntryExternalIds(b)).toEqual([]);

      const goal = (externalId: string) => ({ member_id: a, project_id: p1, external_id: externalId, goal_type: "target", measure: "words", target_amount: 1000, created_at: "2025-02-01T10:00:00Z" });
      expect(await repo.importGoals([goal(tag("g1")), goal(tag("g2"))])).toBe(2);
      expect(await repo.importGoals([goal(tag("g1"))])).toBe(0);
      expect((await repo.importedGoals(a)).map((g) => ({ ...g })).sort((x, y) => (x.external_id < y.external_id ? -1 : 1))).toEqual([
        { external_id: tag("g1"), title: null, description: null },
        { external_id: tag("g2"), title: null, description: null },
      ]);

      expect(await repo.backfillGoalDetails(a, tag("g1"), { title: "Named", description: null, show_on_profile: true })).toBe(1);
      expect(await repo.backfillGoalDetails(a, tag("g1"), { title: "Renamed", description: null, show_on_profile: true })).toBe(0);
      expect(await repo.backfillGoalDetails(a, tag("nope"), { title: "X", description: null, show_on_profile: true })).toBe(0);
      expect((await repo.importedGoals(a)).find((g) => g.external_id === tag("g1"))?.title).toBe("Named");
    });

    it("lists the projects whose cover is a link rather than a library image, and has no library cover for them", async () => {
      const [a, b] = ctx.memberIds;
      const ids = await ctx.seed({
        projects: [
          { key: "linked", member: 0, title: "Linked", createdAt: "2026-01-01T10:00:00Z" },
          { key: "bare", member: 0, title: "Bare", createdAt: "2026-01-02T10:00:00Z" },
          { key: "other", member: 1, title: "Other", createdAt: "2026-01-03T10:00:00Z" },
        ],
      });
      await ctx.repo().updateProject(a, ids.linked, { cover_url: "https://example.test/cover.jpg" });
      await ctx.repo().updateProject(b, ids.other, { cover_url: "https://example.test/other.jpg" });
      const ours = new Set([ids.linked, ids.bare, ids.other]);

      const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : 1); // the order of ids is the database's own; compare as a set
      const legacy = (await ctx.repo().projectsWithLegacyCovers()).filter((p) => ours.has(p.id));
      expect(legacy.map((p) => ({ id: p.id, member_id: p.member_id, title: p.title, cover_url: p.cover_url })).sort(byId)).toEqual(
        [
          { id: ids.linked, member_id: a, title: "Linked", cover_url: "https://example.test/cover.jpg" },
          { id: ids.other, member_id: b, title: "Other", cover_url: "https://example.test/other.jpg" },
        ].sort(byId)
      );
      expect(await ctx.repo().coverAssetOf(a, ids.linked)).toBeNull();
      expect(await ctx.repo().coverAssetOf(b, ids.linked)).toBeNull(); // not theirs

      await ctx.repo().updateProject(a, ids.linked, { cover_url: null });
      expect((await ctx.repo().projectsWithLegacyCovers()).some((p) => p.id === ids.linked)).toBe(false);
    });
  });
}
