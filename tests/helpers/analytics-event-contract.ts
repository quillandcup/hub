import { describe, it, expect, beforeEach } from "vitest";
import type { AnalyticsEventRepository, NewAnalyticsEvent } from "@/lib/data/analytics-events";

export type AnalyticsEventContractContext = {
  repo: () => AnalyticsEventRepository;
  /** A signed-in Hub user (a Supabase Auth user) to attribute events to. */
  newUserId: () => Promise<string>;
  /** What is stored for a user: the message id and source of each event. */
  stored: (userId: string) => Promise<{ message_id: string; source: string; event: string }[]>;
};

const event = (userId: string, overrides: Partial<NewAnalyticsEvent> = {}): NewAnalyticsEvent => ({
  message_id: crypto.randomUUID(),
  user_id: userId,
  session_id: crypto.randomUUID(),
  source: "client",
  event: "page_viewed",
  properties: { route: "/dashboard" },
  context: {},
  sudo: false,
  occurred_at: "2097-03-01T12:00:00Z",
  ...overrides,
});

/** Behavior every `AnalyticsEventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineAnalyticsEventContract(name: string, setup: () => AnalyticsEventContractContext) {
  describe(`${name} (AnalyticsEventRepository contract)`, () => {
    let ctx: AnalyticsEventContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("stores events, and refuses a message id it already has for the user", async () => {
      const userId = await ctx.newUserId();
      const first = event(userId);

      await ctx.repo().record([first, event(userId, { source: "server" })]);
      await expect(ctx.repo().record([event(userId), first])).rejects.toThrow();

      expect(await ctx.stored(userId)).toHaveLength(2); // the refused batch stored nothing
    });

    it("stores nothing for no events", async () => {
      const userId = await ctx.newUserId();

      await ctx.repo().record([]);
      await ctx.repo().recordIgnoringDuplicates([]);

      expect(await ctx.stored(userId)).toEqual([]);
    });

    it("skips a message id it already has, but keeps the same id for another user", async () => {
      const [alice, bob] = [await ctx.newUserId(), await ctx.newUserId()];
      const retried = event(alice);
      await ctx.repo().recordIgnoringDuplicates([retried]);

      await ctx.repo().recordIgnoringDuplicates([retried, event(alice)]); // a browser sending the batch again
      await ctx.repo().recordIgnoringDuplicates([{ ...retried, user_id: bob }]);

      expect(await ctx.stored(alice)).toHaveLength(2);
      expect(await ctx.stored(bob)).toHaveLength(1);
    });

    it("deletes what a user did and keeps the record of what the app sent them", async () => {
      const [alice, bob] = [await ctx.newUserId(), await ctx.newUserId()];
      await ctx.repo().record([
        event(alice),
        event(alice, { source: "server" }),
        event(alice, { source: "system", event: "notification_sent" }),
        event(bob),
      ]);

      expect(await ctx.repo().deleteUsageEvents(alice)).toBe(2);
      expect(await ctx.repo().deleteUsageEvents(alice)).toBe(0);

      expect((await ctx.stored(alice)).map((e) => e.source)).toEqual(["system"]);
      expect(await ctx.stored(bob)).toHaveLength(1);
    });
  });
}
