import { describe, it, expect, beforeEach } from "vitest";
import type { EventPhotoRow, EventRepository } from "@/lib/data/events";

export type SeedEvent = { key: string; title: string; startsAt: string; calendarEventId?: string; deletedAt?: string };

/** A prickle for an event to stand on. A null title falls back to the name of the event-only prickle type, "Event". */
export type SeedPrickle = { title: string | null; startTime: string; endTime: string; location?: string; guestSpeaker?: string; calendarEventId?: string };

export type EventContractContext = {
  repo: () => EventRepository;
  /** Replaces the events this context created with these; returns each one's id by its key. */
  seed: (events: SeedEvent[]) => Promise<Record<string, string>>;
  // --- admin events ---
  /** Makes an id an event can follow (a calendar event). */
  calendarEvent: () => Promise<string>;
  /** Makes a prickle of the event-only type, returning its id (the event the test creates stands on it). */
  prickle: (p: SeedPrickle) => Promise<string>;
  /** Makes a member, returning the id. */
  member: (m: { name: string; displayName: string | null; email: string }) => Promise<string>;
  attend: (eventId: string, memberId: string, createdAt: string) => Promise<void>;
  photo: (eventId: string, p: { path: string; takenAt: string | null; createdAt: string; hidden?: boolean }) => Promise<string>;
  /** Cleans up an event the test created through the repository. */
  track: (eventId: string) => void;
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

    describe("admin events", () => {
      const NONE = "00000000-0000-4000-8000-000000000000";
      const fields = async (p: Partial<SeedPrickle> = {}, extra: object = {}) => ({
        slug: `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        event_type: "other",
        prickle_id: await ctx.prickle({ title: "Open House", startTime: "2097-05-01T09:00:00Z", endTime: "2097-05-01T10:00:00Z", ...p }),
        ...extra,
      });

      it("creates, reads, updates and deletes an event", async () => {
        const repo = ctx.repo();
        const made = await repo.create(await fields({ location: "Lakehouse", guestSpeaker: "Ada Example" }));
        ctx.track(made.id);
        expect(made).toMatchObject({ title: "Open House", location: "Lakehouse", speakers: "Ada Example", starts_at: "2097-05-01", ends_at: "2097-05-01" });

        expect(await repo.byId(made.id)).toMatchObject({ id: made.id, title: "Open House" });
        expect(await repo.byId(NONE)).toBeNull();
        expect(await repo.bySlug(made.slug)).toMatchObject({ id: made.id, title: "Open House" });
        expect(await repo.bySlug("no-such-slug")).toBeNull();

        const updated = await repo.edit(made.id, { focus: "Craft", automatic: true });
        expect(updated).toMatchObject({ id: made.id, title: "Open House", focus: "Craft", automatic: true });
        await expect(repo.edit(NONE, { focus: "Nope" })).rejects.toThrow();

        await repo.remove(made.id);
        expect(await repo.byId(made.id)).toBeNull();
      });

      it("throws when the database refuses a write", async () => {
        await expect(ctx.repo().create({ focus: "No slug, no prickle" } as never)).rejects.toThrow();
      });

      it("hides and shows an event", async () => {
        const repo = ctx.repo();
        const made = await repo.create(await fields());
        ctx.track(made.id);

        const hidden = await repo.setDeletedAt(made.id, "2097-01-01T00:00:00Z");
        expect(hidden?.deleted_at?.slice(0, 10)).toBe("2097-01-01");
        expect((await repo.setDeletedAt(made.id, null))?.deleted_at).toBeNull();
        expect(await repo.setDeletedAt(NONE, null)).toBeNull();
      });

      it("refuses a second event on the same prickle, or an event on no prickle", async () => {
        const repo = ctx.repo();
        const first = await fields();
        const made = await repo.create(first);
        ctx.track(made.id);

        await expect(repo.create({ ...(await fields()), prickle_id: first.prickle_id })).rejects.toThrow();
        await expect(repo.create({ slug: "no-prickle", event_type: "other" } as never)).rejects.toThrow();
      });

      it("reads the schedule from the prickle: the title falls back to the type's name, and the days are Eastern", async () => {
        const repo = ctx.repo();
        const untitled = await repo.create(await fields({ title: null }));
        // 03:30Z on the 2nd is 23:30 on the 1st in Eastern time (daylight saving).
        const lateNight = await repo.create(await fields({ title: "Late", startTime: "2097-07-02T03:30:00Z", endTime: "2097-07-02T05:00:00Z" }));
        // Ends exactly at Eastern midnight: the event ends the day before.
        const midnight = await repo.create(await fields({ title: "Midnight", startTime: "2097-07-03T20:00:00Z", endTime: "2097-07-04T04:00:00Z" }));
        // 2097-03-10 is the second Sunday of March: a 23-hour Eastern day. Ends at the next midnight.
        const springForward = await repo.create(await fields({ title: "Spring", startTime: "2097-03-10T05:00:00Z", endTime: "2097-03-11T04:00:00Z" }));
        for (const e of [untitled, lateNight, midnight, springForward]) ctx.track(e.id);

        expect(untitled.title).toBe("Event");
        expect([lateNight.starts_at, lateNight.ends_at]).toEqual(["2097-07-01", "2097-07-02"]);
        expect([midnight.starts_at, midnight.ends_at]).toEqual(["2097-07-03", "2097-07-03"]);
        expect([springForward.starts_at, springForward.ends_at]).toEqual(["2097-03-10", "2097-03-10"]);
      });

      it("finds the event standing on a prickle", async () => {
        const repo = ctx.repo();
        const made = await repo.create(await fields());
        ctx.track(made.id);

        expect(await repo.byPrickleId(made.prickle_id)).toMatchObject({ id: made.id, title: "Open House" });
        expect(await repo.byPrickleId("prkl_AAAAAAAAAAA1")).toBeNull();
      });

      it("lists events newest first with the count of photos that are not hidden", async () => {
        const ids = await ctx.seed([
          { key: "old", title: "Older", startsAt: "2097-03-01T09:00:00Z" },
          { key: "new", title: "Newer", startsAt: "2097-09-01T09:00:00Z" },
        ]);
        await ctx.photo(ids.new, { path: "a.jpg", takenAt: null, createdAt: "2097-01-01T00:00:00Z" });
        await ctx.photo(ids.new, { path: "b.jpg", takenAt: null, createdAt: "2097-01-02T00:00:00Z" });
        await ctx.photo(ids.new, { path: "c.jpg", takenAt: null, createdAt: "2097-01-03T00:00:00Z", hidden: true });

        const ours = (await ctx.repo().listWithPhotoCounts()).filter((e) => Object.values(ids).includes(e.id));

        expect(ours.map((e) => [e.title, e.photo_count])).toEqual([
          ["Newer", 2],
          ["Older", 0],
        ]);
        expect(ours[0]).not.toHaveProperty("event_photos");
      });

      it("lists an event's photos oldest first with undated ones last, and their storage paths", async () => {
        const ids = await ctx.seed([{ key: "e", title: "With photos", startsAt: "2097-03-01T09:00:00Z" }]);
        await ctx.photo(ids.e, { path: "undated.jpg", takenAt: null, createdAt: "2097-01-01T00:00:00Z" });
        await ctx.photo(ids.e, { path: "late.jpg", takenAt: "2097-03-01T12:00:00Z", createdAt: "2097-01-02T00:00:00Z" });
        await ctx.photo(ids.e, { path: "early.jpg", takenAt: "2097-03-01T10:00:00Z", createdAt: "2097-01-03T00:00:00Z" });

        const photos = await ctx.repo().allPhotosOf(ids.e);

        expect(photos.map((p) => p.storage_path)).toEqual(["early.jpg", "late.jpg", "undated.jpg"]);
        expect((await ctx.repo().photoPaths(ids.e)).sort()).toEqual(["early.jpg", "late.jpg", "undated.jpg"]);
        expect(await ctx.repo().allPhotosOf(NONE)).toEqual([]);
        expect(await ctx.repo().photoPaths(NONE)).toEqual([]);
      });

      it("lists attendees in the order they were added, with the member's names", async () => {
        const ids = await ctx.seed([{ key: "e", title: "With guests", startsAt: "2097-03-01T09:00:00Z" }]);
        const ada = await ctx.member({ name: "Ada Example", displayName: "Ada E", email: "ada@example.com" });
        const bo = await ctx.member({ name: "Bo Example", displayName: null, email: "bo@example.com" });
        await ctx.attend(ids.e, bo, "2097-01-02T00:00:00Z");
        await ctx.attend(ids.e, ada, "2097-01-01T00:00:00Z");

        const attendees = await ctx.repo().attendeesOf(ids.e);

        expect(attendees.map((a) => [a.member_id, a.member])).toEqual([
          [ada, { name: "Ada Example", display_name: "Ada E", email: expect.stringMatching(/ada@example\.com$/) }],
          [bo, { name: "Bo Example", display_name: null, email: expect.stringMatching(/bo@example\.com$/) }],
        ]);
      });

      it("deleting an event takes its photos and attendees with it", async () => {
        const ids = await ctx.seed([{ key: "e", title: "Going away", startsAt: "2097-03-01T09:00:00Z" }]);
        const ada = await ctx.member({ name: "Ada Example", displayName: null, email: "ada@example.com" });
        await ctx.attend(ids.e, ada, "2097-01-01T00:00:00Z");
        await ctx.photo(ids.e, { path: "x.jpg", takenAt: null, createdAt: "2097-01-01T00:00:00Z" });

        await ctx.repo().remove(ids.e);

        expect(await ctx.repo().attendeesOf(ids.e)).toEqual([]);
        expect(await ctx.repo().allPhotosOf(ids.e)).toEqual([]);
      });

      it("finds the event that follows a calendar event, and whether it is shown or hidden", async () => {
        const shownCal = await ctx.calendarEvent();
        const hiddenCal = await ctx.calendarEvent();
        const noEventCal = await ctx.calendarEvent();
        const ids = await ctx.seed([
          { key: "shown", title: "Shown", startsAt: "2097-03-01T09:00:00Z", calendarEventId: shownCal },
          { key: "hidden", title: "Hidden", startsAt: "2097-04-01T09:00:00Z", calendarEventId: hiddenCal, deletedAt: "2097-01-01T00:00:00Z" },
        ]);


        // More ids than one request carries, so the lookup is chunked.
        const fillers = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
        const visibility = await ctx.repo().visibilityByCalendarEvent([...fillers, shownCal, hiddenCal, noEventCal]);
        expect(visibility.get(shownCal)).toBe("shown");
        expect(visibility.get(hiddenCal)).toBe("hidden");
        expect(visibility.has(noEventCal)).toBe(false);
        expect((await ctx.repo().visibilityByCalendarEvent([])).size).toBe(0);
      });
    });
  });
}

// --- calendar sync ---

export type SyncSeedEvent = {
  key: string;
  /** Whether it follows a calendar event (default true). */
  calendar?: boolean;
  /** Only the calendar event and its prickle, no events row. */
  eventless?: boolean;
  automatic?: boolean;
  hidden?: boolean;
  photo?: boolean;
};

export type SyncSeedResult = {
  events: Record<string, string>;
  slugs: Record<string, string>;
  calendars: Record<string, string>;
  /** Each key's prickle: with a calendar event unless `calendar` is false; an `eventless` one has a prickle and no event. */
  prickles: Record<string, string>;
};

export type EventSyncContext = {
  repo: () => EventRepository;
  /** Replaces what this context seeded before with these events and the calendar events they follow. */
  seed: (events: SyncSeedEvent[]) => Promise<SyncSeedResult>;
  /** The event row now, or null (so a test can see what a write did). */
  read: (id: string) => Promise<{ focus: string | null; automatic: boolean } | null>;
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

    it("lists the events standing on the prickles of calendar events", async () => {
      const s = await ctx.seed([{ key: "a" }, { key: "b" }, { key: "c", eventless: true }]);

      const linked = await ctx.repo().linkedToCalendarEvents([s.calendars.a, s.calendars.b, s.calendars.c]);

      expect(linked.sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(
        [
          { id: s.events.a, calendarEventId: s.calendars.a, prickleId: s.prickles.a },
          { id: s.events.b, calendarEventId: s.calendars.b, prickleId: s.prickles.b },
        ].sort((x, y) => (x.id < y.id ? -1 : 1)),
      );
    });

    it("creates an event on a prickle, and reports a taken prickle or slug as a conflict", async () => {
      const s = await ctx.seed([{ key: "taken" }, { key: "free", eventless: true }]);
      const row = (prickleId: string, slug: string) => ({ slug, event_type: "other" as const, prickle_id: prickleId, automatic: true });

      expect(await ctx.repo().createForPrickle(row(s.prickles.taken, `${s.slugs.taken}-x`))).toEqual({ status: "conflict", on: "prickle" });
      expect(await ctx.repo().createForPrickle(row(s.prickles.free, s.slugs.taken))).toEqual({ status: "conflict", on: "slug" });
      const made = await ctx.repo().createForPrickle(row(s.prickles.free, `${s.slugs.taken}-y`));

      expect(made).toMatchObject({ status: "created", event: { slug: `${s.slugs.taken}-y` } });
      expect(await ctx.repo().byCalendarEventId(s.calendars.free)).toMatchObject({ slug: `${s.slugs.taken}-y`, automatic: true });
    });

    it("writes columns to one event and leaves the others alone", async () => {
      const s = await ctx.seed([{ key: "a", automatic: true }, { key: "b", automatic: true }]);

      await ctx.repo().update(s.events.a, { focus: "Refocused", automatic: false });

      expect(await ctx.read(s.events.a)).toEqual({ focus: "Refocused", automatic: false });
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

// --- member-facing reads ---

/** An in-memory photo row naming only what a test cares about. */
export function photoRow(p: Pick<EventPhotoRow, "id" | "event_id"> & Partial<EventPhotoRow>): EventPhotoRow {
  return { created_at: "2097-01-01T00:00:00Z", google_media_item_id: `gm-${p.id}`, height: null, hidden_at: null, mime_type: null, storage_path: `${p.event_id}/${p.id}`, taken_at: null, width: null, ...p };
}

export type MemberEventSeed = {
  title: string;
  startsAt: string;
  endsAt?: string;
  hidden?: boolean;
  speakers?: string;
  hostName?: string;
  location?: string;
  focus?: string;
  description?: string;
  calendarEventId?: string;
};

export type MemberEventContext = {
  repo: () => EventRepository;
  /** Unique to this run, so a search can find only the events this context created. */
  token: string;
  event: (seed: MemberEventSeed) => Promise<string>;
  photo: (eventId: string, seed: { hidden?: boolean; takenAt?: string | null; width?: number; height?: number }) => Promise<string>;
  member: () => Promise<string>;
  attend: (eventId: string, memberId: string) => Promise<void>;
};

/** Member-facing reads of `EventRepository`: lists, lookups, the calendar feed's events and search. */
export function defineMemberEventContract(name: string, setup: () => MemberEventContext) {
  describe(`${name} (EventRepository member reads contract)`, () => {
    let ctx: MemberEventContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists events newest first with the first visible photo as the cover, hidden events flagged", async () => {
      const old = await ctx.event({ title: `Old ${ctx.token}`, startsAt: "2097-03-01" });
      const recent = await ctx.event({ title: `Recent ${ctx.token}`, startsAt: "2097-09-01", location: "Lakeside" });
      const hidden = await ctx.event({ title: `Hidden ${ctx.token}`, startsAt: "2097-06-01", hidden: true });
      await ctx.photo(recent, { hidden: true, takenAt: "2097-08-01T10:00:00Z" });
      await ctx.photo(recent, { takenAt: null });
      const first = await ctx.photo(recent, { takenAt: "2097-08-31T10:00:00Z" });

      const ours = (await ctx.repo().listWithCover()).filter((e) => [old, recent, hidden].includes(e.id));

      expect(ours.map((e) => e.id)).toEqual([recent, hidden, old]);
      expect(ours[0]).toMatchObject({ location: "Lakeside", coverPhotoId: first, deleted_at: null });
      expect(ours[1].deleted_at).not.toBeNull();
      expect(ours[2].coverPhotoId).toBeNull();
    });

    it("finds a visible event by slug, with all its columns", async () => {
      const id = await ctx.event({ title: `Retreat ${ctx.token}`, startsAt: "2097-04-01", endsAt: "2097-04-03", speakers: "Ada Example" });
      const hidden = await ctx.event({ title: `Secret ${ctx.token}`, startsAt: "2097-04-01", hidden: true });
      const list = await ctx.repo().listWithCover();
      const slugOf = (eventId: string) => list.find((e) => e.id === eventId)!.slug;

      const found = await ctx.repo().visibleBySlug(slugOf(id));

      expect(found).toMatchObject({ id, title: `Retreat ${ctx.token}`, speakers: "Ada Example", deleted_at: null });
      expect(found!.ends_at.slice(0, 10)).toBe("2097-04-03");
      expect(await ctx.repo().visibleBySlug(slugOf(hidden))).toBeNull();
      expect(await ctx.repo().visibleBySlug(`no-such-${ctx.token}`)).toBeNull();
    });

    it("lists an event's visible photos in the order they were taken, undated last", async () => {
      const id = await ctx.event({ title: `Photos ${ctx.token}`, startsAt: "2097-04-01" });
      const other = await ctx.event({ title: `Other ${ctx.token}`, startsAt: "2097-04-02" });
      const late = await ctx.photo(id, { takenAt: "2097-04-02T10:00:00Z", width: 400, height: 300 });
      const early = await ctx.photo(id, { takenAt: "2097-04-01T10:00:00Z" });
      const undated = await ctx.photo(id, { takenAt: null });
      await ctx.photo(id, { hidden: true, takenAt: "2097-04-01T09:00:00Z" });
      await ctx.photo(other, { takenAt: "2097-04-01T08:00:00Z" });

      const photos = await ctx.repo().visiblePhotos(id);

      expect(photos.map((p) => p.id)).toEqual([early, late, undated]);
      expect(photos[1]).toEqual({ id: late, width: 400, height: 300 });
      expect(await ctx.repo().visiblePhotos("evnt_AAAAAAAAAAA1")).toEqual([]);
    });

    it("says whether a visible event has an id", async () => {
      const id = await ctx.event({ title: `Shown ${ctx.token}`, startsAt: "2097-04-01" });
      const hidden = await ctx.event({ title: `Hidden ${ctx.token}`, startsAt: "2097-04-01", hidden: true });

      expect(await ctx.repo().isVisible(id)).toBe(true);
      expect(await ctx.repo().isVisible(hidden)).toBe(false);
    });

    it("returns the visible events among some ids that have not ended before a date", async () => {
      const ongoing = await ctx.event({ title: `Ongoing ${ctx.token}`, startsAt: "2097-04-01", endsAt: "2097-04-10", hostName: "Ada Example", location: "Lakeside" });
      const over = await ctx.event({ title: `Over ${ctx.token}`, startsAt: "2097-03-01", endsAt: "2097-03-02" });
      const hidden = await ctx.event({ title: `Hidden ${ctx.token}`, startsAt: "2097-04-01", endsAt: "2097-04-10", hidden: true });
      const unasked = await ctx.event({ title: `Unasked ${ctx.token}`, startsAt: "2097-04-01", endsAt: "2097-04-10" });

      const found = await ctx.repo().visibleEndingFrom([ongoing, over, hidden], "2097-04-10");

      expect(found.map((e) => e.id)).toEqual([ongoing]);
      expect(found[0]).toMatchObject({ title: `Ongoing ${ctx.token}`, host_name: "Ada Example", location: "Lakeside", speakers: null });
      expect(found[0].ends_at.slice(0, 10)).toBe("2097-04-10");
      expect(unasked).toBeTruthy();
      expect(await ctx.repo().visibleEndingFrom([], "2097-04-10")).toEqual([]);
    });

    it("searches by every word across title, speakers, host, location, focus and description", async () => {
      const a = await ctx.event({ title: `Craft ${ctx.token}`, startsAt: "2097-05-01", speakers: "Ada Example", location: "Lakeside" });
      const b = await ctx.event({ title: `Craft ${ctx.token}`, startsAt: "2097-05-02", description: "Revision tips", focus: "Editing" });
      const c = await ctx.event({ title: `Craft ${ctx.token}`, startsAt: "2097-05-03", hostName: "Grace Example" });
      const search = async (words: string[], extra = {}) =>
        (await ctx.repo().search({ words: [ctx.token, ...words], limit: 10, offset: 0, ...extra })).map((e) => e.id);

      expect(await search([])).toEqual([c, b, a]);
      expect(await search(["LAKESIDE", "ada"])).toEqual([a]);
      expect(await search(["revision"])).toEqual([b]);
      expect(await search(["editing"])).toEqual([b]);
      expect(await search(["grace"])).toEqual([c]);
      expect(await search(["lakeside", "grace"])).toEqual([]);
      expect(await search(["50%_off"])).toEqual([]);
      expect(await search([], { limit: 1, offset: 1 })).toEqual([b]);
      expect(await search([], { after: "2097-05-02", before: "2097-05-03" })).toEqual([b]);
      const [hit] = await ctx.repo().search({ words: [ctx.token, "lakeside"], limit: 5, offset: 0 });
      expect(hit).toMatchObject({ id: a, title: `Craft ${ctx.token}`, speakers: "Ada Example", location: "Lakeside", host_name: null, focus: null });
    });

    it("hides hidden events from search unless asked, and narrows to what members attended", async () => {
      const shown = await ctx.event({ title: `Shown ${ctx.token}`, startsAt: "2097-05-01" });
      const hidden = await ctx.event({ title: `Hidden ${ctx.token}`, startsAt: "2097-05-02", hidden: true });
      const ada = await ctx.member();
      const grace = await ctx.member();
      const nobody = await ctx.member();
      await ctx.attend(shown, ada);
      await ctx.attend(hidden, ada);
      await ctx.attend(shown, grace);
      const search = async (extra = {}) => (await ctx.repo().search({ words: [ctx.token], limit: 10, offset: 0, ...extra })).map((e) => e.id);

      expect(await search()).toEqual([shown]);
      expect(await search({ includeHidden: true })).toEqual([hidden, shown]);
      expect(await search({ attendedBy: [ada, grace] })).toEqual([shown]);
      expect(await search({ attendedBy: [ada], includeHidden: true })).toEqual([hidden, shown]);
      expect(await search({ attendedBy: [nobody] })).toEqual([]);
      expect(await search({ attendedBy: [] })).toEqual([]);
    });
  });
}
