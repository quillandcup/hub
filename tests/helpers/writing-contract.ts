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
    });
  });
}
