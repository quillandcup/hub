import { describe, it, expect, beforeEach } from "vitest";
import type { CareTrackedDmRepository } from "@/lib/data/care-dms";

export type CareDmsContractContext = {
  repo: () => CareTrackedDmRepository;
  /** Two members. */
  members: readonly { id: string }[];
  /** Two staff accounts (auth user ids). */
  users: readonly [string, string];
  /** A Slack DM id no other run has used. */
  channel: (label: string) => string;
  /** Removes every tracked DM of the two users. */
  clear: () => Promise<void>;
};

/** Behavior every `CareTrackedDmRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCareDmsContract(name: string, setup: () => CareDmsContractContext) {
  describe(`${name} (CareTrackedDmRepository contract)`, () => {
    let ctx: CareDmsContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const [ada, bo] = [0, 1];
    const mine = () => ctx.users[0];
    const theirs = () => ctx.users[1];

    it("tracks a DM as a staff member, with the member on the other side", async () => {
      const channel = ctx.channel("a");

      const result = await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });

      expect(result.created).toBe(true);
      expect(result.dm).toMatchObject({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });
      expect(result.dm.id).toMatch(/^caredm_[1-9A-HJ-NP-Za-km-z]{12}$/);
      expect(Number.isNaN(Date.parse(result.dm.createdAt))).toBe(false);
    });

    it("tracking a DM twice is not an error and does not add a second row", async () => {
      const channel = ctx.channel("a");
      const first = await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });

      const again = await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });

      expect(again).toEqual({ created: false, dm: first.dm });
      expect(await ctx.repo().forUser(mine())).toHaveLength(1);
    });

    it("lists one staff member's live tracked DMs, oldest first, and no one else's", async () => {
      const [a, b, c] = [ctx.channel("a"), ctx.channel("b"), ctx.channel("c")];
      await ctx.repo().track({ trackedBy: mine(), channelId: a, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: mine(), channelId: b, memberId: ctx.members[bo].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: c, memberId: ctx.members[ada].id });

      expect((await ctx.repo().forUser(mine())).map((d) => d.channelId)).toEqual([a, b]);
      expect((await ctx.repo().forUser(theirs())).map((d) => d.channelId)).toEqual([c]);
    });

    it("stops tracking: the row is hidden, the answer says whether there was one, and the DM can be tracked again", async () => {
      const channel = ctx.channel("a");
      const first = await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });

      expect(await ctx.repo().untrack(mine(), channel, "2026-03-02T10:00:00.000Z")).toBe(true);
      expect(await ctx.repo().forUser(mine())).toEqual([]);
      expect(await ctx.repo().untrack(mine(), channel, "2026-03-02T11:00:00.000Z")).toBe(false);
      expect(await ctx.repo().untrack(mine(), ctx.channel("never"), "2026-03-02T10:00:00.000Z")).toBe(false);

      const again = await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });
      expect(again.created).toBe(true);
      expect(again.dm.id).not.toBe(first.dm.id);
    });

    it("untracking is the caller's own: another staff member's tracking of the same DM stays", async () => {
      const channel = ctx.channel("a");
      await ctx.repo().track({ trackedBy: mine(), channelId: channel, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: channel, memberId: ctx.members[ada].id });

      await ctx.repo().untrack(mine(), channel, "2026-03-02T10:00:00.000Z");

      expect((await ctx.repo().forChannel(channel)).map((d) => d.trackedBy)).toEqual([theirs()]);
    });

    it("lists everyone's live tracked DMs, and who tracks a given DM", async () => {
      const [a, b] = [ctx.channel("a"), ctx.channel("b")];
      await ctx.repo().track({ trackedBy: mine(), channelId: a, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: a, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: b, memberId: ctx.members[bo].id });
      await ctx.repo().untrack(theirs(), b, "2026-03-02T10:00:00.000Z");

      const all = (await ctx.repo().allLive()).filter((d) => [a, b].includes(d.channelId));
      expect(all.map((d) => `${d.trackedBy}|${d.channelId}`).sort()).toEqual([`${mine()}|${a}`, `${theirs()}|${a}`].sort());
      expect((await ctx.repo().forChannel(a)).map((d) => d.trackedBy).sort()).toEqual([mine(), theirs()].sort());
      expect(await ctx.repo().forChannel(b)).toEqual([]);
    });

    it("lists the live tracked DMs with a member, whoever tracks them (whose DMs hold the member's care plan messages)", async () => {
      const [a, b, c, d] = [ctx.channel("a"), ctx.channel("b"), ctx.channel("c"), ctx.channel("d")];
      await ctx.repo().track({ trackedBy: mine(), channelId: a, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: b, memberId: ctx.members[ada].id });
      await ctx.repo().track({ trackedBy: theirs(), channelId: c, memberId: ctx.members[bo].id });
      await ctx.repo().untrack(mine(), a, "2026-03-02T10:00:00.000Z");
      await ctx.repo().track({ trackedBy: mine(), channelId: d, memberId: ctx.members[ada].id });

      const withAda = await ctx.repo().forMember(ctx.members[ada].id);
      expect(withAda.map((d) => d.channelId).sort()).toEqual([b, d].sort());
      expect((await ctx.repo().forMember(ctx.members[bo].id)).map((d) => d.channelId)).toEqual([c]);
      expect(await ctx.repo().forMember("mbr_ZZZZZZZZZZZZ")).toEqual([]);
    });

    it("refuses an empty conversation id and a member nobody has", async () => {
      await expect(ctx.repo().track({ trackedBy: mine(), channelId: "", memberId: ctx.members[ada].id })).rejects.toThrow();
      await expect(ctx.repo().track({ trackedBy: mine(), channelId: ctx.channel("a"), memberId: "mbr_ZZZZZZZZZZZZ" })).rejects.toThrow();
      expect(await ctx.repo().forUser(mine())).toEqual([]);
    });
  });
}
