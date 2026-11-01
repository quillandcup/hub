import { describe, it, expect, beforeEach } from "vitest";
import type { NewSlackMessage, NewSlackReaction, SlackMessageRepository, SlackMessageSeed, SlackReactionSeed } from "@/lib/data/slack-messages";

export type SlackMessageContractContext = {
  repo: () => SlackMessageRepository;
  /** A string no other run has used (Slack ids are unique across the tables). */
  unique: (label: string) => string;
  /** What is stored for a message now (content is not readable through the repository), or null when there is none. */
  stored: (channelId: string, messageTs: string) => Promise<{ text: string | null; edited_at: string | null; reply_count: number | null; files: unknown } | null>;
  /** Replaces the messages and reactions this context made with these. */
  seed: (data: { messages?: SlackMessageSeed[]; reactions?: SlackReactionSeed[] }) => Promise<void>;
};

/** The days the contract's rows are on: long ago, so rows other runs or the dev seed hold never fall inside. */
const DAY = (n: number) => new Date(Date.UTC(2001, 2, n, 12)).toISOString();

/** Postgres writes the same instant as `+00:00`, a twin as `Z`: compare instants. */
const atMs = <T extends { occurred_at: string }>(row: T) => ({ ...row, occurred_at: Date.parse(row.occurred_at) });
const ms = (iso: string) => Date.parse(iso);

const asNewMessage = (m: SlackMessageSeed): NewSlackMessage => ({ raw_payload: {}, ...m });
const asNewReaction = (r: SlackReactionSeed): NewSlackReaction => ({ raw_payload: {}, ...r });

/** Behavior every `SlackMessageRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineSlackMessageContract(name: string, setup: () => SlackMessageContractContext) {
  describe(`${name} (SlackMessageRepository contract)`, () => {
    let ctx: SlackMessageContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    let seq = 0;
    const message = (channel: string, user: string, day: number, extra: Partial<SlackMessageSeed> = {}): SlackMessageSeed => ({
      channel_id: channel,
      message_ts: `${1000000000 + ++seq}.000100`,
      user_id: user,
      occurred_at: DAY(day),
      text: "hello",
      raw_payload: {},
      ...extra,
    });
    const reaction = (channel: string, user: string, day: number, extra: Partial<SlackReactionSeed> = {}): SlackReactionSeed => ({
      channel_id: channel,
      message_ts: `${1000000000 + ++seq}.000100`,
      user_id: user,
      reaction: "tada",
      occurred_at: DAY(day),
      raw_payload: {},
      ...extra,
    });

    it("counts each user's messages, deleted ones included, from the metadata view", async () => {
      const [channel, ada, grace] = [ctx.unique("c"), ctx.unique("ada"), ctx.unique("grace")];
      await ctx.seed({
        messages: [message(channel, ada, 1), message(channel, ada, 2, { deleted_at: DAY(3) }), message(channel, grace, 2), message(channel, ada, 4, { message_type: "channel_join" })],
      });

      const counts = await ctx.repo().messageCountsByUser();

      expect(counts.get(ada)).toBe(3);
      expect(counts.get(grace)).toBe(1);
      expect(counts.has(ctx.unique("nobody"))).toBe(false);
    });

    it("counts past a thousand messages", async () => {
      const [channel, user] = [ctx.unique("crowd"), ctx.unique("talker")];
      await ctx.seed({ messages: Array.from({ length: 1030 }, () => message(channel, user, 5)) });

      expect((await ctx.repo().messageCountsByUser()).get(user)).toBe(1030);
    });

    it("reports when messages or reactions were last imported", async () => {
      const channel = ctx.unique("c");
      const older = message(channel, ctx.unique("u"), 1, { imported_at: "2031-01-01T00:00:00.000Z" });
      const newest = reaction(channel, ctx.unique("u"), 1, { imported_at: "2031-06-01T00:00:00.000Z" });
      await ctx.seed({ messages: [older], reactions: [newest] });

      const last = await ctx.repo().lastImportedAt();

      expect(last && new Date(last).getTime() >= Date.parse("2031-06-01T00:00:00.000Z")).toBe(true);
    });

    it("lists live, member-written messages in a time range, by time, without content", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const early = message(channel, user, 10, { channel_name: "general", thread_ts: "1.0" });
      const late = message(channel, user, 12);
      await ctx.seed({
        messages: [
          late,
          early,
          message(channel, user, 9),
          message(channel, user, 13),
          message(channel, user, 11, { deleted_at: DAY(14) }),
          message(channel, user, 11, { message_type: "channel_name" }),
          message(channel, user, 11, { message_type: "thread_broadcast" }),
        ],
      });

      const rows = (await ctx.repo().liveMessagesBetween(DAY(10), DAY(12))).filter((r) => r.channel_id === channel);

      expect(rows.map((r) => ms(r.occurred_at))).toEqual([DAY(10), DAY(11), DAY(12)].map(ms));
      expect(atMs(rows[0])).toEqual({ channel_id: channel, channel_name: "general", occurred_at: ms(DAY(10)), deleted_at: null, user_id: user, thread_ts: "1.0" });
      expect(Object.keys(rows[0])).not.toContain("text");
    });

    it("lists past a thousand messages in a range", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      await ctx.seed({ messages: Array.from({ length: 1040 }, () => message(channel, user, 15)) });

      expect((await ctx.repo().liveMessagesBetween(DAY(15), DAY(15))).filter((r) => r.channel_id === channel)).toHaveLength(1040);
    });

    it("lists live reactions in a time range, by time", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      await ctx.seed({
        reactions: [
          reaction(channel, user, 20, { reaction: "b", channel_name: "general" }),
          reaction(channel, user, 18, { reaction: "a" }),
          reaction(channel, user, 19, { reaction: "gone", deleted_at: DAY(21) }),
          reaction(channel, user, 22, { reaction: "outside" }),
        ],
      });

      const rows = (await ctx.repo().liveReactionsBetween(DAY(18), DAY(20))).filter((r) => r.channel_id === channel);

      expect(rows.map((r) => r.reaction)).toEqual(["a", "b"]);
      expect(atMs(rows[1])).toEqual({ channel_id: channel, channel_name: "general", occurred_at: ms(DAY(20)), deleted_at: null, user_id: user, reaction: "b" });
    });

    it("lists the channel and time of every live, member-written message", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      await ctx.seed({
        messages: [message(channel, user, 25), message(channel, user, 24), message(channel, user, 26, { deleted_at: DAY(27) }), message(channel, user, 26, { message_type: "group_join" })],
      });

      const rows = (await ctx.repo().liveMessageTimes()).filter((r) => r.channel_id === channel);

      expect(rows.map(atMs)).toEqual([
        { channel_id: channel, occurred_at: ms(DAY(24)) },
        { channel_id: channel, occurred_at: ms(DAY(25)) },
      ]);
    });

    it("adds messages and replaces the ones with the same channel and timestamp, in chunks", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const original = message(channel, user, 30, { text: "first" });
      await ctx.seed({ messages: [original] });
      const bulk = Array.from({ length: 230 }, () => message(channel, user, 30, { text: "bulk" }));

      await ctx.repo().upsertMessages([{ ...asNewMessage(original), text: "edited", reply_count: 2 }, ...bulk.map(asNewMessage)]);
      await ctx.repo().upsertMessages([]);

      const rows = (await ctx.repo().liveMessagesBetween(DAY(30), DAY(30))).filter((r) => r.channel_id === channel);
      expect(rows).toHaveLength(231);
      expect(await ctx.stored(channel, original.message_ts)).toMatchObject({ text: "edited", reply_count: 2 });
      const counts = await ctx.repo().messageCountsByUser();
      expect(counts.get(user)).toBe(231);
    });

    it("adds reactions, replaces the same one, and brings back one taken back", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const taken = reaction(channel, user, 31, { reaction: "wave", deleted_at: DAY(32) });
      await ctx.seed({ reactions: [taken] });
      const bulk = Array.from({ length: 230 }, () => reaction(channel, user, 31));

      await ctx.repo().upsertReactions([{ ...asNewReaction(taken), deleted_at: null }, ...bulk.map(asNewReaction)]);
      await ctx.repo().upsertReactions([]);

      const rows = (await ctx.repo().liveReactionsBetween(DAY(31), DAY(31))).filter((r) => r.channel_id === channel);
      expect(rows).toHaveLength(231);
    });

    it("rewrites an edited message and leaves one we don't have alone", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const m = message(channel, user, 33, { text: "before", thread_ts: null });
      await ctx.seed({ messages: [m] });

      await ctx.repo().editMessage(channel, m.message_ts, {
        text: "after",
        edited_at: DAY(34),
        reply_count: 3,
        reply_users_count: 2,
        files: [{ id: "F_FAKE" }],
        raw_payload: { edited: true },
      });
      await ctx.repo().editMessage(channel, "9999999999.000000", { text: "ghost", edited_at: null, reply_count: 0, reply_users_count: 0, files: null, raw_payload: {} });

      const stored = await ctx.stored(channel, m.message_ts);
      expect(stored).toMatchObject({ text: "after", reply_count: 3, files: [{ id: "F_FAKE" }] });
      expect(Date.parse(stored!.edited_at!)).toBe(Date.parse(DAY(34)));
      expect(await ctx.stored(channel, "9999999999.000000")).toBeNull();
    });

    it("soft-deletes messages once, in chunks, and only those named", async () => {
      const [channel, other, user] = [ctx.unique("c"), ctx.unique("o"), ctx.unique("u")];
      const doomed = Array.from({ length: 130 }, () => message(channel, user, 35));
      const kept = message(channel, user, 35);
      const elsewhere = message(other, user, 35, { message_ts: doomed[0].message_ts });
      await ctx.seed({ messages: [...doomed, kept, elsewhere] });

      await ctx.repo().markMessagesDeleted(channel, doomed.map((m) => m.message_ts), DAY(36));
      await ctx.repo().markMessagesDeleted(channel, [], DAY(36));
      await ctx.repo().markMessagesDeleted(channel, [doomed[0].message_ts], DAY(37)); // already deleted: not touched again

      const live = await ctx.repo().storedMessagesBetween(DAY(35), DAY(35));
      expect(live.filter((r) => r.channel_id === channel).map((r) => r.message_ts)).toEqual([kept.message_ts]);
      expect(live.filter((r) => r.channel_id === other)).toHaveLength(1);
    });

    it("soft-deletes one reaction if it is live", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const a = reaction(channel, user, 38, { reaction: "a" });
      const b = reaction(channel, user, 38, { reaction: "b" });
      await ctx.seed({ reactions: [a, b] });

      await ctx.repo().markReactionRemoved(a, DAY(39));
      await ctx.repo().markReactionRemoved(a, DAY(40));
      await ctx.repo().markReactionRemoved({ ...a, user_id: ctx.unique("someone-else") }, DAY(40));

      expect((await ctx.repo().liveReactionsBetween(DAY(38), DAY(38))).filter((r) => r.channel_id === channel).map((r) => r.reaction)).toEqual(["b"]);
    });

    it("lists the live messages in a time range with their place in a thread, by channel then timestamp, past a thousand", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      const crowd = Array.from({ length: 1030 }, () => message(channel, user, 41, { thread_ts: "1.0" }));
      const deleted = message(channel, user, 41, { deleted_at: DAY(42) });
      const outside = message(channel, user, 43);
      await ctx.seed({ messages: [outside, deleted, ...crowd] });

      const rows = (await ctx.repo().storedMessagesBetween(DAY(41), DAY(41))).filter((r) => r.channel_id === channel);

      expect(rows).toHaveLength(1030);
      expect(rows.map((r) => r.message_ts)).toEqual(crowd.map((m) => m.message_ts).sort());
      expect(rows[0]).toMatchObject({ channel_id: channel, thread_ts: "1.0" });
      expect(Object.keys(rows[0]).sort()).toEqual(["channel_id", "message_ts", "occurred_at", "thread_ts"]);
    });

    it("lists the live reactions on some messages of a channel, in chunks", async () => {
      const [channel, other, user] = [ctx.unique("c"), ctx.unique("o"), ctx.unique("u")];
      const onTarget = Array.from({ length: 130 }, () => reaction(channel, user, 44, { reaction: "tada" }));
      const gone = reaction(channel, user, 44, { reaction: "gone", message_ts: onTarget[0].message_ts, deleted_at: DAY(45) });
      const unrelated = reaction(channel, user, 44, { reaction: "other" });
      const elsewhere = reaction(other, user, 44, { reaction: "tada", message_ts: onTarget[0].message_ts });
      await ctx.seed({ reactions: [...onTarget, gone, unrelated, elsewhere] });

      const keys = await ctx.repo().liveReactionsOn(channel, onTarget.map((r) => r.message_ts));

      expect(keys).toHaveLength(130);
      expect(keys.every((k) => k.channel_id === channel && k.reaction === "tada" && k.user_id === user)).toBe(true);
      expect(await ctx.repo().liveReactionsOn(channel, [])).toEqual([]);
    });

    it("lists the live messages of some threads, the opening message included, past a thousand", async () => {
      const [channel, other, user] = [ctx.unique("c"), ctx.unique("o"), ctx.unique("u")];
      const root = message(channel, user, 46, { message_ts: "2000000000.000001", thread_ts: "2000000000.000001" });
      const replies = Array.from({ length: 1030 }, () => message(channel, user, 46, { thread_ts: root.message_ts }));
      const deleted = message(channel, user, 46, { thread_ts: root.message_ts, deleted_at: DAY(47) });
      const otherThread = message(channel, user, 46, { thread_ts: "2000000000.000099" });
      const elsewhere = message(other, user, 46, { thread_ts: root.message_ts });
      await ctx.seed({ messages: [root, ...replies, deleted, otherThread, elsewhere] });

      const rows = await ctx.repo().threadMessages(channel, [root.message_ts, ctx.unique("none")]);

      expect(rows).toHaveLength(1031);
      expect(rows.every((r) => r.thread_ts === root.message_ts)).toBe(true);
      expect(rows.map((r) => r.message_ts)).toContain(root.message_ts);
      expect(await ctx.repo().threadMessages(channel, [])).toEqual([]);
    });

    it("tells whether there is any live activity in a range", async () => {
      const [channel, user] = [ctx.unique("c"), ctx.unique("u")];
      await ctx.seed({
        messages: [message(channel, user, 48, { deleted_at: DAY(49) }), message(channel, user, 50)],
        reactions: [reaction(channel, user, 52), reaction(channel, user, 54, { deleted_at: DAY(55) })],
      });

      expect(await ctx.repo().hasLiveActivityBetween(DAY(50), DAY(50))).toBe(true); // a message
      expect(await ctx.repo().hasLiveActivityBetween(DAY(52), DAY(52))).toBe(true); // only a reaction
      expect(await ctx.repo().hasLiveActivityBetween(DAY(48), DAY(48))).toBe(false); // a deleted message
      expect(await ctx.repo().hasLiveActivityBetween(DAY(54), DAY(54))).toBe(false); // a reaction taken back
    });

    it("tells which message timestamps of a channel are stored, the newest one, and who wrote them", async () => {
      const [channel, other, ada, grace] = [ctx.unique("c"), ctx.unique("o"), ctx.unique("ada"), ctx.unique("grace")];
      const first = message(channel, ada, 60, { message_ts: "1700000000.000100" });
      const second = message(channel, grace, 60, { message_ts: "1700000500.000100", deleted_at: DAY(61) });
      const elsewhere = message(other, ada, 60, { message_ts: "1700000900.000100" });
      await ctx.seed({ messages: [first, second, elsewhere] });
      const many = Array.from({ length: 250 }, (_, i) => `1600000000.${String(i).padStart(6, "0")}`);

      const stored = await ctx.repo().storedTimestamps(channel, [first.message_ts, second.message_ts, elsewhere.message_ts, "1.1", ...many]);
      expect([...stored].sort()).toEqual([first.message_ts, second.message_ts]); // deleted ones count; other channels don't
      expect((await ctx.repo().storedTimestamps(channel, [])).size).toBe(0);

      expect(await ctx.repo().newestTimestamp(channel)).toBe(second.message_ts);
      expect(await ctx.repo().newestTimestamp(ctx.unique("empty"))).toBeNull();

      const authors = await ctx.repo().authorsByTs(channel, [first.message_ts, second.message_ts, elsewhere.message_ts, ...many]);
      expect([...authors]).toEqual([[first.message_ts, ada], [second.message_ts, grace]]);
      expect((await ctx.repo().authorsByTs(channel, [])).size).toBe(0);
    });

    it("keeps files: records them once, finds the ones without a copy, updates, and lists deleted ones with bytes", async () => {
      const [channel, other] = [ctx.unique("c"), ctx.unique("o")];
      const [a, b, c, d] = [ctx.unique("fa"), ctx.unique("fb"), ctx.unique("fc"), ctx.unique("fd")];
      const file = (file_id: string, ts: string, extra = {}) => ({ file_id, channel_id: channel, message_ts: ts, name: file_id + ".png", mimetype: "image/png", size_bytes: 10, raw_payload: { id: file_id }, ...extra });
      await ctx.seed({});

      await ctx.repo().recordFiles([file(a, "1700000100.000100"), file(b, "1700000200.000100"), file(c, "1700000300.000100", { channel_id: other })]);
      await ctx.repo().recordFiles([{ ...file(a, "1700000100.000100"), name: "overwritten.png" }, file(d, "1700000400.000100")]); // a is left as it was
      await ctx.repo().recordFiles([]);

      expect(await ctx.repo().fileById(a)).toMatchObject({ file_id: a, channel_id: channel, name: a + ".png", mimetype: "image/png", size_bytes: 10, storage_path: null, copy_error: null, deleted_at: null, raw_payload: { id: a } });
      expect(await ctx.repo().fileById(ctx.unique("none"))).toBeNull();
      const mine = (rows: { file_id: string }[]) => rows.filter((r) => [a, b, c, d].includes(r.file_id)).map((r) => r.file_id);
      expect(mine(await ctx.repo().filesWithoutCopy())).toEqual([a, b, c, d]); // oldest message first

      await ctx.repo().updateFile(a, { storage_path: a + "/a.png", copied_at: DAY(62) });
      await ctx.repo().updateFile(b, { copy_error: "skipped: deleted", deleted_at: DAY(63) });
      await ctx.repo().updateFile(c, { deleted_at: DAY(62), storage_path: c + "/c.png" });
      await ctx.repo().updateFile(d, { deleted_at: DAY(64), storage_path: d + "/d.png" });
      expect(mine(await ctx.repo().filesWithoutCopy())).toEqual([b]);
      expect(await ctx.repo().fileById(b)).toMatchObject({ copy_error: "skipped: deleted" });

      // Live files on messages from a timestamp on, by file id.
      expect(mine(await ctx.repo().liveFilesSince("1700000050.000000"))).toEqual([a]);
      expect(mine(await ctx.repo().liveFilesSince("1700000150.000000"))).toEqual([]);

      // Deleted files whose bytes are still stored, the longest deleted first.
      const withBytes = (await ctx.repo().deletedFilesWithBytes(1000)).filter((r) => [c, d].includes(r.file_id));
      expect(withBytes).toEqual([{ file_id: c, storage_path: c + "/c.png" }, { file_id: d, storage_path: d + "/d.png" }]);
      expect((await ctx.repo().deletedFilesWithBytes(1)).length).toBe(1);

      // Replacing a file's row overwrites it.
      await ctx.repo().replaceFile({ ...file(a, "1700000100.000100"), name: "replaced.png", storage_path: a + "/new.png" });
      await ctx.repo().replaceFile(file(ctx.unique("fresh"), "1700000500.000100"));
      expect(await ctx.repo().fileById(a)).toMatchObject({ name: "replaced.png", storage_path: a + "/new.png" });
    });
  });
}
