import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// The prickles of the meetings a Zoom name appeared in come from their repository, in memory here;
// the bronze attendees go through a fake client.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
let tables: FakeTables = {};
let signedIn = true;
let admin = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () =>
    !signedIn ? { user: null } : !admin ? { user: { id: "u" }, forbidden: true } : { user: { id: "admin" }, supabase: createFakeSupabase(tables) },
}));

import { GET } from "@/app/api/zoom/prickles/route";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false };
const pup = (id: string, uuid: string, start: string, typeId: string | null = SPRINT.id) => ({
  id, typeId, hostId: null, title: null, source: "zoom", calendarEventId: null, zoomMeetingUuid: uuid, startTime: start, endTime: start,
});
const get = (query = "?zoomName=Ada%20E") => GET(new NextRequest(`http://localhost/api/zoom/prickles${query}`));

beforeEach(() => {
  signedIn = true;
  admin = true;
  tables = { "bronze.zoom_attendees": { data: [{ meeting_uuid: "m1" }, { meeting_uuid: "m2" }, { meeting_uuid: "m1" }, { meeting_uuid: null }] } };
  repos = createInMemoryRepos(
    new InMemoryDataset({
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
    tables["bronze.zoom_attendees"] = { data: [] };
    expect((await (await get()).json()).prickles).toEqual([]);
    tables["bronze.zoom_attendees"] = { data: [{ meeting_uuid: null }] };
    expect((await (await get()).json()).prickles).toEqual([]);
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
