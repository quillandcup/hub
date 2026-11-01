import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// Events made in the Hub keep their schedule on a Hub session projected into a prickle; an event on a
// calendar prickle leaves its schedule to the prickle.

let repos = createInMemoryRepos();
let data = new InMemoryDataset();
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: {} }),
}));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { POST as create } from "@/app/api/admin/events/route";
import { GET as read, PATCH as update } from "@/app/api/admin/events/[id]/route";

const EVENT_TYPE = { id: "prty_EVENTONLY001", name: "Event", normalizedName: "event", purpose: "social", requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const BASE = { slug: "open-house", title: "Open House", event_type: "workshop", starts_at: "2097-05-01", ends_at: "2097-05-02" };
const post = (body: unknown) => create(new NextRequest("http://localhost/api/admin/events", { method: "POST", body: JSON.stringify(body) }));
const ID = "evt_AAAAAAAAAAA1";
const patch = (body: unknown) => update(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  data = new InMemoryDataset({ prickleTypes: [EVENT_TYPE] });
  repos = createInMemoryRepos(data);
});

describe("POST /api/admin/events", () => {
  it("makes a Hub session for the schedule and the event stands on its prickle", async () => {
    const res = await post({ ...BASE, location: "Cedar Lodge", host_name: "Fern Example", speakers: "Ada Example", description: "Come by" });

    expect(res.status).toBe(201);
    const { event } = await res.json();
    expect(data.hubSessions).toEqual([
      expect.objectContaining({ title: "Open House", location: "Cedar Lodge", hostName: "Fern Example", guestSpeaker: "Ada Example", description: "Come by", startTime: "2097-05-01T04:00:00.000Z", endTime: "2097-05-03T04:00:00.000Z" }),
    ]);
    const prickle = data.prickles.find((p) => p.hubSessionId === data.hubSessions[0].id)!;
    expect(prickle).toMatchObject({ title: "Open House", source: "hub", typeId: EVENT_TYPE.id });
    expect(event).toMatchObject({ slug: "open-house", prickle_id: prickle.id, title: "Open House", host_name: "Fern Example", starts_at: "2097-05-01", ends_at: "2097-05-02" });
  });

  it("takes clock times in Eastern time", async () => {
    await post({ ...BASE, ends_at: "2097-05-01", start_clock: "10:00", end_clock: "11:30" });

    expect(data.hubSessions[0]).toMatchObject({ startTime: "2097-05-01T14:00:00.000Z", endTime: "2097-05-01T15:30:00.000Z" });
  });

  it("refuses a missing or backwards window without making anything", async () => {
    for (const body of [{ ...BASE, ends_at: "2097-04-01" }, { ...BASE, start_clock: "10:00" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(data.hubSessions).toEqual([]);
  });

  it("leaves no session behind when the event can't be made (a slug already taken)", async () => {
    expect((await post(BASE)).status).toBe(201);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(BASE);

    expect(res.status).toBe(500);
    expect(data.hubSessions).toHaveLength(1);
    expect(data.prickles.filter((p) => p.source === "hub")).toHaveLength(1);
  });
});

describe("PATCH /api/admin/events/[id]", () => {
  it("edits the schedule of an event made in the Hub through its session", async () => {
    const made = await (await post({ ...BASE, host_name: "Fern Example" })).json();
    const id = made.event.id;

    const res = await update(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ title: "Open Day", location: "Room 9", host_name: "Bo Example", starts_at: "2097-05-01", ends_at: "2097-05-01", start_clock: "09:00", end_clock: "10:00", speakers: "Ada Example", focus: "Craft" }) }), { params: Promise.resolve({ id }) });

    expect(res.status).toBe(200);
    expect((await res.json()).event).toMatchObject({ title: "Open Day", location: "Room 9", host_name: "Bo Example", speakers: "Ada Example", focus: "Craft", start_time: "2097-05-01T13:00:00.000Z", end_time: "2097-05-01T14:00:00.000Z" });
    expect(data.hubSessions[0]).toMatchObject({ title: "Open Day", hostName: "Bo Example" });
  });

  it("hosts an event made in the Hub by a member or by someone who isn't one, and keeps only one of the two", async () => {
    data = new InMemoryDataset({ prickleTypes: [EVENT_TYPE], members: [{ id: "mbr_HOST00000001", name: "Fern Example" }] });
    repos = createInMemoryRepos(data);
    const made = await (await post({ ...BASE, host_name: "Bo Example" })).json();
    const edit = (body: unknown) => update(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: made.event.id }) });

    // Picking a member makes them the host and drops the free-text one.
    expect((await edit({ host_id: "mbr_HOST00000001", host_name: "Fern Example" })).status).toBe(200);
    expect(data.hubSessions[0]).toMatchObject({ hostId: "mbr_HOST00000001", hostName: null });

    // Saving again without changing the host leaves it alone.
    expect((await edit({ host_id: "mbr_HOST00000001", host_name: "Fern Example", title: "Open Day" })).status).toBe(200);
    expect(data.hubSessions[0]).toMatchObject({ hostId: "mbr_HOST00000001", hostName: null, title: "Open Day" });

    // Clearing the member and typing a name makes a guest host.
    expect((await edit({ host_id: null, host_name: "Guest Host" })).status).toBe(200);
    expect(data.hubSessions[0]).toMatchObject({ hostId: null, hostName: "Guest Host" });
  });

  it("refuses an end before the start", async () => {
    const made = await (await post(BASE)).json();
    const res = await update(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ starts_at: "2097-05-03", ends_at: "2097-05-01" }) }), { params: Promise.resolve({ id: made.event.id }) });
    expect(res.status).toBe(400);
  });

  it("leaves the schedule of an event on a calendar prickle to the prickle, and saves the rest", async () => {
    data = new InMemoryDataset({ ...eventSeed([{ id: ID, slug: "pitch-night", title: "Pitch Night", location: "Zoom" }]) });
    repos = createInMemoryRepos(data);

    const res = await patch({ title: "Renamed", location: "Elsewhere", starts_at: "2098-01-01", ends_at: "2098-01-02", speakers: "Someone", focus: "Pitching" });

    expect(res.status).toBe(200);
    expect((await res.json()).event).toMatchObject({ title: "Pitch Night", location: "Zoom", starts_at: "2097-01-01", focus: "Pitching" });
    expect(data.prickles[0]).toMatchObject({ title: "Pitch Night", location: "Zoom" });
  });

  it("is a 404 for an event that doesn't exist", async () => {
    expect((await patch({ focus: "x" })).status).toBe(404);
  });
});

describe("GET /api/admin/events/[id]", () => {
  it("says whether the event was made in the Hub and which prickle it stands on", async () => {
    const made = await (await post(BASE)).json();
    const get = (id: string) => read(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id }) });

    const hub = await (await get(made.event.id)).json();
    expect(hub).toMatchObject({ hubSession: true, prickleId: made.event.prickle_id });

    data = new InMemoryDataset(eventSeed([{ id: ID, slug: "pitch-night", title: "Pitch Night" }]));
    repos = createInMemoryRepos(data);
    expect(await (await get(ID)).json()).toMatchObject({ hubSession: false, prickleId: data.prickles[0].id });
  });
});
