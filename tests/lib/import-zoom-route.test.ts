import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The Bronze writes go through the Zoom repository, in memory here; Zoom's own API and the downstream
// reprocessing are faked.
let dataset = new InMemoryDataset();
let repos = createInMemoryRepos(dataset);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let signedIn = true;
let admin = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (!signedIn ? { user: null } : !admin ? { user: { id: "u" }, forbidden: true } : { user: { id: "admin" }, supabase: {} }),
}));
const listMeetings = vi.fn();
const getParticipants = vi.fn();
vi.mock("@/lib/zoom/client", () => ({ createZoomClient: () => ({ listMeetings, getParticipants }) }));
const triggerReprocessing = vi.fn(async (table: string) => ({ table, ok: true }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (table: string) => triggerReprocessing(table) }));

import { POST } from "@/app/api/import/zoom/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/import/zoom", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const RANGE = { fromDate: "2026-10-01", toDate: "2026-10-07" };

const meeting = { uuid: "uuid-1", id: 111, topic: "Morning Writing", start_time: "2026-10-01T13:00:00Z", end_time: "2026-10-01T14:00:00Z", duration: 60, host_email: "host@example.test", host_name: "Host Example", participants_count: 2 };
const participant = (name: string, join: string) => ({ id: `p-${name}`, user_id: "", registrant_id: "", name, user_email: "", join_time: join, leave_time: "2026-10-01T13:50:00Z", duration: 40 });

beforeEach(() => {
  signedIn = true;
  admin = true;
  dataset = new InMemoryDataset();
  repos = createInMemoryRepos(dataset);
  listMeetings.mockReset().mockResolvedValue([meeting]);
  getParticipants.mockReset().mockResolvedValue([participant("Ada Example", "2026-10-01T13:05:00Z"), participant("Bea Example", "2026-10-01T13:10:00Z")]);
  triggerReprocessing.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/import/zoom", () => {
  it("stores the meeting and its participants, then reprocesses both Bronze tables", async () => {
    const res = await post(RANGE);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, meetings: 1, totalAttendees: 2, data: [{ uuid: "uuid-1", participants: 2 }] });
    expect(dataset.zoomMeetings).toMatchObject([{ meeting_uuid: "uuid-1", meeting_id: "111", topic: "Morning Writing", host_email: "host@example.test", participant_count: 2 }]);
    expect(dataset.zoomAttendees.map((a) => [a.name, a.email, a.user_id, a.meeting_uuid, a.meeting_id, a.topic])).toEqual([
      ["Ada Example", null, null, "uuid-1", "111", "Morning Writing"],
      ["Bea Example", null, null, "uuid-1", "111", "Morning Writing"],
    ]);
    expect(triggerReprocessing.mock.calls.map((c) => c[0])).toEqual(["zoom_attendees", "zoom_meetings"]);
  });

  it("is idempotent: importing the same range again changes nothing", async () => {
    await post({ ...RANGE, skipProcessing: true });
    const res = await post({ ...RANGE, skipProcessing: true });

    expect(await res.json()).toMatchObject({ reprocessing: "skipped" });
    expect(dataset.zoomMeetings).toHaveLength(1);
    expect(dataset.zoomAttendees).toHaveLength(2);
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });

  it("stores a meeting nobody joined without touching the attendees", async () => {
    getParticipants.mockResolvedValue([]);

    const res = await post({ ...RANGE, skipProcessing: true });

    expect(await res.json()).toMatchObject({ meetings: 1, totalAttendees: 0 });
    expect(dataset.zoomAttendees).toEqual([]);
  });

  it("answers 400 for a bad body or missing dates, 401 signed out and 403 for a non-admin", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ fromDate: "2026-10-01" })).status).toBe(400);
    signedIn = false;
    expect((await post(RANGE)).status).toBe(401);
    signedIn = true;
    admin = false;
    expect((await post(RANGE)).status).toBe(403);
  });

  it("reports a failed meeting write or attendee write as a 500 with the database's message", async () => {
    repos.zoom.upsertMeeting = async () => {
      throw new Error("meeting write failed");
    };
    const first = await post(RANGE);
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: "meeting write failed" });

    repos = createInMemoryRepos(dataset);
    repos.zoom.upsertAttendees = async () => {
      throw new Error("attendee write failed");
    };
    const second = await post(RANGE);
    expect(second.status).toBe(500);
    expect(await second.json()).toEqual({ error: "attendee write failed" });
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });
});
