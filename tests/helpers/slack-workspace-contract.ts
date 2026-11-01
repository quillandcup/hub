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

    it("adds conversations and replaces the ones with the same Slack id", async () => {
      const existing = channel("existing", { member_count: 1 });
      await ctx.seed({ channels: [existing] });
      const fresh = channel("fresh");
      const many = Array.from({ length: 230 }, (_, i) => channel(`bulk${i}`));

      await ctx.repo().upsertChannels([
        { channel_id: existing.channel_id, name: "renamed-" + existing.name, member_count: 9, is_mpim: false, raw_payload: {} },
        { channel_id: fresh.channel_id, name: fresh.name, is_mpim: false, raw_payload: {} },
        ...many.map((c) => ({ channel_id: c.channel_id, name: c.name, is_mpim: false, raw_payload: {} })),
      ]);
      await ctx.repo().upsertChannels([]);

      expect(await ctx.repo().channelById(existing.channel_id)).toMatchObject({ name: "renamed-" + existing.name, member_count: 9 });
      expect(await ctx.repo().channelById(fresh.channel_id)).toMatchObject({ name: fresh.name });
      expect(await ctx.repo().channelById(many[229].channel_id)).toMatchObject({ name: many[229].name });
    });

    it("keeps who is in a conversation: joins, comebacks and leaves", async () => {
      const [room, ada, grace, mary] = [ctx.unique("room"), ctx.unique("ada"), ctx.unique("grace"), ctx.unique("mary")];
      const at = (n: number) => `2031-02-0${n}T10:00:00.000Z`;
      const mine = async () => (await ctx.repo().memberships()).filter((m) => m.channel_id === room);

      await ctx.repo().upsertMemberships([ada, grace, mary].map((user_id) => ({ channel_id: room, user_id, left_at: null, imported_at: at(1) })));
      await ctx.repo().upsertMemberships([]);
      expect((await mine()).map((m) => [m.user_id, m.left_at])).toEqual([[ada, null], [grace, null], [mary, null]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      const firstSeen = (await mine())[0].first_seen_at;

      await ctx.repo().markMembersLeft(room, [ada, grace], at(2));
      await ctx.repo().markMembersLeft(room, [], at(2));
      await ctx.repo().markMemberLeft(room, mary, at(3));
      await ctx.repo().markMemberLeft(room, ada, at(4)); // already gone: stays as it was
      const left = new Map((await mine()).map((m) => [m.user_id, m.left_at && Date.parse(m.left_at)]));
      expect(left.get(ada)).toBe(Date.parse(at(2)));
      expect(left.get(grace)).toBe(Date.parse(at(2)));
      expect(left.get(mary)).toBe(Date.parse(at(3)));

      // Coming back clears left_at and keeps when they were first seen.
      await ctx.repo().upsertMemberships([{ channel_id: room, user_id: ada, left_at: null, imported_at: at(5) }]);
      const back = (await mine()).find((m) => m.user_id === ada)!;
      expect(back.left_at).toBeNull();
      expect(back.first_seen_at).toBe(firstSeen);
    });

    it("appends join and leave events once, and tells who is in now", async () => {
      const [room, other, ada, grace] = [ctx.unique("room"), ctx.unique("other"), ctx.unique("ada"), ctx.unique("grace")];
      const event = (channel_id: string, user_id: string, kind: "joined" | "left", day: number, source: "history_notice" | "webhook" | "member_list" = "webhook") => ({
        channel_id,
        user_id,
        event: kind,
        occurred_at: `2031-03-0${day}T10:00:00.000Z`,
        source,
      });

      await ctx.repo().recordMemberEvents([
        event(room, ada, "joined", 1),
        event(room, ada, "joined", 1), // the same event twice in one batch
        { ...event(room, ada, "left", 3), inviter_user_id: "U_FAKE_INVITER", slack_ts: "1.1", raw_payload: { fake: true } },
        event(room, grace, "joined", 2),
        event(other, ada, "joined", 4),
      ]);
      await ctx.repo().recordMemberEvents([event(room, ada, "joined", 1), event(room, ada, "joined", 5, "history_notice")]); // a redelivery, and a new one
      await ctx.repo().recordMemberEvents([]);

      const last = await ctx.repo().lastMemberEvents();
      expect(last.get(room)?.get(ada)).toBe("joined"); // the latest, from day 5
      expect(last.get(room)?.get(grace)).toBe("joined");
      expect(last.get(other)?.get(ada)).toBe("joined");
      expect(last.get(ctx.unique("nobody"))).toBeUndefined();

      await ctx.repo().recordMemberEvents([event(room, grace, "left", 6)]);
      expect((await ctx.repo().lastMemberEvents()).get(room)?.get(grace)).toBe("left");
    });

    it("keeps the custom emoji and marks the removed ones", async () => {
      const [wave, party, gone] = [ctx.unique("wave"), ctx.unique("party"), ctx.unique("gone")];

      await ctx.repo().upsertEmoji([
        { name: wave, image_url: "https://emoji.example.test/wave.png", imported_at: "2031-04-01T00:00:00.000Z" },
        { name: party, alias_for: wave, imported_at: "2031-04-01T00:00:00.000Z" },
        { name: gone, image_url: "https://emoji.example.test/gone.png", imported_at: "2031-04-01T00:00:00.000Z" },
      ]);
      await ctx.repo().upsertEmoji([{ name: wave, image_url: "https://emoji.example.test/wave2.png", imported_at: "2031-04-02T00:00:00.000Z" }]);
      await ctx.repo().upsertEmoji([]);
      const mine = async () => (await ctx.repo().liveEmojiNames()).filter((n) => [wave, party, gone].includes(n));
      expect(await mine()).toEqual([wave, party, gone].sort());

      await ctx.repo().markEmojiRemoved([gone, ctx.unique("never-existed")], "2031-04-03T00:00:00.000Z");
      await ctx.repo().markEmojiRemoved([], "2031-04-03T00:00:00.000Z");
      expect(await mine()).toEqual([wave, party].sort());

      // An emoji that comes back (the sync writes deleted_at: null) is live again.
      await ctx.repo().upsertEmoji([{ name: gone, image_url: "https://emoji.example.test/gone.png", deleted_at: null, imported_at: "2031-04-04T00:00:00.000Z" }]);
      expect(await mine()).toEqual([wave, party, gone].sort());
    });

    it("reads live emoji by name, with their image or alias target", async () => {
      const [wave, party, gone] = [ctx.unique("wave"), ctx.unique("party"), ctx.unique("gone")];
      await ctx.repo().upsertEmoji([
        { name: wave, image_url: "https://emoji.example.test/wave.png" },
        { name: party, alias_for: wave },
        { name: gone, image_url: "https://emoji.example.test/gone.png", deleted_at: "2031-05-01T00:00:00.000Z" },
      ]);
      const many = Array.from({ length: 250 }, (_, i) => `${ctx.unique("nope")}-${i}`);

      const rows = await ctx.repo().emojiByNames([wave, party, gone, ...many]);

      expect(rows).toEqual([
        { name: party, image_url: null, alias_for: wave },
        { name: wave, image_url: "https://emoji.example.test/wave.png", alias_for: null },
      ].sort((x, y) => (x.name < y.name ? -1 : 1)));
      expect(await ctx.repo().emojiByNames([])).toEqual([]);
    });
  });
}
