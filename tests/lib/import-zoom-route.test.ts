import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { PRIMARY_ZOOM_ACCOUNT_ID } from "@/lib/zoom-accounts";

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
// One fake Zoom client per credentials prefix; a prefix with no entry is an account whose credentials are not configured.
const clients = new Map<string, { listMeetings: typeof listMeetings; getParticipants: typeof getParticipants }>();
vi.mock("@/lib/zoom/client", () => ({ createZoomClientForPrefix: (prefix: string) => clients.get(prefix) ?? null }));
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
  clients.clear();
  clients.set("ZOOM", { listMeetings, getParticipants });
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

  describe("with a second account", () => {
    const personalMeeting = { ...meeting, uuid: "uuid-2", id: 222, topic: "Dentist call" };
    const secondaryListMeetings = vi.fn();
    const secondaryParticipants = vi.fn();
    let secondaryId: string;

    beforeEach(async () => {
      secondaryListMeetings.mockReset().mockResolvedValue([personalMeeting]);
      secondaryParticipants.mockReset().mockResolvedValue([participant("Cy Example", "2026-10-01T13:05:00Z")]);
      const account = await repos.zoom.createAccount({ slug: "secondary", label: "Secondary", hostEmail: null, defaultPolicy: "exclude", credentialsPrefix: "ZOOM_SECONDARY" });
      secondaryId = account.id;
    });

    it("imports every configured account, tagging each row with its account", async () => {
      clients.set("ZOOM_SECONDARY", { listMeetings: secondaryListMeetings, getParticipants: secondaryParticipants });

      const res = await post({ ...RANGE, skipProcessing: true });

      expect(await res.json()).toMatchObject({
        meetings: 2,
        totalAttendees: 3,
        accounts: [
          { account: "primary", meetings: 1, attendees: 2 },
          { account: "secondary", meetings: 1, attendees: 1 },
        ],
      });
      expect(dataset.zoomMeetings.map((m) => [m.meeting_uuid, m.zoom_account])).toEqual([
        ["uuid-1", PRIMARY_ZOOM_ACCOUNT_ID],
        ["uuid-2", secondaryId],
      ]);
      expect(dataset.zoomAttendees.filter((a) => a.meeting_uuid === "uuid-2").map((a) => a.zoom_account)).toEqual([secondaryId]);
    });

    it("skips an account whose credentials are not configured, with a note, and still imports the primary one", async () => {
      const res = await post({ ...RANGE, skipProcessing: true });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meetings).toBe(1);
      expect(body.accounts).toEqual([
        { account: "primary", meetings: 1, attendees: 2 },
        { account: "secondary", meetings: 0, attendees: 0, skipped: expect.stringContaining("ZOOM_SECONDARY_ACCOUNT_ID") },
      ]);
    });

    it("never lets a failing secondary account fail the primary import", async () => {
      secondaryListMeetings.mockRejectedValue(new Error("Zoom said no"));
      clients.set("ZOOM_SECONDARY", { listMeetings: secondaryListMeetings, getParticipants: secondaryParticipants });

      const res = await post({ ...RANGE, skipProcessing: true });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meetings).toBe(1);
      expect(body.accounts[1]).toMatchObject({ account: "secondary", skipped: "import failed: Zoom said no" });
      expect(dataset.zoomMeetings.map((m) => m.meeting_uuid)).toEqual(["uuid-1"]);
    });

    it("imports only the named account when asked (a webhook names its own)", async () => {
      clients.set("ZOOM_SECONDARY", { listMeetings: secondaryListMeetings, getParticipants: secondaryParticipants });

      await post({ ...RANGE, skipProcessing: true, account: "secondary" });

      expect(listMeetings).not.toHaveBeenCalled();
      expect(dataset.zoomMeetings.map((m) => m.meeting_uuid)).toEqual(["uuid-2"]);
    });

    it("is idempotent across both accounts", async () => {
      clients.set("ZOOM_SECONDARY", { listMeetings: secondaryListMeetings, getParticipants: secondaryParticipants });
      await post({ ...RANGE, skipProcessing: true });
      await post({ ...RANGE, skipProcessing: true });

      expect(dataset.zoomMeetings).toHaveLength(2);
      expect(dataset.zoomAttendees).toHaveLength(3);
    });

    it("still fails the import when the primary account has no credentials", async () => {
      clients.delete("ZOOM");

      const res = await post({ ...RANGE, skipProcessing: true });

      expect(res.status).toBe(500);
      expect((await res.json()).error).toContain("ZOOM_ACCOUNT_ID");
    });
  });
});
