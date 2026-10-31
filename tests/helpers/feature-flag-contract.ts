import { describe, it, expect, beforeEach } from "vitest";
import { missingSegmentId, type SegmentContractContext } from "@/tests/helpers/segment-contract";

/** Behavior every `FeatureFlagRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineFeatureFlagContract(name: string, setup: () => SegmentContractContext) {
  describe(`${name} (FeatureFlagRepository contract)`, () => {
    let ctx: SegmentContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("keeps a flag off until it is switched on for everyone, and reports it either way", async () => {
      const key = ctx.unique("flag");

      expect(await ctx.flags().isGloballyEnabled(key)).toBe(false); // no registry row
      expect((await ctx.flags().all()).some((f) => f.featureKey === key)).toBe(false);

      await ctx.flags().setGlobal(key, true);
      expect(await ctx.flags().isGloballyEnabled(key)).toBe(true);
      expect(await ctx.flags().globallyEnabledKeys()).toContain(key);
      expect((await ctx.flags().all()).find((f) => f.featureKey === key)).toEqual({ featureKey: key, enabledGlobally: true });

      await ctx.flags().setGlobal(key, false);
      expect(await ctx.flags().isGloballyEnabled(key)).toBe(false);
      expect(await ctx.flags().globallyEnabledKeys()).not.toContain(key);
      expect((await ctx.flags().all()).find((f) => f.featureKey === key)).toEqual({ featureKey: key, enabledGlobally: false });
    });

    it("links a flag to a segment (creating the flag off), once, and unlinks it", async () => {
      const key = ctx.unique("linked");
      const other = ctx.unique("other");
      const segment = await ctx.segments().create(ctx.unique("Segment"), null);

      await ctx.flags().linkSegment(key, segment.id);
      await ctx.flags().linkSegment(key, segment.id); // again: still one link
      await ctx.flags().linkSegment(other, segment.id);

      expect(await ctx.flags().isGloballyEnabled(key)).toBe(false);
      expect((await ctx.flags().all()).some((f) => f.featureKey === key)).toBe(true);
      expect(await ctx.flags().segmentLinks(key)).toEqual([{ featureKey: key, segmentId: segment.id }]);
      expect((await ctx.flags().segmentLinks()).filter((l) => l.segmentId === segment.id).map((l) => l.featureKey).sort()).toEqual([key, other].sort());

      await ctx.flags().unlinkSegment(key, segment.id);
      await ctx.flags().unlinkSegment(key, segment.id); // already unlinked: nothing happens
      expect(await ctx.flags().segmentLinks(key)).toEqual([]);
      expect(await ctx.flags().segmentLinks(other)).toHaveLength(1);
    });

    it("keeps an existing global switch when a segment is linked", async () => {
      const key = ctx.unique("on");
      const segment = await ctx.segments().create(ctx.unique("Segment"), null);
      await ctx.flags().setGlobal(key, true);

      await ctx.flags().linkSegment(key, segment.id);

      expect(await ctx.flags().isGloballyEnabled(key)).toBe(true);
    });

    it("refuses to link a segment that does not exist", async () => {
      await expect(ctx.flags().linkSegment(ctx.unique("ghost"), missingSegmentId())).rejects.toThrow();
    });

    it("drops a flag's links when its segment is deleted", async () => {
      const key = ctx.unique("cascade");
      const segment = await ctx.segments().create(ctx.unique("Segment"), null);
      await ctx.flags().linkSegment(key, segment.id);

      await ctx.segments().remove(segment.id);

      expect(await ctx.flags().segmentLinks(key)).toEqual([]);
    });

    it("lets a user turn a feature on and off for themselves", async () => {
      const { userId } = await ctx.seed(0);
      const key = ctx.unique("preview");

      await ctx.flags().setPreview(userId, key, true);
      await ctx.flags().setPreview(userId, key, true); // again: still one
      expect(await ctx.flags().previewKeys(userId)).toEqual([key]);
      expect((await ctx.flags().allPreviews()).filter((p) => p.userId === userId)).toEqual([{ userId, featureKey: key }]);

      await ctx.flags().setPreview(userId, key, false);
      expect(await ctx.flags().previewKeys(userId)).toEqual([]);
    });

    it("replaces all of a user's previews at once", async () => {
      const { userId } = await ctx.seed(0);
      const [a, b, c] = [ctx.unique("a"), ctx.unique("b"), ctx.unique("c")];
      await ctx.flags().replacePreviews(userId, [a, b]);
      expect((await ctx.flags().previewKeys(userId)).sort()).toEqual([a, b].sort());

      await ctx.flags().replacePreviews(userId, [c]);
      expect(await ctx.flags().previewKeys(userId)).toEqual([c]);

      await ctx.flags().replacePreviews(userId, []);
      expect(await ctx.flags().previewKeys(userId)).toEqual([]);
    });

    it("says which of some users turned a feature on, past one id chunk", async () => {
      const { userId } = await ctx.seed(0);
      const other = await ctx.seed(0);
      const key = ctx.unique("who");
      await ctx.flags().setPreview(userId, key, true);
      await ctx.flags().setPreview(other.userId, ctx.unique("different"), true);
      const strangers = Array.from({ length: 450 }, () => crypto.randomUUID());

      const found = await ctx.flags().userIdsWithPreview(key, [...strangers, userId, other.userId]);

      expect(found).toEqual([userId]);
      expect(await ctx.flags().userIdsWithPreview(key, [])).toEqual([]);
    });
  });
}
