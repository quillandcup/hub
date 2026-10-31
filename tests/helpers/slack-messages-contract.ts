import { describe, it, expect, beforeEach } from "vitest";
import type { SlackMessageRepository, SlackMessageSeed, SlackReactionSeed } from "@/lib/data/slack-messages";

export type SlackMessageContractContext = {
  repo: () => SlackMessageRepository;
  /** A string no other run has used (Slack ids are unique across the tables). */
  unique: (label: string) => string;
  /** Replaces the messages and reactions this context made with these. */
  seed: (data: { messages?: SlackMessageSeed[]; reactions?: SlackReactionSeed[] }) => Promise<void>;
};

/** The days the contract's rows are on: long ago, so rows other runs or the dev seed hold never fall inside. */
const DAY = (n: number) => `2001-03-${String(n).padStart(2, "0")}T12:00:00.000Z`;

/** Postgres writes the same instant as `+00:00`, a twin as `Z`: compare instants. */
const atMs = <T extends { occurred_at: string }>(row: T) => ({ ...row, occurred_at: Date.parse(row.occurred_at) });
const ms = (iso: string) => Date.parse(iso);

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
  });
}
