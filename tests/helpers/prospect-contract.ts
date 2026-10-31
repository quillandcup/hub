import { describe, it, expect, beforeEach } from "vitest";
import { prospectKey, type NewProspect, type ProspectRepository } from "@/lib/data/prospects";

export type ProspectContractContext = {
  repo: () => ProspectRepository;
  /** Handles this suite may create; `reset` removes them. */
  handles: readonly [string, string, string];
  reset: () => Promise<void>;
};

/** Behavior every `ProspectRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineProspectContract(name: string, setup: () => ProspectContractContext) {
  describe(`${name} (ProspectRepository contract)`, () => {
    let ctx: ProspectContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
    });

    const prospect = (handle: string, fitScore: number): NewProspect => ({
      platform: "instagram",
      handle,
      source: "paste",
      bio: "writing my first novel",
      followerCount: 1200,
      hashtags: ["amwriting"],
      externalUrl: null,
      fitScore,
      fitReasons: ["Says they are working on a book or draft (+30)"],
    });
    const mine = async (status?: "new" | "shortlisted" | "rejected" | "contacted") =>
      (await ctx.repo().list(status ? { status } : {})).filter((p) => ctx.handles.includes(p.handle));

    it("adds new handles and leaves existing ones untouched", async () => {
      const [a, b] = ctx.handles;
      expect(await ctx.repo().addMany([prospect(a, 50)], null)).toEqual({ added: [prospectKey("instagram", a)], existing: [] });
      const [row] = await mine();
      await ctx.repo().review(row.id, "rejected", null, "not a fit");

      const again = await ctx.repo().addMany([prospect(a, 90), prospect(b, 10)], null);

      expect(again).toEqual({ added: [prospectKey("instagram", b)], existing: [prospectKey("instagram", a)] });
      const kept = (await mine()).find((p) => p.handle === a)!;
      expect(kept).toMatchObject({ fitScore: 50, status: "rejected", rejectReason: "not a fit" });
      expect(await ctx.repo().addMany([], null)).toEqual({ added: [], existing: [] });
    });

    it("treats the same handle on another platform as another prospect", async () => {
      const [a] = ctx.handles;
      await ctx.repo().addMany([prospect(a, 50)], null);

      const result = await ctx.repo().addMany([{ ...prospect(a, 50), platform: "bluesky", handle: `${a}.bsky.social` }, { ...prospect(a, 50), platform: "bluesky" }], null);

      expect(result.existing).toEqual([]);
      expect(result.added).toHaveLength(2);
      expect((await ctx.repo().list()).filter((p) => p.handle === a).map((p) => p.platform).sort()).toEqual(["bluesky", "instagram"]);
    });

    it("lists best fit first and filters by status", async () => {
      const [a, b, c] = ctx.handles;
      await ctx.repo().addMany([prospect(a, 20), prospect(b, 80), prospect(c, 50)], null);
      const rows = await mine();
      await ctx.repo().review(rows.find((p) => p.handle === c)!.id, "shortlisted", null);

      expect((await mine()).map((p) => p.handle)).toEqual([b, c, a]);
      expect((await mine("shortlisted")).map((p) => p.handle)).toEqual([c]);
    });

    it("keeps the reject reason only for a rejection", async () => {
      const [a] = ctx.handles;
      await ctx.repo().addMany([prospect(a, 50)], null);
      const id = (await mine())[0].id;

      await ctx.repo().review(id, "rejected", null, "sells editing");
      expect((await mine())[0]).toMatchObject({ status: "rejected", rejectReason: "sells editing" });
      expect((await mine())[0].reviewedAt).not.toBeNull();

      await ctx.repo().review(id, "shortlisted", null, "ignored");
      expect((await mine())[0]).toMatchObject({ status: "shortlisted", rejectReason: null });
    });

    it("re-scores prospects", async () => {
      const [a] = ctx.handles;
      await ctx.repo().addMany([prospect(a, 50)], null);
      const id = (await mine())[0].id;

      await ctx.repo().rescore([{ id, fitScore: 5, fitReasons: ["rules changed"] }]);

      expect((await mine())[0]).toMatchObject({ fitScore: 5, fitReasons: ["rules changed"] });
      await ctx.repo().rescore([]);
    });

    it("hands out open prospects without an assessment, and stops once one is saved", async () => {
      const [a, b, c] = ctx.handles;
      await ctx.repo().addMany([prospect(a, 30), prospect(b, 70), prospect(c, 90)], null);
      const rows = await mine();
      await ctx.repo().review(rows.find((p) => p.handle === c)!.id, "rejected", null);

      const waiting = (await ctx.repo().awaitingAssessment(500)).filter((p) => ctx.handles.includes(p.handle));
      expect(waiting.map((p) => p.handle)).toEqual([b, a]);
      expect(await ctx.repo().awaitingAssessment(0)).toEqual([]);

      const assessment = { fit: "strong" as const, summary: "Drafting a fantasy novel.", opener: null };
      await ctx.repo().saveAssessment(waiting[0].id, assessment, new Date("2097-01-01T00:00:00Z"));

      const after = (await ctx.repo().awaitingAssessment(500)).filter((p) => ctx.handles.includes(p.handle));
      expect(after.map((p) => p.handle)).toEqual([a]);
      expect((await mine()).find((p) => p.handle === b)!.assessment).toEqual(assessment);
    });
  });
}
