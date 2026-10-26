import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// Resolving unmatched calendar events creates prickles (and, for a new name, the prickle type)
// through the prickle repository, in memory here; the other tables go through a fake client.

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => ({ ...actual.createRepos(db), ...actual.createInMemoryRepos(dataset) }),
  };
});

let tables: FakeTables = {};
let fake = createFakeSupabase();
let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, supabase: fake } : { user: null }),
}));

import { POST as resolveOne } from "@/app/api/prickle-types/resolve/route";
import { POST as resolveBatch } from "@/app/api/prickle-types/resolve-batch/route";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" };
const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, isSpecialty: false };

const post = (route: typeof resolveOne, body: unknown) =>
  route(new NextRequest("http://localhost/api/prickle-types/resolve", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  signedIn = true;
  tables = { member_name_aliases: { data: [] }, unmatched_calendar_events: { data: [] } };
  fake = createFakeSupabase(tables);
  dataset = new InMemoryDataset({ members: [ADA], prickleTypes: [SPRINT] });
});

describe("POST /api/prickle-types/resolve", () => {
  const body = { unmatchedEventId: "u1", calendarEventId: "c1", startTime: "2097-03-03T15:00:00Z", endTime: "2097-03-03T16:00:00Z" };

  it("creates a calendar prickle of the chosen type with the host matched by name", async () => {
    const res = await post(resolveOne, { ...body, mode: "existing", typeId: SPRINT.id, host: "Ada Example" });

    expect(res.status).toBe(200);
    expect(dataset.prickles).toHaveLength(1);
    expect(dataset.prickles[0]).toMatchObject({ typeId: SPRINT.id, hostId: ADA.id, source: "calendar", startTime: body.startTime });
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
    tables["bronze.calendar_events"] = {
      data: [
        { id: "c1", start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z", description: "<p>Hello</p>" },
        { id: "c2", start_time: "2097-03-10T15:00:00Z", end_time: "2097-03-10T16:00:00Z", description: null },
      ],
    };

    const res = await post(resolveBatch, { unmatchedEventIds: ["u1", "u2"], calendarEventIds: ["c1", "c2"], mode: "existing", typeId: SPRINT.id, host: "Ada Example" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, count: 2 });
    expect(dataset.prickles.map((p) => [p.typeId, p.hostId, p.startTime])).toEqual([
      [SPRINT.id, ADA.id, "2097-03-03T15:00:00Z"],
      [SPRINT.id, ADA.id, "2097-03-10T15:00:00Z"],
    ]);
  });

  it("creates the new type once for the batch", async () => {
    tables["bronze.calendar_events"] = { data: [{ id: "c1", start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z", description: null }] };

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
