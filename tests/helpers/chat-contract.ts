import { describe, it, expect, beforeEach } from "vitest";
import type { ChatRepository } from "@/lib/data/chat";

export type SeedChannel = { key: string; slackChannelId?: string; bridgeMode?: "bridged" | "app_only"; bridgeDisabled?: boolean; bridgeStatus?: "ok" | "disconnected" };

export type ChatContractContext = {
  repo: () => ChatRepository;
  /** A string no other run has used (Slack channel ids are unique). */
  unique: (label: string) => string;
  /** Replaces the channels this context made with these; returns each one's Hub id by key. */
  seedChannels: (channels: SeedChannel[]) => Promise<Record<string, string>>;

  // --- message reads ---
  /** Adds messages (and their text, when `body` is given) to a channel; a reply names its root by key (earlier in the same call). Returns each message's id by key. */
  seedMessages: (channelId: string, messages: SeedMessage[]) => Promise<Record<string, string>>;
  /** Adds reactions by Slack-only people to messages of a channel. */
  seedReactions: (channelId: string, reactions: SeedReaction[]) => Promise<void>;
  // --- channels and membership slice ---
  /** Makes `count` members and returns their ids (they go with the context). */
  seedMembers: (count: number) => Promise<string[]>;
  /** Replaces the channels this context made with these, each with the columns that decide how it is listed; returns Hub ids by key. */
  seedChannelRows: (channels: SeedChannelRow[]) => Promise<Record<string, string>>;
  /** Puts members (by index into `seedMembers`' ids) in channels (by key). */
  seedMemberships: (rows: SeedMembership[]) => Promise<void>;
  /** Adds messages (channel by key); returns their ids by key. */
  seedChannelMessages: (rows: SeedChannelMessage[]) => Promise<Record<string, string>>;
  /** The Hub-written notice lines in a channel, with their text. */
  noticesIn: (channelId: string) => Promise<{ author_member_id: string | null; system_subtype: string | null; origin: string; body: string }[]>;

  // --- message writes slice: seeding and read-back ---
  /** A member id that exists (messages and reactions refer to one); a new one on every call. */
  member: () => Promise<string>;
  /** Adds one reaction, by a member or a Slack user, with its Slack sync state. */
  seedReaction: (reaction: { channelId: string; messageId: string; emoji: string; memberId?: string; slackUserId?: string; synced: boolean }) => Promise<void>;
  /** A message as stored now, or null when it is gone. */
  inspectMessage: (id: string) => Promise<MessageState | null>;
  /** Whether a member's reaction is marked as agreeing with Slack. */
  reactionSynced: (messageId: string, emoji: string, memberId: string) => Promise<boolean>;
};

export type SeedChannelRow = {
  key: string;
  name?: string | null;
  kind?: "channel" | "dm" | "group_dm";
  visibility?: "public" | "private";
  restricted?: boolean;
  archivedAt?: string | null;
  slackChannelId?: string | null;
  bridgeDisabled?: boolean;
};
export type SeedMembership = { channel: string; member: number; joinedAt?: string; leftAt?: string; lastReadAt?: string; source?: "slack" | "app" };
export type SeedChannelMessage = {
  key: string;
  channel: string;
  author?: number;
  createdAt: string;
  slackTs?: string;
  /** Key of the message this is a reply to. */
  replyTo?: string;
  deleted?: boolean;
  origin?: "app" | "slack";
  syncStatus?: "pending" | "sent" | "failed";
};

export type MessageState = {
  slack_ts: string | null;
  slack_sync_status: string | null;
  posted_via: string | null;
  thread_root_id: string | null;
  reply_count: number;
  last_reply_at: string | null;
};

export type SeedMessage = {
  key: string;
  createdAt: string;
  body?: string;
  threadRootKey?: string;
  deleted?: boolean;
  hasFiles?: boolean;
  slackTs?: string;
  // Used by the message writes slice (the Hub -> Slack outbox); the database's defaults when left out.
  origin?: "app" | "slack";
  status?: "pending" | "sent" | "failed";
  authorMemberId?: string;
  /** The files column of the message's content. */
  files?: unknown;
  postedVia?: "user_token" | "bot";
  replyCount?: number;
};
export type SeedReaction = { messageId: string; emoji: string; slackUserId: string; deleted?: boolean };

/**
 * Behavior every `ChatRepository` must have; run against the in-memory twin (unit) and Supabase (db).
 * Each slice of the chat repository adds a nested `describe` at the end, and (if it needs rows the
 * context can't make yet) a seeding function on the context.
 */
export function defineChatContract(name: string, setup: () => ChatContractContext) {
  describe(`${name} (ChatRepository contract)`, () => {
    let ctx: ChatContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const NONE = "00000000-0000-4000-8000-000000000000";

    describe("channels", () => {
      it("reads a channel's Slack bridge settings, defaults included, and nothing for a missing channel", async () => {
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannels([
          { key: "plain", slackChannelId: slack },
          { key: "off", slackChannelId: ctx.unique("C"), bridgeMode: "app_only", bridgeDisabled: true, bridgeStatus: "disconnected" },
        ]);

        expect(await ctx.repo().bridgeState(ids.plain)).toEqual({ bridge_mode: "bridged", bridge_disabled: false, bridge_status: "ok" });
        expect(await ctx.repo().bridgeState(ids.off)).toEqual({ bridge_mode: "app_only", bridge_disabled: true, bridge_status: "disconnected" });
        expect(await ctx.repo().bridgeState(NONE)).toBeNull();
      });

      it("finds the channel that mirrors a Slack channel", async () => {
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannels([{ key: "a", slackChannelId: slack }, { key: "b", slackChannelId: ctx.unique("C") }]);

        expect(await ctx.repo().idBySlackChannel(slack)).toBe(ids.a);
        expect(await ctx.repo().idBySlackChannel(ctx.unique("unknown"))).toBeNull();
      });
    });

    // --- message reads ---
    describe("message reads", () => {
      const T = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, "0")}:00.000Z`;
      /** Letters only, so the full text search sees one plain word. */
      const wordFor = (label: string) => ctx.unique(label).replace(/\d/g, (d) => "abcdefghij"[Number(d)]).toLowerCase();
      const ghosts = (n: number) => Array.from({ length: n }, (_, i) => `${ctx.unique("ghost")}x${i}`);
      const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

      async function conversation() {
        const ids = await ctx.seedChannels([{ key: "main" }, { key: "other" }]);
        const m = await ctx.seedMessages(ids.main, [
          { key: "a", createdAt: T(1), body: "first" },
          { key: "b", createdAt: T(2) },
          { key: "c", createdAt: T(3), body: "third", hasFiles: true },
          { key: "r1", createdAt: T(4), body: "reply one", threadRootKey: "a", slackTs: "1.1" },
          { key: "r2", createdAt: T(5), body: "reply two", threadRootKey: "a", slackTs: "1.2" },
        ]);
        const other = await ctx.seedMessages(ids.other, [{ key: "x", createdAt: T(9), body: "elsewhere" }]);
        return { channel: ids.main, otherChannel: ids.other, m, other };
      }

      it("lists a conversation's top-level messages newest first, with their text, a page at a time", async () => {
        const { channel, m } = await conversation();

        const all = await ctx.repo().channelMessages(channel, { limit: 10 });
        expect(idsOf(all)).toEqual([m.c, m.b, m.a]);
        expect(all[0]).toMatchObject({ origin: "slack", has_files: true, reply_count: expect.any(Number), chat_message_contents: { body: "third" } });
        expect(all[1].chat_message_contents).toBeNull();

        expect(idsOf(await ctx.repo().channelMessages(channel, { limit: 2 }))).toEqual([m.c, m.b]);
        expect(idsOf(await ctx.repo().channelMessages(channel, { limit: 10, before: all[1].created_at }))).toEqual([m.a]);
        expect(await ctx.repo().channelMessages(channel, { limit: 10, before: all[2].created_at })).toEqual([]);
      });

      it("lists one thread's replies oldest first, up to a limit", async () => {
        const { channel, m } = await conversation();

        expect(idsOf(await ctx.repo().threadMessages(channel, m.a, 10))).toEqual([m.r1, m.r2]);
        expect(idsOf(await ctx.repo().threadMessages(channel, m.a, 1))).toEqual([m.r1]);
        expect(await ctx.repo().threadMessages(channel, m.b, 10)).toEqual([]);
      });

      it("reads top-level messages by id in their conversation, leaving out replies and other conversations", async () => {
        const { channel, m, other } = await conversation();

        const got = await ctx.repo().topLevelMessagesByIds(channel, [m.a, m.c, m.r1, other.x, ...ghosts(250)]);
        expect(idsOf(got).sort()).toEqual([m.a, m.c].sort());
        expect(await ctx.repo().topLevelMessagesByIds(channel, [])).toEqual([]);
      });

      it("reads one message by id, only in its own conversation", async () => {
        const { channel, otherChannel, m } = await conversation();

        expect(await ctx.repo().messageById(channel, m.c)).toMatchObject({ id: m.c, chat_message_contents: { body: "third" } });
        expect(await ctx.repo().messageById(channel, m.r1)).toMatchObject({ id: m.r1 });
        expect(await ctx.repo().messageById(otherChannel, m.c)).toBeNull();
        expect(await ctx.repo().messageById(channel, NONE)).toBeNull();
      });

      it("finds the newest message of a conversation or of a thread", async () => {
        const { channel, otherChannel, m } = await conversation();

        expect(await ctx.repo().newestMessageId(channel, null)).toBe(m.c);
        expect(await ctx.repo().newestMessageId(channel, m.a)).toBe(m.r2);
        expect(await ctx.repo().newestMessageId(channel, m.b)).toBeNull();
        expect(await ctx.repo().newestMessageId(otherChannel, m.a)).toBeNull();
        const [empty] = Object.values(await ctx.seedChannels([{ key: "empty" }]));
        expect(await ctx.repo().newestMessageId(empty, null)).toBeNull();
      });

      it("reads search hits by id with their place in the conversation", async () => {
        const { channel, m } = await conversation();

        const got = await ctx.repo().searchMessagesByIds([m.r1, m.c, ...ghosts(250)]);
        expect(got.map((r) => r.id).sort()).toEqual([m.r1, m.c].sort());
        expect(got.find((r) => r.id === m.r1)).toMatchObject({ channel_id: channel, thread_root_id: m.a, chat_message_contents: { body: "reply one" } });
        expect(got.find((r) => r.id === m.c)).toMatchObject({ thread_root_id: null, has_files: true });
        expect(await ctx.repo().searchMessagesByIds([])).toEqual([]);
      });

      describe("search", () => {
        const query = (word: string, channelIds: string[], extra: Partial<Parameters<ChatRepository["searchMessageIds"]>[0]> = {}) => ({
          tsquery: word,
          channelIds,
          authorMemberIds: null,
          from: null,
          to: null,
          hasFiles: false,
          inThread: false,
          hasLink: false,
          hasReaction: false,
          limit: 21,
          offset: 0,
          ...extra,
        });

        async function searchable() {
          const word = wordFor("needle");
          const ids = await ctx.seedChannels([{ key: "s1" }, { key: "s2" }]);
          const m = await ctx.seedMessages(ids.s1, [
            { key: "old", createdAt: T(1), body: `${word} plain` },
            { key: "mid", createdAt: T(2), body: `${word} plain` },
            { key: "new", createdAt: T(3), body: `${word} plain` },
            { key: "files", createdAt: T(4), body: `${word} files`, hasFiles: true },
            { key: "gone", createdAt: T(5), body: `${word} plain`, deleted: true },
            { key: "reply", createdAt: T(6), body: `${word} reply`, threadRootKey: "old", slackTs: "2.1" },
            { key: "link", createdAt: T(7), body: `${word} see <https://example.com|a link>` },
            { key: "nobody", createdAt: T(8) },
          ]);
          const o = await ctx.seedMessages(ids.s2, [{ key: "far", createdAt: T(1), body: `${word} plain` }]);
          await ctx.seedReactions(ids.s1, [{ messageId: m.mid, emoji: "tada", slackUserId: "U1" }, { messageId: m.new, emoji: "tada", slackUserId: "U1", deleted: true }]);
          return { word, s1: ids.s1, s2: ids.s2, m, o };
        }

        it("finds live messages with the word in the chosen conversations, ties newest first", async () => {
          const { word, s1, s2, m, o } = await searchable();

          // Same words in the same amount rank alike, so those come newest first.
          expect(await ctx.repo().searchMessageIds(query(`${word} & plain`, [s1]))).toEqual([m.new, m.mid, m.old]);
          const ids = await ctx.repo().searchMessageIds(query(word, [s1]));
          expect([...ids].sort()).toEqual([m.old, m.mid, m.new, m.files, m.reply, m.link].sort());
          expect(ids).not.toContain(m.gone);
          expect(ids).not.toContain(m.nobody);
          expect(await ctx.repo().searchMessageIds(query(word, [s1, s2]))).toContain(o.far);
          expect(await ctx.repo().searchMessageIds(query(word, [s2]))).toEqual([o.far]);
          expect(await ctx.repo().searchMessageIds(query(`${word}nomatch`, [s1]))).toEqual([]);
        });

        it("pages the hits", async () => {
          const { word, s1, m } = await searchable();

          const both = `${word} & plain`;
          expect(await ctx.repo().searchMessageIds(query(both, [s1], { limit: 2 }))).toEqual([m.new, m.mid]);
          expect(await ctx.repo().searchMessageIds(query(both, [s1], { limit: 2, offset: 2 }))).toEqual([m.old]);
        });

        it("narrows by date, files, thread, link and reaction", async () => {
          const { word, s1, m } = await searchable();
          const run = async (extra: Partial<Parameters<ChatRepository["searchMessageIds"]>[0]>) => (await ctx.repo().searchMessageIds(query(word, [s1], extra))).sort();

          expect(await run({ from: T(2), to: T(4) })).toEqual([m.mid, m.new].sort());
          expect(await run({ hasFiles: true })).toEqual([m.files]);
          expect(await run({ inThread: true })).toEqual([m.reply]);
          expect(await run({ hasLink: true })).toEqual([m.link]);
          expect(await run({ hasReaction: true })).toEqual([m.mid]);
        });

        it("searches by filters alone when there is no query", async () => {
          const { s1, m } = await searchable();

          expect(await ctx.repo().searchMessageIds(query("", [s1], { hasFiles: true }))).toEqual([m.files]);
        });

        it("matches no author when none of the given members wrote anything", async () => {
          const { word, s1 } = await searchable();

          expect(await ctx.repo().searchMessageIds(query(word, [s1], { authorMemberIds: [NONE] }))).toEqual([]);
        });
      });

      it("lists who wrote the live replies of these threads, oldest first, across pages and a long list of roots", async () => {
        const { channel, m } = await conversation();
        const second = await ctx.seedMessages(channel, [
          { key: "root", createdAt: T(20), body: "busy" },
          ...Array.from({ length: 1005 }, (_, i) => ({ key: `p${i}`, createdAt: T(21), body: "re", threadRootKey: "root", slackTs: `9.${i}` })),
          { key: "removed", createdAt: T(22), body: "gone", threadRootKey: "root", slackTs: "8.8", deleted: true },
        ]);

        const small = await ctx.repo().replyAuthorRows([m.a, ...ghosts(250)]);
        expect(small).toEqual([
          { thread_root_id: m.a, author_member_id: null, slack_ts: "1.1" },
          { thread_root_id: m.a, author_member_id: null, slack_ts: "1.2" },
        ]);
        const busy = await ctx.repo().replyAuthorRows([second.root]);
        expect(busy).toHaveLength(1005);
        expect(new Set(busy.map((r) => r.slack_ts)).size).toBe(1005);
        expect(busy.some((r) => r.slack_ts === "8.8")).toBe(false);
        expect(await ctx.repo().replyAuthorRows([])).toEqual([]);
      });

      it("reads every live reaction on the given messages, past one page, in a stable order", async () => {
        const { channel, m } = await conversation();
        await ctx.seedReactions(channel, [
          ...Array.from({ length: 1005 }, (_, i) => ({ messageId: m.a, emoji: "heart", slackUserId: `U${i}` })),
          { messageId: m.b, emoji: "tada", slackUserId: "U1" },
          { messageId: m.b, emoji: "tada", slackUserId: "U2", deleted: true },
          { messageId: m.c, emoji: "eyes", slackUserId: "U3" },
        ]);

        const got = await ctx.repo().reactionRows([m.a, m.b, ...ghosts(250)]);
        expect(got).toHaveLength(1006);
        expect(new Set(got.filter((r) => r.message_id === m.a).map((r) => r.slack_user_id)).size).toBe(1005);
        expect(got.filter((r) => r.message_id === m.b)).toEqual([{ message_id: m.b, emoji: "tada", member_id: null, slack_user_id: "U1" }]);
        expect(await ctx.repo().reactionRows([m.c])).toEqual([{ message_id: m.c, emoji: "eyes", member_id: null, slack_user_id: "U3" }]);
        expect(await ctx.repo().reactionRows([])).toEqual([]);
        expect(await ctx.repo().reactionRows(ghosts(3))).toEqual([]);
      });
    });

    // --- channels and membership ---
    describe("channels and membership", () => {
      const at = (iso: string) => Date.parse(iso);
      const sorted = (ids: string[]) => [...ids].sort();

      it("lists conversations by name (unnamed last), then id, with their columns", async () => {
        const slack = ctx.unique("C");
        const prefix = ctx.unique("n");
        const ids = await ctx.seedChannelRows([
          { key: "dm", name: null, kind: "group_dm", visibility: "private", restricted: true },
          { key: "beta", name: `${prefix}-b`, slackChannelId: slack, restricted: true, archivedAt: "2026-02-01T00:00:00Z" },
          { key: "alpha", name: `${prefix}-a` },
        ]);
        const mine = new Set(Object.values(ids));
        const listed = (await ctx.repo().listChannels()).filter((c) => mine.has(c.id));

        // Both names share a prefix that sorts the same way in any collation; the unnamed one comes last.
        expect(listed.map((c) => c.id)).toEqual([ids.alpha, ids.beta, ids.dm]);
        expect(listed[0]).toEqual({ id: ids.alpha, kind: "channel", visibility: "public", restricted: false, name: expect.any(String), archived_at: null, slack_channel_id: null });
        expect(listed[1]).toMatchObject({ restricted: true, slack_channel_id: slack });
        expect(at(listed[1].archived_at!)).toBe(at("2026-02-01T00:00:00Z"));
        expect(listed[2]).toMatchObject({ kind: "group_dm", visibility: "private", name: null });
      });

      it("reads one conversation, its manage settings and its Slack id, and nothing for a missing one", async () => {
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannelRows([
          { key: "a", name: ctx.unique("n"), slackChannelId: slack, visibility: "private", bridgeDisabled: true },
          { key: "b", name: ctx.unique("n") },
        ]);

        expect(await ctx.repo().channelRecord(ids.a)).toMatchObject({ id: ids.a, visibility: "private", slack_channel_id: slack });
        expect(await ctx.repo().channelRecord(NONE)).toBeNull();
        expect(await ctx.repo().manageSettings(ids.a)).toEqual({
          kind: "channel",
          visibility: "private",
          slack_channel_id: slack,
          bridge_mode: "bridged",
          bridge_disabled: true,
          bridge_status: "ok",
          archived_at: null,
        });
        expect(await ctx.repo().manageSettings(NONE)).toBeNull();
        expect(await ctx.repo().slackChannelOf(ids.a)).toBe(slack);
        expect(await ctx.repo().slackChannelOf(ids.b)).toBeNull();
        expect(await ctx.repo().slackChannelOf(NONE)).toBeNull();
      });

      it("knows who is in a conversation now, leaving out those who left", async () => {
        const [m0, m1, m2] = await ctx.seedMembers(3);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }, { key: "b", name: ctx.unique("n") }]);
        await ctx.seedMemberships([
          { channel: "a", member: 0, source: "app" },
          { channel: "a", member: 1 },
          { channel: "a", member: 2, leftAt: "2026-03-01T00:00:00Z" },
          { channel: "b", member: 0 },
        ]);
        const repo = ctx.repo();

        expect(await repo.joinedChannelIds(m0)).toEqual(new Set([ids.a, ids.b]));
        expect(await repo.joinedChannelIds(m2)).toEqual(new Set());
        expect(await repo.isInChannel(ids.a, m1)).toBe(true);
        expect(await repo.isInChannel(ids.a, m2)).toBe(false);
        expect(await repo.isInChannel(ids.b, m1)).toBe(false);
        expect(await repo.activeMembership(ids.a, m0)).toEqual({ source: "app" });
        expect(await repo.activeMembership(ids.a, m1)).toEqual({ source: "slack" });
        expect(await repo.activeMembership(ids.a, m2)).toBeNull();
        expect(sorted(await repo.activeMemberIds(ids.a))).toEqual(sorted([m0, m1]));
        expect(await repo.activeMemberIds(NONE)).toEqual([]);
        const pairs = await repo.activeMembersOf([ids.a, ids.b, NONE]);
        expect(pairs.map((p) => `${p.channel_id}/${p.member_id}`).sort()).toEqual([`${ids.a}/${m0}`, `${ids.a}/${m1}`, `${ids.b}/${m0}`].sort());
        expect(await repo.presentMembers(ids.a, [m0, m1, m2])).toEqual(new Set([m0, m1]));
      });

      it("asks about many conversations and members at once (more than one request's worth)", async () => {
        const [m0] = await ctx.seedMembers(1);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);
        await ctx.seedMemberships([{ channel: "a", member: 0 }]);
        const strangers = Array.from({ length: 150 }, (_, i) => `${NONE.slice(0, -3)}${String(i).padStart(3, "0")}`);

        expect(await ctx.repo().presentMembers(ids.a, [...strangers, m0])).toEqual(new Set([m0]));
        expect(await ctx.repo().activeMembersOf([...strangers, ids.a])).toEqual([{ channel_id: ids.a, member_id: m0 }]);
      });

      it("reads where a member has read up to: their marker, else when they joined", async () => {
        const [m0, m1] = await ctx.seedMembers(2);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);
        await ctx.seedMemberships([
          { channel: "a", member: 0, joinedAt: "2026-01-01T00:00:00Z", lastReadAt: "2026-01-05T00:00:00Z" },
          { channel: "a", member: 1, joinedAt: "2026-01-02T00:00:00Z" },
        ]);

        expect(at((await ctx.repo().readMarker(ids.a, m0))!)).toBe(at("2026-01-05T00:00:00Z"));
        expect(at((await ctx.repo().readMarker(ids.a, m1))!)).toBe(at("2026-01-02T00:00:00Z"));
        expect(await ctx.repo().readMarker(ids.a, NONE)).toBeNull();
      });

      it("adds people, and brings back one who left without adding twice or losing their read marker", async () => {
        const [m0, m1] = await ctx.seedMembers(2);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);
        await ctx.seedMemberships([{ channel: "a", member: 0, leftAt: "2026-03-01T00:00:00Z", lastReadAt: "2026-02-01T00:00:00Z", source: "slack" }]);
        const repo = ctx.repo();

        await repo.addMembers(ids.a, [], "2026-04-01T00:00:00Z");
        expect(await repo.activeMemberIds(ids.a)).toEqual([]);
        await repo.addMembers(ids.a, [{ memberId: m0, source: "app" }, { memberId: m1, source: "slack" }], "2026-04-01T00:00:00Z");

        expect(sorted(await repo.activeMemberIds(ids.a))).toEqual(sorted([m0, m1]));
        expect(await repo.activeMembership(ids.a, m0)).toEqual({ source: "app" });
        expect(await repo.activeMembership(ids.a, m1)).toEqual({ source: "slack" });
        expect(at((await repo.readMarker(ids.a, m0))!)).toBe(at("2026-02-01T00:00:00Z"));
      });

      it("marks a member as having left, once, and does nothing for someone who is not in it", async () => {
        const [m0, m1] = await ctx.seedMembers(2);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);
        await ctx.seedMemberships([{ channel: "a", member: 0 }, { channel: "a", member: 1 }]);
        const repo = ctx.repo();

        await repo.markLeft(ids.a, m0, "2026-05-01T00:00:00Z");
        await repo.markLeft(ids.a, m0, "2026-06-01T00:00:00Z");
        await repo.markLeft(ids.a, NONE, "2026-06-01T00:00:00Z");

        expect(await repo.isInChannel(ids.a, m0)).toBe(false);
        expect(await repo.isInChannel(ids.a, m1)).toBe(true);
      });

      it("lists the conversations a member is in with their Slack settings", async () => {
        const [m0] = await ctx.seedMembers(1);
        const slack = ctx.unique("C");
        const ids = await ctx.seedChannelRows([
          { key: "live", name: ctx.unique("n"), slackChannelId: slack },
          { key: "old", name: ctx.unique("n"), archivedAt: "2026-02-01T00:00:00Z", bridgeDisabled: true },
          { key: "left", name: ctx.unique("n"), slackChannelId: ctx.unique("C") },
          { key: "not", name: ctx.unique("n") },
        ]);
        await ctx.seedMemberships([
          { channel: "live", member: 0 },
          { channel: "old", member: 0 },
          { channel: "left", member: 0, leftAt: "2026-03-01T00:00:00Z" },
        ]);

        const targets = await ctx.repo().slackReadTargets(m0);
        expect(targets).toHaveLength(2);
        const live = targets.find((t) => t.channelId === ids.live)!;
        const old = targets.find((t) => t.channelId === ids.old)!;
        expect(live).toEqual({ channelId: ids.live, slackChannelId: slack, archivedAt: null, bridgeDisabled: false });
        expect(old.slackChannelId).toBeNull();
        expect(at(old.archivedAt!)).toBe(at("2026-02-01T00:00:00Z"));
        expect(old.bridgeDisabled).toBe(true);
        expect(await ctx.repo().slackReadTargets(NONE)).toEqual([]);
      });

      it("writes the notice line for a membership change as a Hub message by the person it is about", async () => {
        const [m0, m1] = await ctx.seedMembers(2);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);

        await ctx.repo().recordMembershipNotice({ channelId: ids.a, authorMemberId: m0, subtype: "channel_join", body: "has joined the channel", createdAt: "2026-05-01T00:00:00Z" });
        await ctx.repo().recordMembershipNotice({ channelId: ids.a, authorMemberId: m1, subtype: "channel_leave", body: "was removed by A &amp; B", createdAt: "2026-05-02T00:00:00Z" });

        const notices = await ctx.noticesIn(ids.a);
        expect(notices).toHaveLength(2);
        expect(notices).toContainEqual({ author_member_id: m0, system_subtype: "channel_join", origin: "app", body: "has joined the channel" });
        expect(notices).toContainEqual({ author_member_id: m1, system_subtype: "channel_leave", origin: "app", body: "was removed by A &amp; B" });
      });

      it("reads a message's retry state, and the newest top-level Slack message at or before a time", async () => {
        const [m0] = await ctx.seedMembers(1);
        const ids = await ctx.seedChannelRows([{ key: "a", name: ctx.unique("n") }]);
        const msg = await ctx.seedChannelMessages([
          { key: "old", channel: "a", createdAt: "2026-01-01T00:00:00Z", slackTs: "1767225600.000100" },
          { key: "new", channel: "a", createdAt: "2026-01-03T00:00:00Z", slackTs: "1767398400.000100" },
          { key: "reply", channel: "a", createdAt: "2026-01-02T00:00:00Z", slackTs: "1767312000.000100", replyTo: "old" },
          { key: "gone", channel: "a", createdAt: "2026-01-02T12:00:00Z", slackTs: "1767355200.000100", deleted: true },
          { key: "hub", channel: "a", author: 0, createdAt: "2026-01-02T18:00:00Z", origin: "app", syncStatus: "failed" },
        ]);
        const repo = ctx.repo();

        expect(await repo.newestSlackTs(ids.a, "2026-01-10T00:00:00Z")).toBe("1767398400.000100");
        expect(await repo.newestSlackTs(ids.a, "2026-01-02T20:00:00Z")).toBe("1767225600.000100");
        expect(await repo.newestSlackTs(ids.a, "2025-12-31T00:00:00Z")).toBeNull();
        expect(await repo.newestSlackTs(NONE, "2026-01-10T00:00:00Z")).toBeNull();
        expect(await repo.retryState(msg.hub)).toEqual({ author_member_id: m0, origin: "app", slack_sync_status: "failed" });
        expect(await repo.retryState(msg.old)).toEqual({ author_member_id: null, origin: "slack", slack_sync_status: null });
        expect(await repo.retryState(NONE)).toBeNull();
      });
    });

    // --- message writes ---
    describe("message writes", () => {
      const T0 = "2020-01-01T00:00:00.000Z";
      /** A channel with a Slack id, and the author every message here is written by. */
      const setup = async () => {
        const slack = ctx.unique("C");
        const { chan } = await ctx.seedChannels([{ key: "chan", slackChannelId: slack }]);
        return { slack, chan, author: await ctx.member() };
      };

      it("describes a message for a Slack write, with its channel's Slack id, and nothing for a missing one", async () => {
        const { slack, chan, author } = await setup();
        const ids = await ctx.seedMessages(chan, [
          { key: "root", origin: "app", slackTs: ctx.unique("1.") , status: "sent", authorMemberId: author, postedVia: "user_token", createdAt: T0 },
          { key: "reply", origin: "app", status: "pending", authorMemberId: author, threadRootKey: "root", createdAt: T0, deleted: true },
        ]);

        expect(await ctx.repo().slackTarget(ids.root)).toMatchObject({
          id: ids.root,
          origin: "app",
          systemSubtype: null,
          authorMemberId: author,
          postedVia: "user_token",
          slackSyncStatus: "sent",
          deletedAt: null,
          threadRootId: null,
          slackChannelId: slack,
        });
        const reply = await ctx.repo().slackTarget(ids.reply);
        expect(reply).toMatchObject({ slackTs: null, slackSyncStatus: "pending", threadRootId: ids.root, postedVia: null });
        expect(reply?.deletedAt).not.toBeNull();
        expect(await ctx.repo().slackTarget(NONE)).toBeNull();
      });

      it("reads a channel that isn't bridged as having no Slack id", async () => {
        const { chan: other } = await ctx.seedChannels([{ key: "chan" }]);
        const { m } = await ctx.seedMessages(other, [{ key: "m", origin: "app", createdAt: T0 }]);
        expect((await ctx.repo().slackTarget(m))?.slackChannelId).toBeNull();
      });

      it("reads an outbox message with its text and files, and empty ones for a message without content", async () => {
        const { chan, author } = await setup();
        const files = [{ id: "pending-1", name: "cat.gif", mimetype: "image/gif", staged: "staging/x/y/cat.gif" }];
        const ids = await ctx.seedMessages(chan, [
          { key: "text", origin: "app", status: "pending", authorMemberId: author, body: "Hello <everyone> & friends", createdAt: T0 },
          { key: "files", origin: "app", status: "pending", authorMemberId: author, body: "", files, createdAt: T0 },
          { key: "bare", origin: "app", createdAt: T0 },
        ]);

        expect(await ctx.repo().outboxMessage(ids.text)).toMatchObject({ id: ids.text, body: "Hello <everyone> & friends", files: null, slackSyncStatus: "pending" });
        expect(await ctx.repo().outboxMessage(ids.files)).toMatchObject({ body: "", files });
        expect(await ctx.repo().outboxMessage(ids.bare)).toMatchObject({ body: "", files: null });
        expect(await ctx.repo().outboxMessage(NONE)).toBeNull();
      });

      it("records the ts Slack returned and marks the message sent, once: a second ts, a message already sent and one that isn't ours are left alone", async () => {
        const { chan } = await setup();
        const ts = ctx.unique("1.");
        const ids = await ctx.seedMessages(chan, [
          { key: "mine", origin: "app", status: "pending", createdAt: T0 },
          { key: "sent", origin: "app", status: "sent", slackTs: ctx.unique("2."), createdAt: T0 },
          { key: "theirs", origin: "slack", slackTs: ctx.unique("3."), createdAt: T0 },
        ]);
        const sentBefore = await ctx.inspectMessage(ids.sent);
        const theirsBefore = await ctx.inspectMessage(ids.theirs);

        await ctx.repo().markSent(ids.mine, ts);
        await ctx.repo().markSent(ids.mine, ctx.unique("9."));
        await ctx.repo().markSent(ids.sent, ctx.unique("9."));
        await ctx.repo().markSent(ids.theirs, ctx.unique("9."));
        await ctx.repo().markSent(NONE, ctx.unique("9."));

        expect(await ctx.inspectMessage(ids.mine)).toMatchObject({ slack_ts: ts, slack_sync_status: "sent" });
        expect(await ctx.inspectMessage(ids.sent)).toEqual(sentBefore);
        expect(await ctx.inspectMessage(ids.theirs)).toEqual(theirsBefore);
      });

      it("folds in the copy Slack's own event already made: the copy goes, its replies follow the app message and its count carries over", async () => {
        const { chan } = await setup();
        const ts = ctx.unique("1.");
        const ids = await ctx.seedMessages(chan, [
          { key: "mine", origin: "app", status: "pending", createdAt: T0 },
          { key: "copy", origin: "slack", slackTs: ts, replyCount: 2, createdAt: T0 },
          { key: "r1", origin: "slack", slackTs: ctx.unique("2."), threadRootKey: "copy", createdAt: T0 },
          { key: "r2", origin: "slack", slackTs: ctx.unique("3."), threadRootKey: "copy", createdAt: T0 },
        ]);

        await ctx.repo().markSent(ids.mine, ts);

        expect(await ctx.inspectMessage(ids.copy)).toBeNull();
        expect(await ctx.inspectMessage(ids.mine)).toMatchObject({ slack_ts: ts, slack_sync_status: "sent", reply_count: 2 });
        expect((await ctx.inspectMessage(ids.r1))?.thread_root_id).toBe(ids.mine);
        expect((await ctx.inspectMessage(ids.r2))?.thread_root_id).toBe(ids.mine);
      });

      it("recounts the thread's live replies when the folded-in copy was itself a reply", async () => {
        const { chan } = await setup();
        const ts = ctx.unique("1.");
        const ids = await ctx.seedMessages(chan, [
          { key: "root", origin: "slack", slackTs: ctx.unique("0."), replyCount: 9, createdAt: T0 },
          { key: "mine", origin: "app", status: "pending", threadRootKey: "root", createdAt: "2020-01-01T00:00:01.000Z" },
          { key: "copy", origin: "slack", slackTs: ts, threadRootKey: "root", createdAt: "2020-01-01T00:00:02.000Z" },
          { key: "other", origin: "slack", slackTs: ctx.unique("2."), threadRootKey: "root", createdAt: "2020-01-01T00:00:03.000Z" },
          { key: "gone", origin: "slack", slackTs: ctx.unique("3."), threadRootKey: "root", createdAt: "2020-01-01T00:00:09.000Z", deleted: true },
        ]);

        await ctx.repo().markSent(ids.mine, ts);

        const root = await ctx.inspectMessage(ids.root);
        expect(root?.reply_count).toBe(2);
        expect(Date.parse(root!.last_reply_at!)).toBe(Date.parse("2020-01-01T00:00:03.000Z"));
        expect(await ctx.inspectMessage(ids.copy)).toBeNull();
      });

      it("marks a pending app message failed, and no other", async () => {
        const { chan } = await setup();
        const ids = await ctx.seedMessages(chan, [
          { key: "pending", origin: "app", status: "pending", createdAt: T0 },
          { key: "sent", origin: "app", status: "sent", slackTs: ctx.unique("1."), createdAt: T0 },
          { key: "theirs", origin: "slack", slackTs: ctx.unique("2."), createdAt: T0 },
        ]);

        for (const id of [ids.pending, ids.sent, ids.theirs, NONE]) await ctx.repo().markFailed(id);

        expect((await ctx.inspectMessage(ids.pending))?.slack_sync_status).toBe("failed");
        expect((await ctx.inspectMessage(ids.sent))?.slack_sync_status).toBe("sent");
        expect((await ctx.inspectMessage(ids.theirs))?.slack_sync_status).toBeNull();
      });

      it("records who posted a message", async () => {
        const { chan } = await setup();
        const { m } = await ctx.seedMessages(chan, [{ key: "m", origin: "app", createdAt: T0 }]);
        await ctx.repo().setPostedVia(m, "user_token");
        expect((await ctx.inspectMessage(m))?.posted_via).toBe("user_token");
        await ctx.repo().setPostedVia(m, "bot");
        expect((await ctx.inspectMessage(m))?.posted_via).toBe("bot");
      });

      it("fails the pending app messages at or before a cutoff and counts them", async () => {
        const { chan } = await setup();
        const ids = await ctx.seedMessages(chan, [
          { key: "old", origin: "app", status: "pending", createdAt: "2020-02-01T00:00:00.000Z" },
          { key: "edge", origin: "app", status: "pending", createdAt: "2020-02-02T00:00:00.000Z" },
          { key: "new", origin: "app", status: "pending", createdAt: "2020-02-03T00:00:00.000Z" },
          { key: "sent", origin: "app", status: "sent", slackTs: ctx.unique("1."), createdAt: "2020-02-01T00:00:00.000Z" },
          { key: "theirs", origin: "slack", slackTs: ctx.unique("2."), createdAt: "2020-02-01T00:00:00.000Z" },
        ]);

        // Other tests' pending messages older than this would count too, so only the ones made here are checked beyond a lower bound.
        const count = await ctx.repo().expireStalePending("2020-02-02T00:00:00.000Z");

        expect(count).toBeGreaterThanOrEqual(2);
        expect((await ctx.inspectMessage(ids.old))?.slack_sync_status).toBe("failed");
        expect((await ctx.inspectMessage(ids.edge))?.slack_sync_status).toBe("failed");
        expect((await ctx.inspectMessage(ids.new))?.slack_sync_status).toBe("pending");
        expect((await ctx.inspectMessage(ids.sent))?.slack_sync_status).toBe("sent");
        expect((await ctx.inspectMessage(ids.theirs))?.slack_sync_status).toBeNull();
        expect(await ctx.repo().expireStalePending("2020-02-02T00:00:00.000Z")).toBe(0);
      });

      it("lists live unsent app messages strictly inside a window, oldest first, up to a limit", async () => {
        const { chan } = await setup();
        const ids = await ctx.seedMessages(chan, [
          { key: "c", origin: "app", status: "failed", createdAt: "2020-03-01T00:03:00.000Z" },
          { key: "a", origin: "app", status: "pending", createdAt: "2020-03-01T00:01:00.000Z" },
          { key: "b", origin: "app", status: "pending", createdAt: "2020-03-01T00:02:00.000Z" },
          { key: "before", origin: "app", status: "pending", createdAt: "2020-03-01T00:00:00.000Z" },
          { key: "after", origin: "app", status: "pending", createdAt: "2020-03-01T00:09:00.000Z" },
          { key: "deleted", origin: "app", status: "pending", createdAt: "2020-03-01T00:04:00.000Z", deleted: true },
          { key: "sent", origin: "app", status: "sent", slackTs: ctx.unique("1."), createdAt: "2020-03-01T00:05:00.000Z" },
          { key: "theirs", origin: "slack", slackTs: ctx.unique("2."), createdAt: "2020-03-01T00:06:00.000Z" },
        ]);
        const window = { createdAfter: "2020-03-01T00:00:00.000Z", createdBefore: "2020-03-01T00:09:00.000Z" };

        expect(await ctx.repo().unsentMessageIds({ ...window, limit: 50 })).toEqual([ids.a, ids.b, ids.c]);
        expect(await ctx.repo().unsentMessageIds({ ...window, limit: 2 })).toEqual([ids.a, ids.b]);
      });

      it("marks a member's own reaction as agreeing with Slack, and leaves other emoji, other members and Slack users' reactions alone", async () => {
        const { chan, author } = await setup();
        const other = await ctx.member();
        const { m } = await ctx.seedMessages(chan, [{ key: "m", origin: "app", createdAt: T0 }]);
        const base = { channelId: chan, messageId: m, synced: false };
        await ctx.seedReaction({ ...base, emoji: "tada", memberId: author });
        await ctx.seedReaction({ ...base, emoji: "heart", memberId: author });
        await ctx.seedReaction({ ...base, emoji: "tada", memberId: other });
        await ctx.seedReaction({ ...base, emoji: "tada", memberId: author, slackUserId: ctx.unique("U") });

        await ctx.repo().markReactionSynced({ messageId: m, emoji: "tada", memberId: author });

        expect(await ctx.reactionSynced(m, "tada", author)).toBe(true);
        expect(await ctx.reactionSynced(m, "heart", author)).toBe(false);
        expect(await ctx.reactionSynced(m, "tada", other)).toBe(false);
      });

      it("names the author of a Hub message, and nobody for a Slack one, one without an author or a missing one", async () => {
        const { chan, author } = await setup();
        const ids = await ctx.seedMessages(chan, [
          { key: "app", origin: "app", authorMemberId: author, createdAt: T0 },
          { key: "slack", origin: "slack", slackTs: ctx.unique("1."), authorMemberId: author, createdAt: T0 },
          { key: "anon", origin: "app", createdAt: T0 },
        ]);

        expect(await ctx.repo().appMessageAuthor(ids.app)).toBe(author);
        expect(await ctx.repo().appMessageAuthor(ids.slack)).toBeNull();
        expect(await ctx.repo().appMessageAuthor(ids.anon)).toBeNull();
        expect(await ctx.repo().appMessageAuthor(NONE)).toBeNull();
      });
    });
  });
}
