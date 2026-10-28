import { describe, it, expect, beforeEach } from "vitest";
import type { CalendarEventRepository, NewCalendarSourceEvent } from "@/lib/data/calendar-events";

export type CalendarEventContractContext = {
  repo: () => CalendarEventRepository;
  /** A Google id no other run has used. Everything a test makes through the repository is cleaned up by this prefix. */
  unique: (label: string) => string;
  /** Removes every item this context made. */
  clear: () => Promise<void>;
};

const at = (day: number, hour = 9) => new Date(Date.UTC(2097, 5, day, hour)).toISOString();
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

/** Behavior every `CalendarEventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineCalendarEventContract(name: string, setup: () => CalendarEventContractContext) {
  describe(`${name} (CalendarEventRepository contract)`, () => {
    let ctx: CalendarEventContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const item = (label: string, day: number, extra: Partial<NewCalendarSourceEvent> = {}): NewCalendarSourceEvent => ({
      google_event_id: ctx.unique(label),
      summary: `Calendar ${label}`,
      start_time: at(day),
      end_time: at(day, 10),
      raw_data: { label },
      ...extra,
    });
    /** Upserts the items and returns each one's Hub id by Google id. */
    const store = async (...items: NewCalendarSourceEvent[]) => {
      await ctx.repo().upsert(items);
      const stored = await ctx.repo().startingBetween(at(1, 0), at(30, 0));
      return new Map(stored.map((s) => [s.google_event_id, s.id]));
    };

    it("stores items and reads them back by Hub id, one or many", async () => {
      const a = item("a", 3, { description: "Notes", location: "Lakehouse" });
      const b = item("b", 4);
      const ids = await store(a, b);

      expect(await ctx.repo().byId(ids.get(a.google_event_id)!)).toMatchObject({ google_event_id: a.google_event_id, summary: "Calendar a", description: "Notes", location: "Lakehouse" });
      expect(await ctx.repo().byId("00000000-0000-4000-8000-000000000000")).toBeNull();
      expect((await ctx.repo().byIds([ids.get(a.google_event_id)!, ids.get(b.google_event_id)!, "00000000-0000-4000-8000-000000000000"])).map((e) => e.google_event_id).sort()).toEqual(
        [a.google_event_id, b.google_event_id].sort()
      );
      expect(await ctx.repo().byIds([])).toEqual([]);
    });

    it("replaces an item with the same Google id and keeps its Hub id, so links to it survive", async () => {
      const a = item("replace", 5);
      const before = await store(a);
      const countBefore = await ctx.repo().count();

      await ctx.repo().upsert([{ ...a, summary: "Renamed" }]);

      expect(await ctx.repo().count()).toBe(countBefore);
      const after = await ctx.repo().byId(before.get(a.google_event_id)!);
      expect(after).toMatchObject({ summary: "Renamed", google_event_id: a.google_event_id });
      await ctx.repo().upsert([]); // nothing to do
    });

    it("lists items overlapping a range and items starting within one, by start time", async () => {
      const early = item("early", 6);
      const spanning = item("spanning", 7, { start_time: at(7, 20), end_time: at(8, 4) });
      const late = item("late", 9);
      await store(late, early, spanning);

      // [06 00:00, 08 00:00): early (06), and spanning (starts the 7th, so it overlaps).
      const mine = (rows: { google_event_id: string }[]) => rows.filter((e) => [early, spanning, late].some((x) => x.google_event_id === e.google_event_id)).map((e) => e.google_event_id);
      expect(mine(await ctx.repo().overlapping(at(6, 0), at(8, 0)))).toEqual([early.google_event_id, spanning.google_event_id]);
      // One that only ends at the range's start doesn't overlap it (end must be after the start).
      expect((await ctx.repo().overlapping(at(6, 10), at(6, 12))).some((e) => e.google_event_id === early.google_event_id)).toBe(false);

      expect(mine(await ctx.repo().startingBetween(at(7, 0), at(9, 9)))).toEqual([spanning.google_event_id, late.google_event_id]);
    });

    it("reads past a thousand items, in both range reads", async () => {
      const bulk = Array.from({ length: 1050 }, (_, i) => item(`bulk-${i}`, 25, { start_time: at(25, 0), end_time: at(25, 1) }));
      await ctx.repo().upsert(bulk);
      const mine = (rows: { google_event_id: string }[]) => rows.filter((e) => e.google_event_id.includes("bulk-")).length;

      expect(mine(await ctx.repo().overlapping(at(24, 12), at(25, 12)))).toBe(1050);
      expect(mine(await ctx.repo().startingBetween(at(25, 0), at(25, 0)))).toBe(1050);
    });

    it("writes columns to one item and stamps items as synced", async () => {
      const a = item("touch-a", 10);
      const b = item("touch-b", 11);
      const ids = await store(a, b);

      await ctx.repo().update(ids.get(a.google_event_id)!, { summary: "Edited", location: "Elsewhere" });
      expect(await ctx.repo().byId(ids.get(a.google_event_id)!)).toMatchObject({ summary: "Edited", location: "Elsewhere" });

      await ctx.repo().touchImported([a.google_event_id, b.google_event_id], "2099-01-01T00:00:00Z");
      expect(ms((await ctx.repo().byId(ids.get(a.google_event_id)!))!.imported_at)).toBe(ms("2099-01-01T00:00:00Z"));
      expect(ms(await ctx.repo().lastImportedAt())).toBe(ms("2099-01-01T00:00:00Z"));
      await ctx.repo().touchImported([], "2099-01-02T00:00:00Z");
    });

    it("reports the stored span and count", async () => {
      const first = item("span-first", 12, { start_time: at(12, 0), end_time: at(12, 1) });
      const last = item("span-last", 13, { start_time: at(13, 0), end_time: at(14, 23) });
      const countBefore = await ctx.repo().count();
      await store(first, last);

      expect(await ctx.repo().count()).toBe(countBefore + 2);
      const span = (await ctx.repo().span())!;
      expect(ms(span.start)).toBeLessThanOrEqual(ms(first.start_time)!);
      expect(ms(span.end)).toBeGreaterThanOrEqual(ms(last.end_time)!);
    });

    it("removes the items in a range that left the calendar, keeps the rest, and does nothing for an empty list", async () => {
      const keep = item("stale-keep", 15);
      const gone = item("stale-gone", 16);
      const outside = item("stale-outside", 20);
      const boundary = item("stale-boundary", 17, { start_time: at(17, 0), end_time: at(17, 1) });
      const ids = await store(keep, gone, outside, boundary);
      const range = { from: at(15, 0), to: at(17, 0) }; // the end is not included

      expect(await ctx.repo().deleteStale(range, [])).toBe(0);
      expect(await ctx.repo().byId(ids.get(gone.google_event_id)!)).not.toBeNull();

      expect(await ctx.repo().deleteStale(range, [keep.google_event_id])).toBe(1);
      expect(await ctx.repo().byId(ids.get(gone.google_event_id)!)).toBeNull();
      expect(await ctx.repo().byId(ids.get(keep.google_event_id)!)).not.toBeNull();
      expect(await ctx.repo().byId(ids.get(outside.google_event_id)!)).not.toBeNull();
      expect(await ctx.repo().byId(ids.get(boundary.google_event_id)!)).not.toBeNull();
    });
  });
}
