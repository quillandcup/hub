import { describe, it, expect, beforeEach } from "vitest";
import type { WheelOfWonderRepository } from "@/lib/data/wheel-of-wonder";

export type WheelContractContext = {
  repo: () => WheelOfWonderRepository;
  /** Two members that exist: "Ada Example" and "Fern Example". */
  members: [string, string];
  /** A value no other run used (a Slack channel id). Every match a test records carries one, so `clear` can find it. */
  unique: (label: string) => string;
  /** Removes the matches this context made. */
  clear: () => Promise<void>;
};

/** Behavior every `WheelOfWonderRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineWheelOfWonderContract(name: string, setup: () => WheelContractContext) {
  describe(`${name} (WheelOfWonderRepository contract)`, () => {
    let ctx: WheelContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const propose = (channel: string, spinnerFirst = true) =>
      ctx.repo().recordProposed({
        spinnerMemberId: ctx.members[spinnerFirst ? 0 : 1],
        matchedMemberId: ctx.members[spinnerFirst ? 1 : 0],
        slackChannelId: channel,
        spinnerSlackUserId: "U_SPINNER",
        matchedSlackUserId: null,
      });

    it("records a proposed match with no messages counted, and finds it by its Slack room", async () => {
      const room = ctx.unique("room");
      await propose(room);

      expect(await ctx.repo().proposedInChannel(room)).toEqual({
        id: expect.any(String),
        spinner_member_id: ctx.members[0],
        matched_member_id: ctx.members[1],
        spinner_slack_user_id: "U_SPINNER",
        matched_slack_user_id: null,
        spinner_message_count: 0,
        matched_message_count: 0,
      });
      expect(await ctx.repo().proposedInChannel(ctx.unique("other-room"))).toBeNull();
    });

    it("saves message counts, then confirms the match, which is no longer proposed", async () => {
      const room = ctx.unique("room");
      await propose(room);
      const before = await ctx.repo().confirmedCount();
      const match = (await ctx.repo().proposedInChannel(room))!;

      await ctx.repo().recordExchange(match.id, { spinnerMessageCount: 2, matchedMessageCount: 0 });
      expect(await ctx.repo().proposedInChannel(room)).toMatchObject({ id: match.id, spinner_message_count: 2, matched_message_count: 0 });
      expect(await ctx.repo().confirmedCount()).toBe(before);

      await ctx.repo().recordExchange(match.id, {
        spinnerMessageCount: 3,
        matchedMessageCount: 3,
        confirmed: { at: "2097-01-02T03:04:05.000Z", byMemberId: ctx.members[1] },
      });
      expect(await ctx.repo().proposedInChannel(room)).toBeNull();
      expect(await ctx.repo().confirmedCount()).toBe(before + 1);
      const confirmed = (await ctx.repo().recent(1000)).find((m) => m.id === match.id)!;
      expect(confirmed).toMatchObject({ status: "confirmed", spinner_message_count: 3, matched_message_count: 3 });
      expect(new Date(confirmed.confirmed_at!).toISOString()).toBe("2097-01-02T03:04:05.000Z");
    });

    it("lists the newest matches first, with the two members' names, at most the limit", async () => {
      await propose(ctx.unique("older"));
      await propose(ctx.unique("newer"), false);

      const recent = await ctx.repo().recent(1000);
      const mine = recent.filter((m) => m.spinner?.id === ctx.members[0] || m.spinner?.id === ctx.members[1]);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(mine[0]).toMatchObject({ status: "proposed", confirmed_at: null, spinner: { id: ctx.members[1] }, matched: { id: ctx.members[0] } });
      expect(mine[1].spinner).toEqual({ id: ctx.members[0], name: expect.stringContaining("Ada Example") });
      expect(mine[1].matched).toEqual({ id: ctx.members[1], name: expect.stringContaining("Fern Example") });
      expect((await ctx.repo().recent(1)).length).toBe(1);
    });
  });
}
