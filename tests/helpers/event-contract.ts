import { describe, it, expect, beforeEach } from "vitest";
import type { EventRepository } from "@/lib/data/events";

export type SeedEvent = { key: string; title: string; startsAt: string };

export type EventContractContext = {
  repo: () => EventRepository;
  /** Replaces the events this context created with these; returns each one's id by its key. */
  seed: (events: SeedEvent[]) => Promise<Record<string, string>>;
};

/** Behavior every `EventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineEventContract(name: string, setup: () => EventContractContext) {
  describe(`${name} (EventRepository contract)`, () => {
    let ctx: EventContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists events for a picker, newest first", async () => {
      const ids = await ctx.seed([
        { key: "old", title: "Spring Retreat", startsAt: "2097-03-01T09:00:00Z" },
        { key: "new", title: "Autumn Retreat", startsAt: "2097-09-01T09:00:00Z" },
        { key: "mid", title: "Summer Workshop", startsAt: "2097-06-01T09:00:00Z" },
      ]);

      const ours = (await ctx.repo().choices()).filter((e) => Object.values(ids).includes(e.id));

      expect(ours.map((e) => [e.title, e.starts_at.slice(0, 10)])).toEqual([
        ["Autumn Retreat", "2097-09-01"],
        ["Summer Workshop", "2097-06-01"],
        ["Spring Retreat", "2097-03-01"],
      ]);
    });

    // --- photos ---
    describe("photos", () => {
      const missingId = "00000000-0000-4000-8000-000000000001";
      const seedTwo = async () => {
        const ids = await ctx.seed([
          { key: "a", title: "Photo Retreat", startsAt: "2097-03-01T09:00:00Z" },
          { key: "b", title: "Other Retreat", startsAt: "2097-04-01T09:00:00Z" },
        ]);
        return { a: ids.a, b: ids.b };
      };

      it("lists the imported media item ids of one event, hidden photos included", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.jpg`, google_media_item_id: "m1" });
        const hidden = await repo.addPhoto({ event_id: a, storage_path: `${a}/m2.jpg`, google_media_item_id: "m2" });
        await repo.addPhoto({ event_id: b, storage_path: `${b}/m3.jpg`, google_media_item_id: "m3" });
        await repo.setPhotoHidden(a, hidden.id, true);

        expect([...(await repo.importedPhotoIds(a))].sort()).toEqual(["m1", "m2"]);
        expect([...(await repo.importedPhotoIds(b))]).toEqual(["m3"]);
      });

      it("stores the photo's details and refuses the same media item twice for one event", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({
          event_id: a,
          storage_path: `${a}/p.jpg`,
          google_media_item_id: "m1",
          width: 800,
          height: 600,
          mime_type: "image/jpeg",
          taken_at: "2097-03-01T10:00:00+00:00",
        });

        expect(photo).toMatchObject({ event_id: a, storage_path: `${a}/p.jpg`, google_media_item_id: "m1", width: 800, height: 600, mime_type: "image/jpeg", hidden_at: null });
        await expect(repo.addPhoto({ event_id: a, storage_path: `${a}/again.jpg`, google_media_item_id: "m1" })).rejects.toThrow();
        await expect(repo.addPhoto({ event_id: b, storage_path: `${b}/m1.jpg`, google_media_item_id: "m1" })).resolves.toMatchObject({ event_id: b });
      });

      it("hides and unhides a photo of its own event only", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.jpg`, google_media_item_id: "m1" });

        expect((await repo.setPhotoHidden(a, photo.id, true))?.hidden_at).toBeTruthy();
        expect((await repo.photoFile(a, photo.id))?.hidden_at).toBeTruthy();
        expect((await repo.setPhotoHidden(a, photo.id, false))?.hidden_at).toBeNull();
        expect(await repo.setPhotoHidden(b, photo.id, true)).toBeNull();
        expect((await repo.photoFile(a, photo.id))?.hidden_at).toBeNull();
      });

      it("gives the image proxy a photo's file and type, and nothing for another event's or a missing one", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.png`, google_media_item_id: "m1", mime_type: "image/png" });

        expect(await repo.photoFile(a, photo.id)).toEqual({ storage_path: `${a}/m1.png`, mime_type: "image/png", hidden_at: null });
        expect(await repo.photoFile(b, photo.id)).toBeNull();
        expect(await repo.photoFile(a, missingId)).toBeNull();
        expect(await repo.setPhotoHidden(a, missingId, true)).toBeNull();
      });
    });
  });
}

// --- calendar sync ---

export type SyncSeedEvent = {
  key: string;
  /** Whether it follows a calendar event (default true). */
  calendar?: boolean;
  /** Only the calendar event, no events row. */
  eventless?: boolean;
  automatic?: boolean;
  overridden?: string[];
  hidden?: boolean;
  photo?: boolean;
};

export type SyncSeedResult = {
  events: Record<string, string>;
  slugs: Record<string, string>;
  calendars: Record<string, string>;
};

export type EventSyncContext = {
  repo: () => EventRepository;
  /** Replaces what this context seeded before with these events and the calendar events they follow. */
  seed: (events: SyncSeedEvent[]) => Promise<SyncSeedResult>;
  /** The event row now, or null (so a test can see what a write did). */
  read: (id: string) => Promise<{ title: string; automatic: boolean } | null>;
};

/** Calendar sync behavior of an `EventRepository`; run against the in-memory twin (unit) and Supabase (db). */
export function defineEventSyncContract(name: string, setup: () => EventSyncContext) {
  describe(`${name} (EventRepository calendar sync contract)`, () => {
    let ctx: EventSyncContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("finds the event that follows a calendar event, hidden or not", async () => {
      const s = await ctx.seed([{ key: "shown" }, { key: "hidden", hidden: true, automatic: true }, { key: "free", eventless: true }]);

      expect(await ctx.repo().byCalendarEventId(s.calendars.shown)).toEqual({ id: s.events.shown, slug: s.slugs.shown, hidden: false, automatic: false });
      expect(await ctx.repo().byCalendarEventId(s.calendars.hidden)).toMatchObject({ id: s.events.hidden, hidden: true, automatic: true });
      expect(await ctx.repo().byCalendarEventId(s.calendars.free)).toBeNull();
    });

    it("says which calendar events already have an event, hidden ones included", async () => {
      const s = await ctx.seed([{ key: "a" }, { key: "b", hidden: true }, { key: "c", eventless: true }]);

      const have = await ctx.repo().calendarEventIdsWithEvent([s.calendars.a, s.calendars.b, s.calendars.c]);

      expect([...have].sort()).toEqual([s.calendars.a, s.calendars.b].sort());
      expect((await ctx.repo().calendarEventIdsWithEvent([])).size).toBe(0);
    });

    it("lists the followers of calendar events with their overridden fields", async () => {
      const s = await ctx.seed([{ key: "a", overridden: ["title"] }, { key: "b" }, { key: "c", eventless: true }]);

      const linked = await ctx.repo().linkedToCalendarEvents([s.calendars.a, s.calendars.b, s.calendars.c]);

      expect(linked.sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(
        [
          { id: s.events.a, calendarEventId: s.calendars.a, overriddenFields: ["title"] },
          { id: s.events.b, calendarEventId: s.calendars.b, overriddenFields: [] },
        ].sort((x, y) => (x.id < y.id ? -1 : 1)),
      );
    });

    it("creates an event for a calendar event, and reports a taken calendar event or slug as a conflict", async () => {
      const s = await ctx.seed([{ key: "taken" }, { key: "free", eventless: true }]);
      const row = (calendar: string, slug: string) => ({
        title: "Made by the sync",
        slug,
        event_type: "other" as const,
        starts_at: "2185-05-02",
        ends_at: "2185-05-02",
        calendar_event_id: calendar,
        automatic: true,
      });

      expect(await ctx.repo().createFromCalendar(row(s.calendars.taken, `${s.slugs.taken}-x`))).toEqual({ status: "conflict", on: "calendar_event" });
      expect(await ctx.repo().createFromCalendar(row(s.calendars.free, s.slugs.taken))).toEqual({ status: "conflict", on: "slug" });
      const made = await ctx.repo().createFromCalendar(row(s.calendars.free, `${s.slugs.taken}-y`));

      expect(made).toMatchObject({ status: "created", event: { slug: `${s.slugs.taken}-y` } });
      expect(await ctx.repo().byCalendarEventId(s.calendars.free)).toMatchObject({ slug: `${s.slugs.taken}-y`, automatic: true });
    });

    it("writes columns to one event and leaves the others alone", async () => {
      const s = await ctx.seed([{ key: "a", automatic: true }, { key: "b", automatic: true }]);

      await ctx.repo().update(s.events.a, { title: "Retitled", automatic: false });

      expect(await ctx.read(s.events.a)).toEqual({ title: "Retitled", automatic: false });
      expect(await ctx.read(s.events.b)).toMatchObject({ automatic: true });
    });

    it("lists automatic events by calendar event, and those whose calendar event is gone", async () => {
      const s = await ctx.seed([{ key: "auto", automatic: true }, { key: "hand" }, { key: "orphan", calendar: false, automatic: true }, { key: "plain", calendar: false }]);

      const following = await ctx.repo().automaticFollowing([s.calendars.auto, s.calendars.hand]);
      const orphans = await ctx.repo().automaticWithoutCalendarEvent();

      expect(following).toEqual([{ id: s.events.auto, calendarEventId: s.calendars.auto }]);
      expect(orphans).toContain(s.events.orphan);
      expect(orphans).not.toContain(s.events.plain);
      expect(await ctx.repo().automaticFollowing([])).toEqual([]);
    });

    it("finds the events that have a photo, and deletes events by id", async () => {
      const s = await ctx.seed([{ key: "with", photo: true }, { key: "without" }, { key: "other" }]);

      const worked = await ctx.repo().idsWithPhotosOrAttendees([s.events.with, s.events.without]);
      await ctx.repo().deleteByIds([s.events.with, s.events.without]);

      expect([...worked]).toEqual([s.events.with]);
      expect(await ctx.read(s.events.with)).toBeNull();
      expect(await ctx.read(s.events.without)).toBeNull();
      expect(await ctx.read(s.events.other)).not.toBeNull();
    });
  });
}
