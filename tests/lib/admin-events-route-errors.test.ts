import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The admin event routes answer a repository failure with a 500 (or 404 when the event can't be loaded)
// and its message, and a missing event with 404.

const remove = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: { storage: { from: () => ({ remove }) } } }),
}));

let calendarSource: unknown = null;
let calendarFails = false;
const events = {
  listWithPhotoCounts: vi.fn(),
  byId: vi.fn(),
  edit: vi.fn(),
  setDeletedAt: vi.fn(),
  remove: vi.fn(),
  allPhotosOf: vi.fn(),
  photoPaths: vi.fn(),
  attendeesOf: vi.fn(),
};
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    events,
    badges: { typeForEvent: async () => null },
    prickles: { byCalendarEventIds: async () => [] },
    // The Bronze calendar item the event follows (the test sets `calendarSource`, or makes the read fail).
    calendarEvents: { byId: async () => { if (calendarFails) throw new Error("calendar read failed"); return calendarSource; } },
  }),
}));
vi.mock("@/lib/calendar-events", async () => ({
  ...(await vi.importActual<typeof import("@/lib/calendar-events")>("@/lib/calendar-events")),
  syncCalendarEvent: vi.fn(async () => undefined),
}));

import { GET as list } from "@/app/api/admin/events/route";
import { GET as read, DELETE as destroy } from "@/app/api/admin/events/[id]/route";
import { POST as visibility } from "@/app/api/admin/events/[id]/visibility/route";

const ID = "evt_AAAAAAAAAAA1";
const ctx = { params: Promise.resolve({ id: ID }) };
const request = (body?: unknown) => new NextRequest("http://localhost/api/admin/events", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const EVENT = { id: ID, title: "Open house", prickle_id: "prkl_AAAAAAAAAAA1" };

beforeEach(() => {
  vi.clearAllMocks();
  calendarSource = null;
  calendarFails = false;
  events.allPhotosOf.mockResolvedValue([]);
  events.attendeesOf.mockResolvedValue([]);
});

describe("GET /api/admin/events", () => {
  it("answers 500 with the message when the list can't be read", async () => {
    events.listWithPhotoCounts.mockRejectedValue(new Error("boom"));
    const res = await list(request());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });

  it("returns the events", async () => {
    events.listWithPhotoCounts.mockResolvedValue([{ ...EVENT, photo_count: 2 }]);
    const res = await list(request());
    expect((await res.json()).events).toEqual([{ ...EVENT, photo_count: 2 }]);
  });
});

describe("GET /api/admin/events/[id]", () => {
  it("is 404 when the event can't be loaded, or isn't there", async () => {
    events.byId.mockRejectedValue(new Error("boom"));
    expect((await read(request(), ctx)).status).toBe(404);
    events.byId.mockResolvedValue(null);
    const res = await read(request(), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Event not found");
  });

  it("is 500 when its photos or attendees can't be read", async () => {
    events.byId.mockResolvedValue(EVENT);
    events.allPhotosOf.mockRejectedValue(new Error("no photos"));
    const res = await read(request(), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("no photos");
  });
});

describe("DELETE /api/admin/events/[id]", () => {
  it("removes the photo files, then the event", async () => {
    events.photoPaths.mockResolvedValue(["a.jpg"]);
    const res = await destroy(request(), ctx);
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(["a.jpg"]);
    expect(events.remove).toHaveBeenCalledWith(ID);
  });

  it("is 500 with the message when the event can't be deleted", async () => {
    events.photoPaths.mockResolvedValue([]);
    events.remove.mockRejectedValue(new Error("in use"));
    const res = await destroy(request(), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("in use");
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/events/[id]/visibility", () => {
  it("is 500 with the message when the change fails", async () => {
    events.setDeletedAt.mockRejectedValue(new Error("no write"));
    const res = await visibility(request({ hidden: true }), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("no write");
  });

  it("is 404 for an unknown event", async () => {
    events.setDeletedAt.mockResolvedValue(null);
    expect((await visibility(request({ hidden: false }), ctx)).status).toBe(404);
  });
});
