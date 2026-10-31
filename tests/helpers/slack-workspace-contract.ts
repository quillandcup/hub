import { describe, it, expect, beforeEach } from "vitest";
import type { SlackChannelSeed, SlackWorkspaceRepository } from "@/lib/data/slack-workspace";

export type SlackWorkspaceContractContext = {
  repo: () => SlackWorkspaceRepository;
  /** A string no other run has used (Slack ids are unique across the tables). */
  unique: (label: string) => string;
  /** Replaces the conversations and ignored Slack users this context made with these. */
  seed: (data: { channels?: SlackChannelSeed[]; ignoredUserIds?: string[] }) => Promise<void>;
};

/** Behavior every `SlackWorkspaceRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineSlackWorkspaceContract(name: string, setup: () => SlackWorkspaceContractContext) {
  describe(`${name} (SlackWorkspaceRepository contract)`, () => {
    let ctx: SlackWorkspaceContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const channel = (label: string, extra: Partial<SlackChannelSeed> = {}): SlackChannelSeed => ({
      channel_id: ctx.unique(label),
      name: `name-${ctx.unique(label)}`,
      is_private: false,
      is_archived: false,
      is_mpim: false,
      member_count: 3,
      ...extra,
    });
    const mine = <T extends { channel_id: string }>(rows: T[], seeded: SlackChannelSeed[]) => rows.filter((r) => seeded.some((s) => s.channel_id === r.channel_id));

    it("lists conversations by name then id, with the columns admins may read", async () => {
      const sameName = ctx.unique("zz-same");
      const b = channel("b", { name: sameName });
      const a = channel("a", { name: sameName, is_private: true, member_count: null });
      const first = channel("first", { name: ctx.unique("aa-first"), is_mpim: true });
      await ctx.seed({ channels: [b, a, first] });

      const listed = mine(await ctx.repo().channels(), [a, b, first]);

      // Equal names fall back to the id ("a..." before "b...").
      expect(listed.map((c) => c.channel_id)).toEqual([first.channel_id, a.channel_id, b.channel_id]);
      expect(listed.find((c) => c.channel_id === a.channel_id)).toMatchObject({ name: a.name, is_private: true, is_archived: false, is_mpim: false, member_count: null });
      expect(Object.keys(listed[0])).not.toContain("raw_payload");
    });

    it("reads one conversation, or null", async () => {
      const c = channel("one", { is_private: true });
      await ctx.seed({ channels: [c] });

      expect(await ctx.repo().channelById(c.channel_id)).toMatchObject({ channel_id: c.channel_id, name: c.name, is_private: true, is_mpim: false });
      expect(await ctx.repo().channelById(ctx.unique("nobody"))).toBeNull();
    });

    it("finds a conversation id by name (the lowest id when several share it), or null", async () => {
      const name = ctx.unique("shared-name");
      const [x, y] = [channel("x", { name }), channel("y", { name })];
      await ctx.seed({ channels: [y, x] });

      expect(await ctx.repo().channelIdByName(name)).toBe([x, y].map((c) => c.channel_id).sort()[0]);
      expect(await ctx.repo().channelIdByName(ctx.unique("no-such-name"))).toBeNull();
    });

    it("names the public channels among some ids", async () => {
      const open = channel("open");
      const closed = channel("closed", { is_private: true });
      const unknownPrivacy = channel("unknown", { is_private: null });
      await ctx.seed({ channels: [open, closed, unknownPrivacy] });

      const names = await ctx.repo().publicChannelNames([open.channel_id, closed.channel_id, unknownPrivacy.channel_id, open.channel_id, ctx.unique("missing")]);

      // `is_private = false` doesn't match an unflagged (null) channel, as in SQL.
      expect([...names]).toEqual([[open.channel_id, open.name]]);
      expect((await ctx.repo().publicChannelNames([])).size).toBe(0);
    });

    it("remembers the Slack users to skip; skipping twice is fine", async () => {
      const [skipped, other] = [ctx.unique("skipped"), ctx.unique("other")];
      await ctx.seed({ ignoredUserIds: [other] });

      await ctx.repo().ignoreUser(skipped, "bot");
      await ctx.repo().ignoreUser(skipped, "guest");

      const ids = await ctx.repo().ignoredUserIds();
      expect(ids.has(skipped)).toBe(true);
      expect(ids.has(other)).toBe(true);
      expect(ids.has(ctx.unique("never"))).toBe(false);
    });

    it("restricts and unrestricts a channel; restricting twice is fine", async () => {
      const id = ctx.unique("private");

      await ctx.repo().restrictChannel(id, "secret-place");
      await ctx.repo().restrictChannel(id, "secret-place");
      const restricted = await ctx.repo().restrictedChannels();
      expect(restricted.has(id)).toBe(true);
      expect(typeof restricted.get(id)).toBe("string");

      await ctx.repo().unrestrictChannel(id);
      await ctx.repo().unrestrictChannel(id);
      expect((await ctx.repo().restrictedChannels()).has(id)).toBe(false);
    });
  });
}
