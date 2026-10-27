import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The create and update routes for events carry the audience fields (who it's for, how people
// join, how many fit). A recording client captures what would be written.

let written: Record<string, unknown> | undefined;
const row = () => ({ id: "evt_AAAAAAAAAAA1", ...written });
// What the event being updated holds now (the route judges a partial update against it); it follows no calendar item.
let currentEvent: Record<string, unknown> | null = null;
const client = {
  from: () => ({
    // The update route looks the event up first to see whether it follows the calendar; this one doesn't.
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: currentEvent, error: null }) }) }),
    insert: (payload: Record<string, unknown>) => {
      written = payload;
      return { select: () => ({ single: async () => ({ data: row(), error: null }) }) };
    },
    update: (payload: Record<string, unknown>) => {
      written = payload;
      return { eq: () => ({ select: () => ({ single: async () => ({ data: row(), error: null }) }) }) };
    },
  }),
};
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: client }),
}));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({}) }));

import { POST as create } from "@/app/api/admin/events/route";
import { PATCH as update } from "@/app/api/admin/events/[id]/route";

const BASE = { slug: "build-a-query", title: "Build-a-query", event_type: "workshop", starts_at: "2097-05-01", ends_at: "2097-05-15" };
const send = (route: unknown, body: unknown) =>
  (route as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new NextRequest("http://localhost/api/admin/events", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "evt_AAAAAAAAAAA1" }) },
  );

beforeEach(() => {
  written = undefined;
  currentEvent = { announced_publicly: true, guests_allowed: false };
});

describe("POST /api/admin/events: audience", () => {
  it("stores who it's for, how people join and the speakers", async () => {
    const res = await send(create, {
      ...BASE,
      guests_allowed: true,
      announced_publicly: true,
      registration: "application",
      capacity: 7,
      selection: "selected",
      speakers: "Ada Example",
    });

    expect(res.status).toBe(201);
    expect(written).toMatchObject({
      event_type: "workshop",
      guests_allowed: true,
      announced_publicly: true,
      registration: "application",
      capacity: 7,
      selection: "selected",
      speakers: "Ada Example",
    });
  });

  it("leaves the audience to the database defaults when the request doesn't name it", async () => {
    await send(create, BASE);

    expect(written).not.toHaveProperty("registration");
    expect(written).not.toHaveProperty("capacity");
  });

  it("refuses guests at an event that isn't announced publicly", async () => {
    const res = await send(create, { ...BASE, guests_allowed: true });
    expect(res.status).toBe(400);
    expect(written).toBeUndefined();
  });

  it("rejects an unknown kind of event and a bad audience field", async () => {
    expect((await send(create, { ...BASE, event_type: "party" })).status).toBe(400);
    expect((await send(create, { ...BASE, capacity: 0 })).status).toBe(400);
    expect((await send(create, { ...BASE, registration: "walk-in" })).status).toBe(400);
    expect(written).toBeUndefined();
  });
});

describe("PATCH /api/admin/events/[id]: audience", () => {
  it("changes only the audience fields it names", async () => {
    const res = await send(update, { guests_allowed: true, capacity: null });

    expect(res.status).toBe(200);
    expect(written).toEqual({ guests_allowed: true, capacity: null, automatic: false }); // an edited event is kept
  });

  it("refuses guests at an event that isn't announced publicly, judging a partial update against what it holds", async () => {
    currentEvent = { announced_publicly: false, guests_allowed: false };
    const res = await send(update, { guests_allowed: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Guests can only be allowed at something announced publicly");
    expect(written).toBeUndefined();

    expect((await send(update, { announced_publicly: true, guests_allowed: true })).status).toBe(200);

    currentEvent = { announced_publicly: true, guests_allowed: true };
    expect((await send(update, { announced_publicly: false })).status).toBe(400);
  });

  it("accepts the new kinds of event and rejects unknown ones and bad audience fields", async () => {
    expect((await send(update, { event_type: "book_launch" })).status).toBe(200);
    expect(written).toMatchObject({ event_type: "book_launch" });
    written = undefined;
    expect((await send(update, { event_type: "party" })).status).toBe(400);
    expect((await send(update, { selection: "lottery" })).status).toBe(400);
    expect(written).toBeUndefined();
  });
});
