import { describe, it, expect, beforeEach } from "vitest";
import { CLAIM_STALE_MS, type CalendarSyncStateRepository } from "@/lib/data/calendar-sync-state";

export type CalendarSyncStateContractContext = {
  repo: () => CalendarSyncStateRepository;
  /** A calendar id no other test or run uses. */
  calendarId: () => string;
  /** The stored state of a calendar, or null when it has no row. */
  stored: (calendarId: string) => Promise<{ running_since: string | null; rerun_requested: boolean; synced_through: string | null } | null>;
};

const NOW = new Date("2026-10-28T12:00:00Z");

/** Behavior every `CalendarSyncStateRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCalendarSyncStateContract(name: string, setup: () => CalendarSyncStateContractContext) {
  describe(`${name} (CalendarSyncStateRepository contract)`, () => {
    let ctx: CalendarSyncStateContractContext;
    let cal: string;
    beforeEach(() => {
      ctx = setup();
      cal = ctx.calendarId();
    });

    it("gives the claim to one caller and notes a rerun for the others", async () => {
      const repo = ctx.repo();
      expect(await repo.claim(cal, NOW)).toEqual({ claimed: true, syncedThrough: null });
      expect(await repo.claim(cal, NOW)).toEqual({ claimed: false });
      expect(await repo.claim(cal, NOW)).toEqual({ claimed: false });
      const held = (await ctx.stored(cal))!;
      expect(new Date(held.running_since!).toISOString()).toBe(NOW.toISOString());
      expect(held.rerun_requested).toBe(true);
    });

    it("lets only one of simultaneous callers win", async () => {
      const repo = ctx.repo();
      const results = await Promise.all(Array.from({ length: 5 }, () => repo.claim(cal, NOW)));
      expect(results.filter((r) => r.claimed)).toHaveLength(1);
    });

    it("releases when nobody asked for a rerun; otherwise keeps the claim and clears the request", async () => {
      const repo = ctx.repo();
      await repo.claim(cal, NOW);
      expect(await repo.release(cal, NOW)).toBe(true);
      expect((await ctx.stored(cal))!.running_since).toBeNull();

      await repo.claim(cal, NOW);
      await repo.claim(cal, NOW); // a notification meanwhile
      expect(await repo.release(cal, NOW)).toBe(false);
      expect(await ctx.stored(cal)).toMatchObject({ rerun_requested: false });
      expect((await ctx.stored(cal))!.running_since).not.toBeNull();
      expect(await repo.release(cal, NOW)).toBe(true);
    });

    it("answers a release for a calendar with no row as a kept claim", async () => {
      expect(await ctx.repo().release(cal, NOW)).toBe(false);
    });

    it("takes over a claim that has been held longer than the stale limit, and not before", async () => {
      const repo = ctx.repo();
      await repo.claim(cal, NOW);
      const almost = new Date(NOW.getTime() + CLAIM_STALE_MS - 1000);
      expect(await repo.claim(cal, almost)).toEqual({ claimed: false });
      const stale = new Date(NOW.getTime() + CLAIM_STALE_MS + 1000);
      expect(await repo.claim(cal, stale)).toMatchObject({ claimed: true });
    });

    it("hands the watermark to whoever claims next, and abandoning leaves it alone", async () => {
      const repo = ctx.repo();
      await repo.claim(cal, NOW);
      await repo.saveSyncedThrough(cal, NOW);
      await repo.abandon(cal);
      expect((await ctx.stored(cal))!.running_since).toBeNull();

      const next = await repo.claim(cal, new Date(NOW.getTime() + 60_000));
      expect(next).toMatchObject({ claimed: true });
      expect((next as { syncedThrough: Date }).syncedThrough.toISOString()).toBe(NOW.toISOString());
    });

    it("abandoning a calendar with no row does nothing", async () => {
      await ctx.repo().abandon(cal);
      expect(await ctx.stored(cal)).toBeNull();
    });

    it("saves a watermark for a calendar with no row yet", async () => {
      await ctx.repo().saveSyncedThrough(cal, NOW);
      expect(new Date((await ctx.stored(cal))!.synced_through!).toISOString()).toBe(NOW.toISOString());
    });

    describe("push channels", () => {
      const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

      it("lists a calendar's channels that were not stopped, latest expiry first", async () => {
        const repo = ctx.repo();
        await repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-soon`, resourceId: "res-soon", expiresAt: days(1) });
        await repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-late`, resourceId: "res-late", expiresAt: days(6) });
        await repo.saveWatchChannel({ calendarId: ctx.calendarId(), channelId: `${cal}-other`, resourceId: "res-other", expiresAt: days(9) });

        const active = await repo.activeWatchChannels(cal);

        expect(active.map((c) => [c.channelId, c.resourceId, new Date(c.expiresAt).toISOString()])).toEqual([
          [`${cal}-late`, "res-late", days(6).toISOString()],
          [`${cal}-soon`, "res-soon", days(1).toISOString()],
        ]);
        expect(await repo.activeWatchChannels(ctx.calendarId())).toEqual([]);
      });

      it("keeps a stopped channel out of the list, and marking one that is gone does nothing", async () => {
        const repo = ctx.repo();
        await repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-a`, resourceId: "res-a", expiresAt: days(2) });
        await repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-b`, resourceId: "res-b", expiresAt: days(5) });
        const [first, second] = await repo.activeWatchChannels(cal);

        await repo.markWatchChannelStopped(second.id, NOW);
        await repo.markWatchChannelStopped("cwch_NotARealIdXX", NOW);

        expect((await repo.activeWatchChannels(cal)).map((c) => c.id)).toEqual([first.id]);
      });

      it("refuses a channel id it already has", async () => {
        const repo = ctx.repo();
        await repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-dup`, resourceId: "res-1", expiresAt: days(2) });

        await expect(repo.saveWatchChannel({ calendarId: cal, channelId: `${cal}-dup`, resourceId: "res-2", expiresAt: days(2) })).rejects.toThrow();
      });
    });
  });
}
