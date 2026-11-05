import { describe, it, expect } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { NewZoomAttendee } from "@/lib/data/zoom";
import { importReprocessRange, loadWholeMeetings, sessionKey } from "@/lib/processing/attendance";

const iso = (day: number, time: string) => `2026-11-${String(day).padStart(2, "0")}T${time}.000Z`;

/** One attendee stay in the meeting `uuid` (or, with null, a legacy row known only by its meeting id). */
const stay = (name: string, uuid: string | null, join: string, leave: string, meetingId = uuid ?? `id-${name}`): NewZoomAttendee => ({
  meeting_id: meetingId,
  meeting_uuid: uuid,
  name,
  join_time: join,
  leave_time: leave,
  duration: Math.round((Date.parse(leave) - Date.parse(join)) / 60000),
});

async function zoomWith(rows: NewZoomAttendee[]) {
  const repos = createInMemoryRepos(new InMemoryDataset());
  await repos.zoom.upsertAttendees(rows);
  return repos.zoom;
}

describe("loadWholeMeetings", () => {
  // A room that crosses midnight UTC: seven people in it at 00:00Z, three who join after.
  const eveningRoom = [
    stay("a", "room", iso(3, "22:59:31"), iso(4, "00:21:32")),
    stay("b", "room", iso(3, "23:06:15"), iso(4, "01:00:59")),
    stay("c", "room", iso(3, "23:58:13"), iso(4, "02:00:36")),
    stay("d", "room", iso(3, "23:59:30"), iso(4, "02:00:30")),
    stay("e", "room", iso(4, "00:28:34"), iso(4, "00:50:24")),
    stay("f", "room", iso(4, "01:00:38"), iso(4, "02:00:30")),
    stay("g", "room", iso(4, "01:03:48"), iso(4, "02:00:31")),
  ];

  it("reads a meeting whole and widens the range to its end when the range stops at midnight UTC", async () => {
    const zoom = await zoomWith(eveningRoom);

    const run = await loadWholeMeetings(zoom, { from: iso(1, "00:00:00"), to: iso(4, "00:00:00") });

    expect(run.attendees.map((a) => a.name)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(run.from).toBe(iso(1, "00:00:00"));
    expect(run.to).toBe(iso(4, "02:00:36"));
  });

  it("finds the room from a zero-width range at the cut-off, widening both ways", async () => {
    const zoom = await zoomWith(eveningRoom);

    const run = await loadWholeMeetings(zoom, { from: iso(4, "00:00:00"), to: iso(4, "00:00:00") });

    expect(run.attendees).toHaveLength(7);
    expect(run.from).toBe(iso(3, "22:59:31"));
    expect(run.to).toBe(iso(4, "02:00:36"));
  });

  it("gives back the range as asked, and nobody, when no meeting overlaps it", async () => {
    const zoom = await zoomWith(eveningRoom);

    const run = await loadWholeMeetings(zoom, { from: iso(10, "00:00:00"), to: iso(11, "00:00:00") });

    expect(run).toEqual({ from: iso(10, "00:00:00"), to: iso(11, "00:00:00"), attendees: [] });
  });

  it("keeps widening until no meeting overlapping the range reaches outside it", async () => {
    // Meeting one is seen first; reading it whole reaches meeting two, which runs on past it.
    const zoom = await zoomWith([
      stay("a", "one", iso(5, "10:00:00"), iso(5, "11:00:00")),
      stay("b", "two", iso(5, "10:50:00"), iso(5, "12:00:00")),
      stay("c", "three", iso(5, "11:55:00"), iso(5, "13:00:00")),
      stay("far", "elsewhere", iso(5, "20:00:00"), iso(5, "21:00:00")),
    ]);

    const run = await loadWholeMeetings(zoom, { from: iso(5, "10:30:00"), to: iso(5, "10:40:00") });

    expect(run.attendees.map((a) => a.name)).toEqual(["a", "b", "c"]);
    expect(run.from).toBe(iso(5, "10:00:00"));
    expect(run.to).toBe(iso(5, "13:00:00"));
  });

  it("reads a meeting with no uuid, known only by its meeting id, whole too", async () => {
    const zoom = await zoomWith([
      stay("a", null, iso(6, "09:00:00"), iso(6, "10:00:00"), "legacy"),
      stay("b", null, iso(6, "09:30:00"), iso(6, "11:00:00"), "legacy"),
    ]);

    const run = await loadWholeMeetings(zoom, { from: iso(6, "09:10:00"), to: iso(6, "09:20:00") });

    expect(run.attendees.map((a) => sessionKey(a))).toEqual(["legacy", "legacy"]);
    expect(run.to).toBe(iso(6, "11:00:00"));
  });

  it("reads again only the meetings near an edge of a long range, and still returns every attendee in it", async () => {
    const zoom = await zoomWith([
      stay("early", "first", iso(1, "09:00:00"), iso(1, "10:00:00")),
      stay("middle", "middle", iso(15, "09:00:00"), iso(15, "10:00:00")),
      stay("a", "edge", iso(28, "23:00:00"), iso(29, "00:30:00")),
      stay("b", "edge", iso(29, "00:10:00"), iso(29, "02:00:00")),
    ]);
    const asked: string[][] = [];
    const spy = {
      attendeesOverlapping: zoom.attendeesOverlapping.bind(zoom),
      attendeesOfSessions: async (keys: string[]) => {
        asked.push(keys);
        return zoom.attendeesOfSessions(keys);
      },
    };

    // The range ends in the middle of the "edge" meeting.
    const run = await loadWholeMeetings(spy, { from: iso(1, "00:00:00"), to: iso(29, "00:00:00") });

    expect(run.attendees.map((a) => a.name)).toEqual(["early", "middle", "a", "b"]);
    expect(run.to).toBe(iso(29, "02:00:00"));
    // The meeting in the middle of the range is not read a second time.
    expect(asked.flat()).not.toContain("middle");
    expect(asked[0]).toContain("edge");
  });

  it("stops with an error on a row that would stretch the range by days, instead of rebuilding them all", async () => {
    const zoom = await zoomWith([
      stay("a", "bad", iso(7, "09:00:00"), iso(7, "10:00:00")),
      stay("b", "bad", iso(7, "09:30:00"), iso(14, "10:00:00")),
    ]);

    await expect(loadWholeMeetings(zoom, { from: iso(7, "09:10:00"), to: iso(7, "09:20:00") })).rejects.toThrow(/more than 3 days/);
  });
});

describe("importReprocessRange", () => {
  it("makes a date-only end the end of that day, so a same-day import covers the day", () => {
    const { from, to } = importReprocessRange("2026-11-04", "2026-11-04");

    expect(from.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("covers every day from the first to the last date, last day included", () => {
    const { from, to } = importReprocessRange("2026-11-03", "2026-11-05");

    expect(from.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("rolls over a month end", () => {
    expect(importReprocessRange("2026-11-30", "2026-11-30").to.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("leaves an instant, one with a time in it, as it is", () => {
    const { from, to } = importReprocessRange("2026-11-04T09:00:00.000Z", "2026-11-04T12:30:00.000Z");

    expect(from.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-04T12:30:00.000Z");
  });
});
