import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { Prickle, PrickleType } from "@/lib/data/prickles";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";

let data = new InMemoryDataset();
let repos = createInMemoryRepos(data);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { elevateCalendarEvent, ensureCalendarEvents, reconcileAutomaticEvents } from "@/lib/calendar-events";

const EVENT_TYPE: PrickleType = { id: "prty_EVENTONLY001", name: "Event", normalizedName: "event", purpose: "social", requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const OPEN_TABLE: PrickleType = { ...EVENT_TYPE, id: "prty_OPENTABLE001", name: "Open Table", normalizedName: "open table", purpose: "social", announcedPublicly: true, guestsAllowed: true };

const source = { summary: "Open Table", description: null, location: "Room 1", start_time: "2097-05-02T23:00:00Z", end_time: "2097-05-03T01:00:00Z" };

/** The calendar items `cal_1` and `cal_2` are in the Bronze repository (or aren't); the client itself is not touched. */
const dbWithSource = (row: typeof source | null): Db => {
  data.calendarEvents = row
    ? ["cal_1", "cal_2"].map((id) => ({ id, google_event_id: `g-${id}`, raw_data: {}, creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null, ...row }))
    : [];
  return {} as unknown as Db;
};

const prickleFor = (calendarEventId: string, id = `prkl_${calendarEventId}`, typeId = OPEN_TABLE.id): Prickle => ({
  id, typeId, hostId: null, title: "Open Table", startTime: source.start_time, endTime: source.end_time, source: "calendar", calendarEventId,
});

beforeEach(() => {
  vi.restoreAllMocks();
  data = new InMemoryDataset({ prickleTypes: [EVENT_TYPE, OPEN_TABLE] });
  repos = createInMemoryRepos(data);
});

describe("elevateCalendarEvent", () => {
  it("returns the event a calendar item already has, and keeps an automatic one when an admin shows it", async () => {
    data.prickles = [prickleFor("cal_1", "prkl_1")];
    data.events = [{ id: "evnt_1", slug: "t", prickle_id: "prkl_1", automatic: true }];

    const result = await elevateCalendarEvent(dbWithSource(source), "cal_1", "user", false);

    expect(result).toEqual({ ok: true, created: false, event: { id: "evnt_1", slug: "t", hidden: false } });
    expect(data.events[0].automatic).toBe(false);
  });

  it("reports a repository error as a 500", async () => {
    vi.spyOn(repos.prickles, "byCalendarEventIds").mockRejectedValueOnce(new Error("db down"));

    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toEqual({ ok: false, status: 500, error: "db down" });
  });

  it("reports a calendar read error as a 500", async () => {
    vi.spyOn(repos.calendarEvents, "byId").mockRejectedValueOnce(new Error("calendar down"));

    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toEqual({ ok: false, status: 500, error: "calendar down" });
  });

  it("is a 404 when the calendar event does not exist", async () => {
    expect(await elevateCalendarEvent(dbWithSource(null), "cal_1", null)).toEqual({ ok: false, status: 404, error: "Calendar event not found" });
  });

  it("creates the event on the item's prickle with the type's audience, taking the next address when the first is taken", async () => {
    data.prickles = [prickleFor("cal_1", "prkl_1"), prickleFor("cal_2", "prkl_2")];
    data.events = [{ id: "evnt_1", slug: "open-table-2097-05-02", prickle_id: "prkl_2" }];

    const result = await elevateCalendarEvent(dbWithSource(source), "cal_1", null, true);

    expect(result).toMatchObject({ ok: true, created: true, event: { slug: "open-table-2097-05-02-1900" } });
    expect(data.events.find((e) => e.prickle_id === "prkl_1")).toMatchObject({ automatic: true, announced_publicly: true, guests_allowed: true });
  });

  it("makes an Event-type prickle for an item that matched no type, once", async () => {
    const db = dbWithSource({ ...source, summary: "Quill & Cup [Retreat] Prickle: Spring Retreat" });

    const first = await elevateCalendarEvent(db, "cal_1", null, true);
    const second = await elevateCalendarEvent(db, "cal_1", null, true);

    expect(first).toMatchObject({ ok: true, created: true, event: { slug: "spring-retreat-2097-05-02" } });
    expect(second).toMatchObject({ ok: true, created: false });
    const made = data.prickles.filter((p) => p.calendarEventId === "cal_1");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ typeId: EVENT_TYPE.id, source: "calendar", title: "Spring Retreat", location: "Room 1", hostId: null });
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ focus: "Retreat" });
  });

  it("fails when the Event prickle type is missing", async () => {
    data.prickleTypes = [];
    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toEqual({ ok: false, status: 500, error: "The Event prickle type is missing" });
  });

  it("returns the other event when someone showed it a moment ago", async () => {
    data.prickles = [prickleFor("cal_1", "prkl_1")];
    vi.spyOn(repos.events, "createForPrickle").mockImplementationOnce(async () => {
      data.events.push({ id: "evnt_9", slug: "theirs", prickle_id: "prkl_1" });
      return { status: "conflict", on: "prickle" };
    });

    const result = await elevateCalendarEvent(dbWithSource(source), "cal_1", null);

    expect(result).toEqual({ ok: true, created: false, event: { id: "evnt_9", slug: "theirs", hidden: false } });
  });

  it("reports a failed insert as a 500, and gives up when no slug is free", async () => {
    data.prickles = [prickleFor("cal_1", "prkl_1")];
    vi.spyOn(repos.events, "createForPrickle").mockRejectedValueOnce(new Error("insert failed"));
    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toEqual({ ok: false, status: 500, error: "insert failed" });

    vi.spyOn(repos.events, "createForPrickle").mockResolvedValue({ status: "conflict", on: "slug" });
    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("ensureCalendarEvents and reconcileAutomaticEvents", () => {
  it("creates only the missing events", async () => {
    data.prickles = [prickleFor("cal_1", "prkl_1"), prickleFor("cal_2", "prkl_2")];
    data.events = [{ id: "evnt_1", slug: "t", prickle_id: "prkl_1" }];

    expect(await ensureCalendarEvents(dbWithSource(source), [])).toBe(0);
    expect(await ensureCalendarEvents(dbWithSource(source), ["cal_1", "cal_2"])).toBe(1);
    expect(data.events.map((e) => e.prickle_id).sort()).toEqual(["prkl_1", "prkl_2"]);
  });

  it("throws when an event cannot be created", async () => {
    await expect(ensureCalendarEvents(dbWithSource(null), ["cal_1"])).rejects.toThrow("Calendar event not found");
  });

  it("removes automatic events that stopped qualifying or lost their calendar item, but not worked-on or hand-made ones", async () => {
    data.prickles = [
      prickleFor("cal_1", "prkl_1"),
      prickleFor("cal_2", "prkl_2"),
      prickleFor("cal_1", "prkl_3"),
      { ...prickleFor("cal_x", "prkl_4"), calendarEventId: null },
      { ...prickleFor("cal_x", "prkl_5"), calendarEventId: null },
    ];
    data.events = [
      { id: "evnt_stale", slug: "a", prickle_id: "prkl_1", automatic: true },
      { id: "evnt_keep", slug: "b", prickle_id: "prkl_2", automatic: true },
      { id: "evnt_hand", slug: "e", prickle_id: "prkl_3" },
      { id: "evnt_orphan", slug: "c", prickle_id: "prkl_4", automatic: true },
      { id: "evnt_photo", slug: "d", prickle_id: "prkl_5", automatic: true },
    ];
    await repos.events.addPhoto({ event_id: "evnt_photo", storage_path: "p.jpg", google_media_item_id: "g1" });

    const removed = await reconcileAutomaticEvents({} as Db, ["cal_1", "cal_2"], new Set(["cal_2"]));

    expect(removed).toBe(2);
    expect(data.events.map((e) => e.id).sort()).toEqual(["evnt_hand", "evnt_keep", "evnt_photo"]);
  });

  it("does nothing when nothing is stale", async () => {
    expect(await reconcileAutomaticEvents({} as Db, [], new Set())).toBe(0);
  });
});
