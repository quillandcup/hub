import { describe, it, expect, beforeEach } from "vitest";
import type { ReminderLogRepository } from "@/lib/data/reminder-log";

export type ReminderLogContractContext = {
  repo: () => ReminderLogRepository;
  memberIds: readonly [string, string];
  reset: () => Promise<void>;
};

/** Behavior every `ReminderLogRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineReminderLogContract(name: string, setup: () => ReminderLogContractContext) {
  describe(`${name} (ReminderLogRepository contract)`, () => {
    let ctx: ReminderLogContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.reset();
    });

    const day1 = new Date("2097-03-01T15:00:00Z");
    const day2 = new Date("2097-03-02T15:00:00Z");

    it("lets one run claim a member's reminder of a kind for the day, and refuses a second", async () => {
      const [a, b] = ctx.memberIds;

      expect(await ctx.repo().claim(a, "intro_nudge", day1)).toBe(true);
      expect(await ctx.repo().claim(a, "intro_nudge", new Date(day1.getTime() + 3_600_000))).toBe(false); // same day
      expect(await ctx.repo().claim(a, "prickle_nudge", day1)).toBe(true); // another kind
      expect(await ctx.repo().claim(b, "intro_nudge", day1)).toBe(true); // another member
      expect(await ctx.repo().claim(a, "intro_nudge", day2)).toBe(true); // another day
    });

    it("gives up a claim so the reminder can be tried again that day", async () => {
      const [a] = ctx.memberIds;
      await ctx.repo().claim(a, "intro_nudge", day1);

      await ctx.repo().release(a, "intro_nudge", day1);

      expect(await ctx.repo().claim(a, "intro_nudge", day1)).toBe(true);
      await ctx.repo().release(a, "intro_nudge", day2); // nothing claimed that day: harmless
    });

    it("lists when each reminder went out, by member and kind", async () => {
      const [a, b] = ctx.memberIds;
      await ctx.repo().claim(a, "intro_nudge", day1);
      await ctx.repo().claim(a, "intro_nudge", day2);
      await ctx.repo().claim(b, "prickle_nudge", day1);

      const log = await ctx.repo().sentTimes([a, b, "mbr_ZZZZZZZZZZZZ"]);

      expect(log.get(`${a}:intro_nudge`)?.map((d) => d.toISOString()).sort()).toEqual([day1.toISOString(), day2.toISOString()]);
      expect(log.get(`${b}:prickle_nudge`)?.map((d) => d.toISOString())).toEqual([day1.toISOString()]);
      expect(log.has(`${a}:prickle_nudge`)).toBe(false);
      expect(await ctx.repo().sentTimes([])).toEqual(new Map());
    });
  });
}
