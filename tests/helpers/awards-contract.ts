import { describe, it, expect, beforeEach } from "vitest";
import type { AwardRepository } from "@/lib/data/awards";

export type AwardsContractContext = {
  repo: () => AwardRepository;
  /** Two members: "Ada Example" and "Bo Example". */
  members: readonly { id: string }[];
  /** An id nothing has. */
  missingId: string;
  /** A member id nothing has. */
  missingMemberId: string;
  /** Removes everything stored for the two members. */
  clear: () => Promise<void>;
};

/** Behavior every `AwardRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineAwardsContract(name: string, setup: () => AwardsContractContext) {
  describe(`${name} (AwardRepository contract)`, () => {
    let ctx: AwardsContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo] = [0, 1];
    const id = (i: number) => ctx.members[i].id;
    const award = (i: number, fields: { award_name: string; work_title: string; award_date: string; category?: string }) => ({ member_id: id(i), ...fields });

    it("records awards and lists a member's own, latest first, with the optional columns empty", async () => {
      const repo = ctx.repo();
      await repo.add(award(ada, { award_name: "Golden Quill", work_title: "First Book", award_date: "2026-01-10" }));
      await repo.add({ ...award(ada, { award_name: "Silver Pen", work_title: "Second Book", award_date: "2026-05-20", category: "Fiction" }), url: "https://example.com/w", notes: "Shortlist" });
      await repo.add(award(bo, { award_name: "Bo's Prize", work_title: "Other", award_date: "2026-03-01" }));

      const mine = await repo.ofMember(id(ada));
      expect(mine.map((a) => a.award_name)).toEqual(["Silver Pen", "Golden Quill"]);
      expect(mine[0]).toMatchObject({ category: "Fiction", work_title: "Second Book", award_date: "2026-05-20", url: "https://example.com/w", notes: "Shortlist", book_id: null, project_id: null });
      expect(mine[1]).toMatchObject({ category: null, url: null, notes: null });
      expect(mine[0].id).toEqual(expect.any(String));
      expect(await repo.ofMember(ctx.missingMemberId)).toEqual([]);
    });

    it("refuses an award for a member that does not exist", async () => {
      await expect(ctx.repo().add({ member_id: ctx.missingMemberId, award_name: "x", work_title: "y", award_date: "2026-01-01" })).rejects.toThrow();
    });

    it("replaces an award's fields and says when there is no such live award", async () => {
      const repo = ctx.repo();
      await repo.add(award(ada, { award_name: "Golden Quill", work_title: "First Book", award_date: "2026-01-10", category: "Poetry" }));
      const [row] = await repo.ofMember(id(ada));

      expect(await repo.update(row.id, { award_name: "Platinum Quill", work_title: "First Book", award_date: "2026-02-02", category: null, notes: "Won" })).toBe(true);
      expect((await repo.ofMember(id(ada)))[0]).toMatchObject({ id: row.id, award_name: "Platinum Quill", award_date: "2026-02-02", category: null, notes: "Won" });
      expect(await repo.update(ctx.missingId, { award_name: "x", work_title: "y", award_date: "2026-01-01" })).toBe(false);
    });

    it("soft-deletes an award once, and then it can no longer be changed or deleted", async () => {
      const repo = ctx.repo();
      await repo.add(award(ada, { award_name: "Golden Quill", work_title: "First Book", award_date: "2026-01-10" }));
      const [row] = await repo.ofMember(id(ada));

      expect(await repo.remove(row.id)).toBe(true);
      expect(await repo.ofMember(id(ada))).toEqual([]);
      expect(await repo.remove(row.id)).toBe(false);
      expect(await repo.update(row.id, { award_name: "x", work_title: "y", award_date: "2026-01-01" })).toBe(false);
      expect(await repo.remove(ctx.missingId)).toBe(false);
    });

    describe("search", () => {
      const search = (q: Partial<Parameters<AwardRepository["search"]>[0]> = {}) =>
        ctx.repo().search({ words: [], limit: 10, offset: 0, ...q });

      beforeEach(async () => {
        const repo = ctx.repo();
        await repo.add(award(ada, { award_name: "Golden Quill", work_title: "Moonlit Road", award_date: "2026-01-10", category: "Poetry" }));
        await repo.add(award(ada, { award_name: "Silver Pen", work_title: "Sun Harvest", award_date: "2026-05-20", category: "Fiction" }));
        await repo.add(award(bo, { award_name: "Golden Pen", work_title: "Moonlit Sea", award_date: "2026-03-01", category: "Fiction" }));
        await repo.add(award(bo, { award_name: "Golden Hidden", work_title: "Moonlit Gone", award_date: "2026-04-01" }));
        const gone = (await repo.ofMember(id(bo))).find((a) => a.award_name === "Golden Hidden")!;
        await repo.remove(gone.id);
      });

      const namesOf = async (q: Parameters<typeof search>[0]) => (await search({ memberIds: [id(ada), id(bo)], ...q })).map((a) => a.award_name);

      it("matches every word in the name, category or work title, ignoring case and deleted awards", async () => {
        expect(await namesOf({ words: ["golden"] })).toEqual(["Golden Pen", "Golden Quill"]);
        expect(await namesOf({ words: ["golden", "MOONLIT", "fiction"] })).toEqual(["Golden Pen"]);
        expect(await namesOf({ words: ["poetry"] })).toEqual(["Golden Quill"]);
        expect(await namesOf({ words: ["nothing like it"] })).toEqual([]);
        expect(await namesOf({ words: ["Gone"] })).toEqual([]);
        // Characters meaningful to the filter syntax do not break it.
        expect(await namesOf({ words: ['gol,den)("'] })).toEqual([]);
      });

      it("limits to members, dates and a page, latest award date first", async () => {
        expect(await namesOf({ words: [], memberIds: [id(bo)] })).toEqual(["Golden Pen"]);
        expect(await search({ words: [], memberIds: [] })).toEqual([]);
        expect(await namesOf({ words: [], after: "2026-03-01T12:00:00Z" })).toEqual(["Silver Pen", "Golden Pen"]);
        expect(await namesOf({ words: [], before: "2026-03-01" })).toEqual(["Golden Quill"]);
        expect(await namesOf({ words: [], after: "2026-02-01", before: "2026-05-01" })).toEqual(["Golden Pen"]);

        const page = (await search({ words: [], memberIds: [id(ada), id(bo)], limit: 1, offset: 1 })).map((a) => a.award_name);
        expect(page).toEqual(["Golden Pen"]);
        const hit = (await search({ words: ["silver"], memberIds: [id(ada)] }))[0];
        expect(hit).toEqual({ id: expect.any(String), award_name: "Silver Pen", category: "Fiction", work_title: "Sun Harvest", award_date: "2026-05-20" });
      });
    });
  });
}
