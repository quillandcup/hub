import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { CalendarSourceEvent } from "@/lib/data/calendar-events";

// POST /api/import/calendar copies the Google Calendar into the Bronze table: new items are added, changed
// ones updated, unchanged ones skipped, and the ones that left the calendar removed. Bronze is reprocessable
// input, so a hiccup on the way (reading what is stored, stamping the sync time) doesn't fail the import.

let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let auth: { user: { id: string } | null; forbidden?: boolean } = { user: { id: "admin" } };
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
const listEvents = vi.fn();
vi.mock("@/lib/google-calendar/client", () => ({ GoogleCalendarClient: class { listEvents = listEvents; } }));
const triggerReprocessing = vi.fn(async () => ({ processed: ["calendar"] }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessing(...(args as [])) }));

import { POST } from "@/app/api/import/calendar/route";

const FROM = "2097-04-01T00:00:00Z";
const TO = "2097-04-30T00:00:00Z";
const stored = (id: string, summary: string, start: string, end: string): CalendarSourceEvent => ({
  id, google_event_id: `g-${id}`, summary, description: null, location: null, raw_data: {},
  start_time: start, end_time: end, creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
});
const google = (id: string, summary: string, start: string | null, end: string | null) => ({
  id: `g-${id}`,
  summary,
  start: start ? { dateTime: start } : {},
  end: end ? { dateTime: end } : {},
});
const post = (body: unknown = { fromDate: FROM, toDate: TO }) =>
  POST(new NextRequest("http://localhost/api/import/calendar", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  auth = { user: { id: "admin" } };
  dataset = new InMemoryDataset({
    calendarEvents: [
      stored("a", "Same", "2097-04-02T15:00:00Z", "2097-04-02T16:00:00Z"),
      stored("b", "Old name", "2097-04-03T15:00:00Z", "2097-04-03T16:00:00Z"),
      stored("gone", "Cancelled", "2097-04-04T15:00:00Z", "2097-04-04T16:00:00Z"),
    ],
  });
  repos = createInMemoryRepos(dataset);
  listEvents.mockResolvedValue([
    google("a", "Same", "2097-04-02T15:00:00Z", "2097-04-02T16:00:00Z"),
    google("b", "New name", "2097-04-03T15:00:00Z", "2097-04-03T16:00:00Z"),
    google("c", "Brand new", "2097-04-05T15:00:00Z", "2097-04-05T16:00:00Z"),
    google("allday", "No times", null, null),
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/import/calendar", () => {
  it("adds new items, updates changed ones, skips unchanged and untimed ones, removes the cancelled, and stamps the sync", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, total: 4, imported: 1, updated: 1, deleted: 1, skipped: 2 });
    const byGoogleId = new Map(dataset.calendarEvents.map((e) => [e.google_event_id, e]));
    expect([...byGoogleId.keys()].sort()).toEqual(["g-a", "g-b", "g-c"]);
    expect(byGoogleId.get("g-b")).toMatchObject({ id: "b", summary: "New name" });
    expect(byGoogleId.get("g-c")).toMatchObject({ summary: "Brand new" });
    expect(byGoogleId.get("g-a")?.imported_at).toBeTruthy(); // stamped even though nothing changed
    expect(triggerReprocessing).toHaveBeenCalledWith("calendar_events", "bronze", expect.anything());
  });

  it("says so when the calendar has nothing in the range", async () => {
    listEvents.mockResolvedValue([]);

    const res = await post();

    expect(await res.json()).toMatchObject({ success: true, imported: 0, message: "No calendar events found in date range" });
    expect(dataset.calendarEvents).toHaveLength(3);
  });

  it("carries on when it can't read what is stored: everything looks new, and the upsert keeps the ids", async () => {
    vi.spyOn(repos.calendarEvents, "startingBetween").mockRejectedValue(new Error("db down"));

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 3, updated: 0 });
    expect(dataset.calendarEvents.find((e) => e.google_event_id === "g-b")).toMatchObject({ id: "b", summary: "New name" });
  });

  it("carries on when the stale delete or the sync stamp fails", async () => {
    vi.spyOn(repos.calendarEvents, "deleteStale").mockRejectedValue(new Error("rpc down"));
    vi.spyOn(repos.calendarEvents, "touchImported").mockRejectedValue(new Error("stamp failed"));

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deleted: 0, imported: 1, updated: 1 });
    expect(dataset.calendarEvents.some((e) => e.google_event_id === "g-gone")).toBe(true);
  });

  it("fails with a 500 when the new items can't be saved", async () => {
    vi.spyOn(repos.calendarEvents, "upsert").mockRejectedValue(new Error("insert failed"));

    const res = await post();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to insert calendar events" });
  });

  it("counts an update that fails as skipped, not updated", async () => {
    vi.spyOn(repos.calendarEvents, "update").mockRejectedValue(new Error("update failed"));

    const res = await post();

    expect(await res.json()).toMatchObject({ updated: 0, skipped: 3 });
  });

  it("answers 500 with the message when Google can't be read", async () => {
    listEvents.mockRejectedValue(new Error("Google is down"));

    const res = await post();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Google is down" });
  });

  it("refuses signed-out callers and non-admins, and a body that isn't JSON", async () => {
    auth = { user: null };
    expect((await post()).status).toBe(401);
    auth = { user: { id: "u" }, forbidden: true };
    expect((await post()).status).toBe(403);
    auth = { user: { id: "admin" } };
    expect((await POST(new NextRequest("http://localhost/api/import/calendar", { method: "POST", body: "not json" }))).status).toBe(400);
  });
});
