import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Resolving unmatched calendar events creates prickles (and, for a new name, the prickle type)
// through the prickle repository, in memory here; nothing else is read.

let dataset = new InMemoryDataset();
// When set, marking the unmatched events fails (the prickles are already made, so the route still answers 200).
let markingFails = false;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => {
      const repos = { ...actual.createRepos(db), ...actual.createInMemoryRepos(dataset) };
      if (markingFails) repos.unmatchedEvents.markResolved = async () => { throw new Error("boom"); };
      return repos;
    },
  };
});

let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, supabase: {} } : { user: null }),
}));

import { POST as resolveOne } from "@/app/api/prickle-types/resolve/route";
import { POST as resolveBatch } from "@/app/api/prickle-types/resolve-batch/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" };
const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };

/** A calendar item waiting for review. */
const queued = (id: string) => ({
  id, calendar_event_id: `c-${id}`, raw_summary: `Summary ${id}`, status: "pending", created_at: null, resolved_at: null, suggested_host: null, suggested_type: null,
  resolved_type_id: null, resolved_host_id: null, resolved_title: null, resolved_description: null, resolved_guest_speaker: null, resolved_location: null,
});
const statuses = () => dataset.unmatchedEvents.map((u) => [u.id, u.status, u.resolved_type_id]);

const post = (route: typeof resolveOne, body: unknown) =>
  route(new NextRequest("http://localhost/api/prickle-types/resolve", { method: "POST", body: JSON.stringify(body) }));

/** A Bronze calendar item, as the repository holds it. */
const calendarItem = (id: string, start: string, end: string, description: string | null) => ({
  id, google_event_id: `g-${id}`, summary: `Item ${id}`, description, location: null, raw_data: {},
  start_time: start, end_time: end,
  creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
});

beforeEach(() => {
  signedIn = true;
  markingFails = false;
  dataset = new InMemoryDataset({ members: [ADA], prickleTypes: [SPRINT], unmatchedEvents: [queued("u1"), queued("u2")] });
});

describe("POST /api/prickle-types/resolve", () => {
  const body = { unmatchedEventId: "u1", calendarEventId: "c1", startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z" };

  it("creates a calendar prickle of the chosen type with the host matched by name", async () => {
    const res = await post(resolveOne, { ...body, mode: "existing", typeId: SPRINT.id, host: "Ada Example" });

    expect(res.status).toBe(200);
    expect(dataset.prickles).toHaveLength(1);
    expect(dataset.prickles[0]).toMatchObject({ typeId: SPRINT.id, hostId: ADA.id, source: "calendar", startTime: body.startTime });
    expect(statuses()).toEqual([["u1", "resolved", SPRINT.id], ["u2", "pending", null]]);
  });

  it("links the prickle to its calendar event and takes the title and description from it, so it can be edited", async () => {
    dataset.calendarEvents = [{ ...calendarItem("c1", body.startTime, body.endTime, "<p>About it</p>"), summary: "Sprint: Deep Work" }];

    await post(resolveOne, { ...body, mode: "existing", typeId: SPRINT.id });

    expect(dataset.prickles[0]).toMatchObject({ calendarEventId: "c1", title: "Sprint: Deep Work", description: "About it" });
  });

  it("still answers 200 when marking the event resolved fails, since the prickle was made", async () => {
    markingFails = true;

    const res = await post(resolveOne, { ...body, mode: "existing", typeId: SPRINT.id });

    expect(res.status).toBe(200);
    expect(dataset.prickles).toHaveLength(1);
    expect(statuses()[0]).toEqual(["u1", "pending", null]);
  });

  it("leaves the host empty when the name matches nobody", async () => {
    await post(resolveOne, { ...body, mode: "existing", typeId: SPRINT.id, host: "Someone Unknown" });

    expect(dataset.prickles[0].hostId).toBeNull();
  });

  it("reuses a type with the same normalized name and creates a genuinely new one", async () => {
    await post(resolveOne, { ...body, mode: "new", newTypeName: "Sprint" });
    await post(resolveOne, { ...body, mode: "new", newTypeName: "Brand New Type" });

    expect(dataset.prickleTypes.map((t) => t.name)).toEqual(["Sprint", "Brand New Type"]);
    expect(dataset.prickles[0].typeId).toBe(SPRINT.id);
    expect(dataset.prickles[1].typeId).toBe(dataset.prickleTypes[1].id);
  });

  it("answers 400 without a type or required fields, and 401 when signed out", async () => {
    expect((await post(resolveOne, { ...body, mode: "existing" })).status).toBe(400);
    expect((await post(resolveOne, { unmatchedEventId: "u1" })).status).toBe(400);
    signedIn = false;
    expect((await post(resolveOne, body)).status).toBe(401);
    expect(dataset.prickles).toHaveLength(0);
  });
});

describe("POST /api/prickle-types/resolve-batch", () => {
  it("creates a prickle for each calendar event, stripping the description to text", async () => {
    dataset.calendarEvents = [
      calendarItem("c1", "2097-03-03T15:00:00Z", "2097-03-03T16:00:00Z", "<p>Hello</p>"),
      calendarItem("c2", "2097-03-10T15:00:00Z", "2097-03-10T16:00:00Z", null),
    ];

    const res = await post(resolveBatch, { unmatchedEventIds: ["u1", "u2"], calendarEventIds: ["c1", "c2"], mode: "existing", typeId: SPRINT.id, host: "Ada Example" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, count: 2 });
    expect(dataset.prickles.map((p) => [p.typeId, p.hostId, p.startTime])).toEqual([
      [SPRINT.id, ADA.id, "2097-03-03T15:00:00Z"],
      [SPRINT.id, ADA.id, "2097-03-10T15:00:00Z"],
    ]);
    expect(statuses()).toEqual([["u1", "resolved", SPRINT.id], ["u2", "resolved", SPRINT.id]]);
    expect(dataset.prickles.map((p) => p.calendarEventId)).toEqual(["c1", "c2"]);
  });

  it("still answers 200 when marking the events resolved fails", async () => {
    dataset.calendarEvents = [calendarItem("c1", "2097-03-03T15:00:00Z", "2097-03-03T16:00:00Z", null)];
    markingFails = true;

    const res = await post(resolveBatch, { unmatchedEventIds: ["u1"], calendarEventIds: ["c1"], mode: "existing", typeId: SPRINT.id });

    expect(res.status).toBe(200);
    expect(dataset.prickles).toHaveLength(1);
  });

  it("creates the new type once for the batch", async () => {
    dataset.calendarEvents = [calendarItem("c1", "2097-03-03T15:00:00Z", "2097-03-03T16:00:00Z", null)];

    await post(resolveBatch, { unmatchedEventIds: ["u1"], calendarEventIds: ["c1"], mode: "new", newTypeName: "Workshop", newTypeDescription: "A class" });

    expect(dataset.prickleTypes.map((t) => t.name)).toEqual(["Sprint", "Workshop"]);
    expect(dataset.prickles[0].typeId).toBe(dataset.prickleTypes[1].id);
  });

  it("answers 400 for missing fields, 404 when no calendar event is found, and 400 without a type", async () => {
    expect((await post(resolveBatch, { unmatchedEventIds: [], calendarEventIds: [] })).status).toBe(400);
    expect((await post(resolveBatch, { unmatchedEventIds: ["u1"], calendarEventIds: ["c1"], mode: "existing" })).status).toBe(400);
    expect((await post(resolveBatch, { unmatchedEventIds: ["u1"], calendarEventIds: ["c1"], mode: "existing", typeId: SPRINT.id })).status).toBe(404);
    expect(dataset.prickles).toHaveLength(0);
  });
});
