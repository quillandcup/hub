import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";

let data = new InMemoryDataset();
let repos = createInMemoryRepos(data);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { elevateCalendarEvent, ensureCalendarEvents, reconcileAutomaticEvents, syncCalendarEvents } from "@/lib/calendar-events";

const source = { summary: "Open Table", description: null, location: null, start_time: "2097-05-02T23:00:00Z", end_time: "2097-05-03T01:00:00Z" };

/** Only the Bronze read is left on the client; the events go through the repository. */
const dbWithSource = (row: typeof source | null): Db =>
  ({ schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }) as unknown as Db;

beforeEach(() => {
  vi.restoreAllMocks();
  data = new InMemoryDataset();
  repos = createInMemoryRepos(data);
});

describe("elevateCalendarEvent", () => {
  it("returns the event a calendar event already has, and keeps an automatic one when an admin shows it", async () => {
    data.events = [{ id: "evnt_1", title: "T", slug: "t", calendar_event_id: "cal_1", automatic: true }];

    const result = await elevateCalendarEvent(dbWithSource(null), "cal_1", "user", false);

    expect(result).toEqual({ ok: true, created: false, event: { id: "evnt_1", slug: "t", hidden: false } });
    expect(data.events[0].automatic).toBe(false);
  });

  it("reports a repository error as a 500", async () => {
    vi.spyOn(repos.events, "byCalendarEventId").mockRejectedValueOnce(new Error("db down"));

    expect(await elevateCalendarEvent(dbWithSource(null), "cal_1", null)).toEqual({ ok: false, status: 500, error: "db down" });
  });

  it("is a 404 when the calendar event does not exist", async () => {
    expect(await elevateCalendarEvent(dbWithSource(null), "cal_1", null)).toEqual({ ok: false, status: 404, error: "Calendar event not found" });
  });

  it("creates the event, taking the next free slug when the first is taken", async () => {
    data.events = [{ id: "evnt_1", title: "Open Table", slug: "open-table-2097-05-02", calendar_event_id: "other" }];

    const result = await elevateCalendarEvent(dbWithSource(source), "cal_1", null, true);

    expect(result).toMatchObject({ ok: true, created: true, event: { slug: "open-table-2097-05-02-2" } });
    expect(data.events.find((e) => e.calendar_event_id === "cal_1")).toMatchObject({ automatic: true, event_type: "other" });
  });

  it("returns the other event when someone showed it a moment ago", async () => {
    vi.spyOn(repos.events, "createFromCalendar").mockImplementationOnce(async () => {
      data.events.push({ id: "evnt_9", title: "T", slug: "theirs", calendar_event_id: "cal_1" });
      return { status: "conflict", on: "calendar_event" };
    });

    const result = await elevateCalendarEvent(dbWithSource(source), "cal_1", null);

    expect(result).toEqual({ ok: true, created: false, event: { id: "evnt_9", slug: "theirs", hidden: false } });
  });

  it("reports a failed insert as a 500, and gives up when no slug is free", async () => {
    vi.spyOn(repos.events, "createFromCalendar").mockRejectedValueOnce(new Error("insert failed"));
    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toEqual({ ok: false, status: 500, error: "insert failed" });

    vi.spyOn(repos.events, "createFromCalendar").mockResolvedValue({ status: "conflict", on: "slug" });
    expect(await elevateCalendarEvent(dbWithSource(source), "cal_1", null)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("ensureCalendarEvents, syncCalendarEvents and reconcileAutomaticEvents", () => {
  it("creates only the missing events", async () => {
    data.events = [{ id: "evnt_1", title: "T", slug: "t", calendar_event_id: "cal_1" }];

    expect(await ensureCalendarEvents(dbWithSource(source), [])).toBe(0);
    expect(await ensureCalendarEvents(dbWithSource(source), ["cal_1", "cal_2"])).toBe(1);
    expect(data.events.map((e) => e.calendar_event_id).sort()).toEqual(["cal_1", "cal_2"]);
  });

  it("throws when an event cannot be created", async () => {
    await expect(ensureCalendarEvents(dbWithSource(null), ["cal_1"])).rejects.toThrow("Calendar event not found");
  });

  it("updates the followers of the calendar events it is given, keeping overridden fields", async () => {
    data.events = [
      { id: "evnt_1", title: "Ours", slug: "a", calendar_event_id: "cal_1", overridden_fields: ["title"] },
      { id: "evnt_2", title: "Old", slug: "b", calendar_event_id: "cal_2" },
    ];

    expect(await syncCalendarEvents({} as Db, [])).toBe(0);
    const updated = await syncCalendarEvents({} as Db, [{ id: "cal_1", ...source }]);

    expect(updated).toBe(1);
    expect(data.events[0]).toMatchObject({ title: "Ours", starts_at: "2097-05-02" });
    expect(data.events[1].title).toBe("Old");
  });

  it("removes automatic events that stopped qualifying or lost their calendar event, but not worked-on ones", async () => {
    data.events = [
      { id: "evnt_stale", title: "a", slug: "a", calendar_event_id: "cal_1", automatic: true },
      { id: "evnt_keep", title: "b", slug: "b", calendar_event_id: "cal_2", automatic: true },
      { id: "evnt_orphan", title: "c", slug: "c", automatic: true },
      { id: "evnt_photo", title: "d", slug: "d", automatic: true },
      { id: "evnt_hand", title: "e", slug: "e", calendar_event_id: "cal_1" },
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
