import { describe, expect, it } from "vitest";
import { LIVE_MEETING_UUID, liveCalendarEvent, liveRoomRows, weeksBefore, withLapsedStreak } from "@/demo/live-seed";
import type { ZoomAttendeeRow } from "@/demo/attendance";

// Friday 2026-11-06, 12:00 Eastern.
const NOW = new Date("2026-11-06T17:00:00Z");
const MINUTE = 60_000;

describe("liveCalendarEvent", () => {
  it("started 20 minutes ago and ends in 40", () => {
    const e = liveCalendarEvent(NOW);
    expect(NOW.getTime() - new Date(e.start_time).getTime()).toBe(20 * MINUTE);
    expect(new Date(e.end_time).getTime() - NOW.getTime()).toBe(40 * MINUTE);
  });
});

describe("liveRoomRows", () => {
  it("has people who joined and nobody who left, on a meeting with a host id", () => {
    const { meeting, events } = liveRoomRows(NOW);
    expect(meeting.meeting_uuid).toBe(LIVE_MEETING_UUID);
    expect(events.every((e) => e.event === "joined" && e.host_id === (meeting.data as { host_id: string }).host_id)).toBe(true);
    expect(events.every((e) => new Date(e.event_time).getTime() < NOW.getTime())).toBe(true);
    expect(events.some((e) => e.participant_email === null)).toBe(true);
  });
});

describe("weeksBefore", () => {
  it("counts Monday-based weeks in Eastern time", () => {
    expect(weeksBefore(new Date("2026-11-03T15:00:00Z"), NOW)).toBe(0);
    expect(weeksBefore(new Date("2026-10-29T23:00:00Z"), NOW)).toBe(1);
    expect(weeksBefore(new Date("2026-10-15T23:00:00Z"), NOW)).toBe(3);
    // Sunday evening Eastern is already Monday in UTC: still the earlier week.
    expect(weeksBefore(new Date("2026-11-02T00:30:00Z"), NOW)).toBe(1);
  });
});

describe("withLapsedStreak", () => {
  const maya = { name: "Maya Example", email: "maya.example@example.com" };
  const slot = (key: string, summary: string, start: string) => ({ key, summary, start: new Date(start), end: new Date(new Date(start).getTime() + 60 * MINUTE) });
  const slots = [
    slot("a", "Plot or Plan Prickle w/Rosa Demo", "2026-10-15T23:00:00Z"),
    slot("b", "Plot or Plan Prickle w/Rosa Demo", "2026-10-22T23:00:00Z"),
    slot("c", "Plot or Plan Prickle w/Rosa Demo", "2026-10-29T23:00:00Z"),
    slot("d", "Sprint Prickle w/Hazel Hosting", "2026-10-29T23:00:00Z"),
  ];
  const existing = (key: string, email: string): ZoomAttendeeRow => ({
    meeting_id: "1", meeting_uuid: `demo-mtg-${key}`, topic: "Demo: x", participant_id: `demo-${email}`, name: "n", email,
    join_time: "2026-10-29T23:00:00Z", leave_time: "2026-10-30T00:00:00Z", duration: 3600, status: "in_meeting", raw_payload: { demo: true },
  });

  it("attends the series three and two weeks ago, not last week, and drops her other rows for it", () => {
    const rows = withLapsedStreak([existing("c", maya.email), existing("c", "someone@example.com"), existing("d", maya.email)], slots, maya, NOW);
    const mine = rows.filter((r) => r.email === maya.email).map((r) => r.meeting_uuid).sort();
    expect(mine).toEqual(["demo-mtg-a", "demo-mtg-b", "demo-mtg-d"]);
    expect(rows.some((r) => r.email === "someone@example.com")).toBe(true);
  });

  it("is the same every time", () => {
    expect(withLapsedStreak([], slots, maya, NOW)).toEqual(withLapsedStreak([], slots, maya, NOW));
  });
});
