import { describe, it, expect, beforeEach } from "vitest";
import type { UnmatchedEventRepository } from "@/lib/data/unmatched-events";

export type UnmatchedEventContractContext = {
  repo: () => UnmatchedEventRepository;
  /** A string no other run has used. */
  unique: (label: string) => string;
  /** Stores calendar items (a queued row must point at one) and returns their Hub ids in order. */
  calendarEvents: (labels: string[]) => Promise<string[]>;
  /** Stores a prickle type (a resolved row may point at one) and returns its id. */
  prickleType: (label: string) => Promise<string>;
  /** Removes what this context stored. */
  clear: () => Promise<void>;
};

const NOBODY = "00000000-0000-4000-8000-000000000000";

/** Behavior every `UnmatchedEventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineUnmatchedEventContract(name: string, setup: () => UnmatchedEventContractContext) {
  describe(`${name} (UnmatchedEventRepository contract)`, () => {
    let ctx: UnmatchedEventContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    /** Queues one new item for a fresh calendar item and returns what was queued. */
    const calendarEvent = async (label: string) => (await ctx.calendarEvents([label]))[0];
    const queueOne = async (label: string, extra: Record<string, unknown> = {}) => {
      const calendar_event_id = await calendarEvent(label);
      const row = { calendar_event_id, raw_summary: `Summary ${label}`, suggested_type: `Type ${label}`, suggested_host: `Host ${label}`, status: "pending", ...extra };
      await ctx.repo().queue([row]);
      return row;
    };
    /** Our pending rows (the table is shared with other tests), found by calendar item. */
    const mine = async (rows: { calendar_event_id: string }[]) => {
      const pending = await ctx.repo().pending();
      return pending.filter((p) => rows.some((r) => r.calendar_event_id === p.calendar_event_id));
    };

    it("queues items for review and lists them newest first", async () => {
      const before = await ctx.repo().countPending();
      const a = await queueOne("a", { created_at: "2000-01-02T00:00:00Z" });
      const b = await queueOne("b", { created_at: "2000-01-03T00:00:00Z" });

      expect(await ctx.repo().countPending()).toBe(before + 2);
      const listed = await mine([a, b]);
      expect(listed.map((r) => r.calendar_event_id)).toEqual([b.calendar_event_id, a.calendar_event_id]);
      expect(listed[1]).toMatchObject({ raw_summary: a.raw_summary, suggested_type: a.suggested_type, suggested_host: a.suggested_host, status: "pending" });
      await ctx.repo().queue([]); // nothing to do
    });

    it("queuing an item again replaces its row and keeps its id, even after it was decided", async () => {
      const a = await queueOne("a");
      const [first] = await mine([a]);
      await ctx.repo().markIgnored([first.id], "2099-01-01T00:00:00Z");
      expect(await mine([a])).toEqual([]);

      await ctx.repo().queue([{ ...a, suggested_type: "Renamed" }]);
      const [again] = await mine([a]);
      expect(again).toMatchObject({ id: first.id, suggested_type: "Renamed", status: "pending" });
    });

    it("records resolving and ignoring as decisions, and they leave the queue", async () => {
      const a = await queueOne("a");
      const b = await queueOne("b");
      const c = await queueOne("c");
      const type = await ctx.prickleType("t");
      const queued = await mine([a, b]);
      const [ra, rb] = [a, b].map((x) => queued.find((q) => q.calendar_event_id === x.calendar_event_id)!);

      await ctx.repo().markResolved([ra.id], type, "2099-01-01T00:00:00Z");
      await ctx.repo().markIgnored([rb.id], "2099-01-02T00:00:00Z");
      await ctx.repo().markResolved([], type, "2099-01-01T00:00:00Z");
      await ctx.repo().markIgnored([], "2099-01-01T00:00:00Z");

      expect((await mine([a, b, c])).map((r) => r.calendar_event_id)).toEqual([c.calendar_event_id]);
      const decisions = (await ctx.repo().decisions()).filter((d) => [a, b, c].some((x) => x.calendar_event_id === d.calendar_event_id));
      expect(Object.fromEntries(decisions.map((d) => [d.calendar_event_id, [d.status, d.resolved_type_id]]))).toEqual({
        [a.calendar_event_id]: ["resolved", type],
        [b.calendar_event_id]: ["ignored", null],
      });
    });

    it("reads, adds and changes the decision of one calendar item", async () => {
      const calendarEventId = await calendarEvent("solo");
      expect(await ctx.repo().existsForCalendarEvent(calendarEventId)).toBe(false);
      expect(await ctx.repo().valuesFor(calendarEventId)).toBeNull();

      await ctx.repo().insert({ calendar_event_id: calendarEventId, raw_summary: "Solo", status: "resolved", resolved_title: "Set by hand" });
      expect(await ctx.repo().existsForCalendarEvent(calendarEventId)).toBe(true);
      expect(await ctx.repo().valuesFor(calendarEventId)).toEqual({
        resolved_type_id: null,
        resolved_host_id: null,
        resolved_title: "Set by hand",
        resolved_description: null,
        resolved_guest_speaker: null,
        resolved_location: null,
      });

      await ctx.repo().updateForCalendarEvent(calendarEventId, { resolved_title: null, resolved_guest_speaker: "Guest" });
      expect(await ctx.repo().valuesFor(calendarEventId)).toMatchObject({ resolved_title: null, resolved_guest_speaker: "Guest" });
      expect(await ctx.repo().existsForCalendarEvent(NOBODY)).toBe(false);

      await expect(ctx.repo().insert({ calendar_event_id: calendarEventId, raw_summary: "Again" })).rejects.toThrow();
    });

    it("removes only the items still waiting when their calendar items are reprocessed", async () => {
      const waiting = await queueOne("waiting");
      const decided = await queueOne("decided");
      const rd = (await mine([decided]))[0];
      await ctx.repo().markIgnored([rd.id], "2099-01-01T00:00:00Z");

      await ctx.repo().deletePendingForCalendarEvents([waiting.calendar_event_id, decided.calendar_event_id, NOBODY]);
      await ctx.repo().deletePendingForCalendarEvents([]);

      expect(await mine([waiting, decided])).toEqual([]);
      expect(await ctx.repo().existsForCalendarEvent(waiting.calendar_event_id)).toBe(false);
      expect(await ctx.repo().existsForCalendarEvent(decided.calendar_event_id)).toBe(true);
    });

    it("lists the items queued before a time, oldest first, up to a limit, leaving out decided ones", async () => {
      const old1 = await queueOne("old1", { created_at: "2000-01-02T00:00:00Z" });
      const old2 = await queueOne("old2", { created_at: "2000-01-03T00:00:00Z" });
      await queueOne("recent", { created_at: "2000-02-01T00:00:00Z" });
      const decided = await queueOne("decided", { created_at: "2000-01-01T12:00:00Z" });
      const [rd] = await mine([decided]);
      await ctx.repo().markIgnored([rd.id], "2099-01-01T00:00:00Z");

      const rows = await ctx.repo().pendingQueuedBefore("2000-01-10T00:00:00Z", 100);
      const ours = rows.filter((r) => r.raw_summary.startsWith("Summary old"));
      expect(ours.map((r) => r.raw_summary)).toEqual([old1.raw_summary, old2.raw_summary]);
      expect(ours[0]).toMatchObject({ created_at: expect.any(String) });
      expect(rows.some((r) => r.raw_summary === decided.raw_summary)).toBe(false);
      expect(rows.some((r) => r.raw_summary === "Summary recent")).toBe(false);
      expect((await ctx.repo().pendingQueuedBefore("2000-01-10T00:00:00Z", 1)).length).toBe(1);
    });

    it("reads past 1000 rows and writes in chunks", async () => {
      const total = 1005;
      const ids = await ctx.calendarEvents(Array.from({ length: total }, (_, i) => `bulk-${i}`));
      const rows = ids.map((calendar_event_id, i) => ({ calendar_event_id, raw_summary: `Bulk ${i}` }));
      await ctx.repo().queue(rows);

      const listed = await mine(rows);
      expect(listed).toHaveLength(total);
      expect(new Set(listed.map((r) => r.id)).size).toBe(total);

      await ctx.repo().markIgnored(listed.map((r) => r.id), "2099-01-01T00:00:00Z");
      expect(await mine(rows)).toEqual([]);
      const decided = (await ctx.repo().decisions()).filter((d) => rows.some((r) => r.calendar_event_id === d.calendar_event_id));
      expect(decided).toHaveLength(total);
    }, 120_000);
  });
}
