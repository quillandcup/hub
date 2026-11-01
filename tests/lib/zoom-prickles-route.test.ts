import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { zoomAttendee } from "@/tests/helpers/zoom-fixtures";

// The prickles of the meetings a Zoom name appeared in and the attendees both come from the repositories, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let signedIn = true;
let admin = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () =>
    !signedIn ? { user: null } : !admin ? { user: { id: "u" }, forbidden: true } : { user: { id: "admin" }, supabase: {} },
}));

import { GET } from "@/app/api/zoom/prickles/route";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const pup = (id: string, uuid: string, start: string, typeId: string | null = SPRINT.id) => ({
  id, typeId, hostId: null, title: null, source: "zoom", calendarEventId: null, zoomMeetingUuid: uuid, startTime: start, endTime: start,
});
const get = (query = "?zoomName=Ada%20E") => GET(new NextRequest(`http://localhost/api/zoom/prickles${query}`));

beforeEach(() => {
  signedIn = true;
  admin = true;
  repos = createInMemoryRepos(
    new InMemoryDataset({
      zoomAttendees: [
        zoomAttendee({ name: "Ada E", meeting_uuid: "m1" }),
        zoomAttendee({ name: "Ada E", meeting_uuid: "m2" }),
        zoomAttendee({ name: "Ada E", meeting_uuid: "m1" }),
        zoomAttendee({ name: "Ada E", meeting_uuid: null }),
        zoomAttendee({ name: "Someone Else", meeting_uuid: "m3" }),
      ],
      prickleTypes: [SPRINT],
      prickles: [pup("prkl_AAAAAAAAAAA1", "m1", "2026-10-01T15:00:00Z"), pup("prkl_AAAAAAAAAAA2", "m2", "2026-10-08T15:00:00Z", null), pup("prkl_AAAAAAAAAAA3", "m3", "2026-10-15T15:00:00Z")],
    }),
  );
});

describe("GET /api/zoom/prickles", () => {
  it("lists, newest first, the prickles of the meetings the Zoom name appeared in", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()).prickles).toEqual([
      { id: "prkl_AAAAAAAAAAA2", start_time: "2026-10-08T15:00:00Z", end_time: "2026-10-08T15:00:00Z", type_name: "Unknown" },
      { id: "prkl_AAAAAAAAAAA1", start_time: "2026-10-01T15:00:00Z", end_time: "2026-10-01T15:00:00Z", type_name: "Sprint" },
    ]);
  });

  it("is empty for a name that never appeared, or whose attendees have no meeting", async () => {
    expect((await (await get("?zoomName=Never%20Seen")).json()).prickles).toEqual([]);
    repos = createInMemoryRepos(new InMemoryDataset({ zoomAttendees: [zoomAttendee({ name: "Ada E", meeting_uuid: null })] }));
    expect((await (await get()).json()).prickles).toEqual([]);
  });

  it("answers 500 with the database's message when the attendees can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.zoom.meetingUuidsForName = async () => {
      throw new Error("attendees unavailable");
    };

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "attendees unavailable" });
  });

  it("answers 400 without a name, 401 signed out and 403 for a non-admin", async () => {
    expect((await get("")).status).toBe(400);
    signedIn = false;
    expect((await get()).status).toBe(401);
    signedIn = true;
    admin = false;
    expect((await get()).status).toBe(403);
  });
});
