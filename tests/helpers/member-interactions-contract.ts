import { describe, it, expect, beforeEach } from "vitest";
import type { MemberInteractionRepository } from "@/lib/data/member-interactions";

export type MemberInteractionContractContext = {
  repo: () => MemberInteractionRepository;
  /** Four members; interactions are written between them. */
  memberIds: readonly [string, string, string, string];
  /** Writes one interaction (the service role does, in the database). */
  add: (rows: { a: number; b: number; at: string; kind?: string }[]) => Promise<void>;
  /** Removes every interaction of the four members. */
  clear: () => Promise<void>;
};

/** Behavior every `MemberInteractionRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMemberInteractionContract(name: string, setup: () => MemberInteractionContractContext) {
  describe(`${name} (MemberInteractionRepository contract)`, () => {
    let ctx: MemberInteractionContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("lists the distinct members someone interacted with, in either direction, from the start up to, not including, the end", async () => {
      const [ada, bo, cy, dee] = ctx.memberIds;
      await ctx.add([
        { a: 0, b: 1, at: "2097-04-01T00:00:00Z" }, // she wrote to Bo, on the start: counted
        { a: 0, b: 1, at: "2097-04-02T00:00:00Z", kind: "reaction" }, // the same person again: once
        { a: 2, b: 0, at: "2097-04-03T00:00:00Z", kind: "mention" }, // Cy wrote to her
        { a: 1, b: 3, at: "2097-04-04T00:00:00Z" }, // not hers
        { a: 0, b: 3, at: "2097-05-01T00:00:00Z" }, // on the end: not counted
        { a: 0, b: 3, at: "2097-03-31T23:59:59Z" }, // just before: not counted
      ]);

      expect(await ctx.repo().counterpartsBetween(ada, "2097-04-01T00:00:00Z", "2097-05-01T00:00:00Z")).toEqual(new Set([bo, cy]));
      expect(await ctx.repo().counterpartsBetween(dee, "2097-04-01T00:00:00Z", "2097-05-01T00:00:00Z")).toEqual(new Set([bo]));
      expect(await ctx.repo().counterpartsBetween(cy, "2097-06-01T00:00:00Z", "2097-07-01T00:00:00Z")).toEqual(new Set());
      expect(await ctx.repo().counterpartsBetween(bo, "2097-04-01T00:00:00Z", "2097-05-01T00:00:00Z")).toEqual(new Set([ada, dee]));
      expect(await ctx.repo().counterpartsBetween(ada, "2097-05-01T00:00:00Z", "2097-04-01T00:00:00Z")).toEqual(new Set());
    });

    it("reads past 1000 interactions in a window", async () => {
      const [ada, bo, , dee] = ctx.memberIds;
      const start = Date.parse("2097-06-01T00:00:00Z");
      // 1100 with Bo, then one with Dee last: it must still be found after the first page.
      const rows = Array.from({ length: 1100 }, (_, i) => ({ a: 0, b: 1, at: new Date(start + i * 1000).toISOString() }));
      rows.push({ a: 0, b: 3, at: new Date(start + 1100 * 1000).toISOString() });
      await ctx.add(rows);

      expect(await ctx.repo().counterpartsBetween(ada, "2097-06-01T00:00:00Z", "2097-06-02T00:00:00Z")).toEqual(new Set([bo, dee]));
    });
  });
}
