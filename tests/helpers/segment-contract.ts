import { describe, it, expect, beforeEach } from "vitest";
import type { FeatureFlagRepository } from "@/lib/data/feature-flags";
import type { SegmentRepository } from "@/lib/data/segments";

export type SegmentContractContext = {
  segments: () => SegmentRepository;
  flags: () => FeatureFlagRepository;
  /** A name or key no other test or run uses. */
  unique: (label: string) => string;
  /** Makes `count` members and one signed-in user (what `segments.created_by` and previews point at). */
  seed: (count: number) => Promise<{ memberIds: string[]; userId: string }>;
};

/** An id that looks like a segment id and belongs to none. */
export const missingSegmentId = () => crypto.randomUUID();

/** Behavior every `SegmentRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineSegmentContract(name: string, setup: () => SegmentContractContext) {
  describe(`${name} (SegmentRepository contract)`, () => {
    let ctx: SegmentContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("creates a segment and reads it back, with who made it", async () => {
      const { userId } = await ctx.seed(0);
      const title = ctx.unique("Segment");

      const made = await ctx.segments().create(title, userId);
      const anonymous = await ctx.segments().create(ctx.unique("Segment"), null);

      expect(made).toMatchObject({ name: title, created_by: userId });
      expect(await ctx.segments().byId(made.id)).toEqual(made);
      expect(anonymous.created_by).toBeNull();
      expect(await ctx.segments().byId(missingSegmentId())).toBeNull();
    });

    it("lists segments with their member counts", async () => {
      const { memberIds } = await ctx.seed(3);
      const full = await ctx.segments().create(ctx.unique("Full"), null);
      const empty = await ctx.segments().create(ctx.unique("Empty"), null);
      await ctx.segments().addMembers(full.id, memberIds);

      const listed = await ctx.segments().list();

      expect(listed.find((s) => s.id === full.id)).toMatchObject({ name: full.name, memberCount: 3 });
      expect(listed.find((s) => s.id === empty.id)).toMatchObject({ memberCount: 0 });
    });

    it("lists a segment's members and takes them out one at a time", async () => {
      const { memberIds } = await ctx.seed(3);
      const segment = await ctx.segments().create(ctx.unique("Members"), null);
      await ctx.segments().addMembers(segment.id, memberIds);

      expect((await ctx.segments().memberIds(segment.id)).sort()).toEqual([...memberIds].sort());

      await ctx.segments().removeMember(segment.id, memberIds[0]);
      await ctx.segments().removeMember(segment.id, memberIds[0]); // already out: nothing happens
      expect((await ctx.segments().memberIds(segment.id)).sort()).toEqual([memberIds[1], memberIds[2]].sort());
      expect(await ctx.segments().memberIds(missingSegmentId())).toEqual([]);
    });

    it("refuses to add a member who is already in the segment, and adds nobody for an empty list", async () => {
      const { memberIds } = await ctx.seed(2);
      const segment = await ctx.segments().create(ctx.unique("Twice"), null);
      await ctx.segments().addMembers(segment.id, [memberIds[0]]);

      await expect(ctx.segments().addMembers(segment.id, [memberIds[0]])).rejects.toThrow();
      await ctx.segments().addMembers(segment.id, []);

      expect(await ctx.segments().memberIds(segment.id)).toEqual([memberIds[0]]);
    });

    it("finds the segments a member is in", async () => {
      const { memberIds } = await ctx.seed(2);
      const a = await ctx.segments().create(ctx.unique("A"), null);
      const b = await ctx.segments().create(ctx.unique("B"), null);
      await ctx.segments().addMembers(a.id, memberIds);
      await ctx.segments().addMembers(b.id, [memberIds[0]]);

      expect((await ctx.segments().segmentIdsForMember(memberIds[0])).sort()).toEqual([a.id, b.id].sort());
      expect(await ctx.segments().segmentIdsForMember(memberIds[1])).toEqual([a.id]);
    });

    it("says which of some members are in any of some segments, and nobody when there are no segments", async () => {
      const { memberIds } = await ctx.seed(3);
      const a = await ctx.segments().create(ctx.unique("A"), null);
      const b = await ctx.segments().create(ctx.unique("B"), null);
      await ctx.segments().addMembers(a.id, [memberIds[0]]);
      await ctx.segments().addMembers(b.id, [memberIds[0], memberIds[1]]);

      const found = await ctx.segments().memberIdsInSegments([a.id, b.id], memberIds);

      expect([...found].sort()).toEqual([memberIds[0], memberIds[1]].sort());
      expect(await ctx.segments().memberIdsInSegments([a.id], [memberIds[1], memberIds[2]])).toEqual([]);
      expect(await ctx.segments().memberIdsInSegments([], memberIds)).toEqual([]);
    });

    it("deletes a segment together with its members", async () => {
      const { memberIds } = await ctx.seed(2);
      const segment = await ctx.segments().create(ctx.unique("Gone"), null);
      await ctx.segments().addMembers(segment.id, memberIds);

      await ctx.segments().remove(segment.id);

      expect(await ctx.segments().byId(segment.id)).toBeNull();
      expect(await ctx.segments().memberIds(segment.id)).toEqual([]);
      expect(await ctx.segments().segmentIdsForMember(memberIds[0])).toEqual([]);
    });

    it("pages past 1000 members: counts, lists and looks up all of them", async () => {
      const total = 1005;
      const { memberIds } = await ctx.seed(total);
      const segment = await ctx.segments().create(ctx.unique("Big"), null);
      await ctx.segments().addMembers(segment.id, memberIds); // several insert chunks

      expect((await ctx.segments().list()).find((s) => s.id === segment.id)?.memberCount).toBe(total);
      expect(await ctx.segments().memberIds(segment.id)).toHaveLength(total);
      expect(await ctx.segments().memberIdsInSegments([segment.id], memberIds)).toHaveLength(total); // several id chunks
    });
  });
}
