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
};

export type SeedMessage = { key: string; createdAt: string; body?: string; threadRootKey?: string; deleted?: boolean; hasFiles?: boolean; slackTs?: string };
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
  });
}
