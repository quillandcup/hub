import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// The origin event of a transferred ticket: set and cleared by the attendee routes, returned by the event GET.

const state = vi.hoisted(() => ({ repos: null as unknown, rpcCalls: [] as unknown[] }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireApiPermission: async () => ({
    user: { id: "admin" },
    supabase: {
      rpc: async (name: string, args: unknown) => {
        state.rpcCalls.push([name, args]);
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => state.repos,
}));

import { GET } from "@/app/api/admin/events/[id]/route";
import { POST } from "@/app/api/admin/events/[id]/attendees/route";
import { PATCH } from "@/app/api/admin/events/[id]/attendees/[memberId]/route";

const EVENT = "evt_AAAAAAAAAAA1";
const SPRING = "evt_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
let dataset: InMemoryDataset;

beforeEach(() => {
  state.rpcCalls = [];
  dataset = new InMemoryDataset({
    ...eventSeed([
      { id: EVENT, title: "Autumn retreat", slug: "autumn" },
      { id: SPRING, title: "Spring retreat", slug: "spring" },
    ]),
    members: [
      { id: ADA, name: "Ada Example", displayName: "Ada E", email: "ada@example.com" },
      { id: BO, name: "Bo Example", displayName: null, email: "bo@example.com" },
    ],
    eventAttendees: [{ id: "a1", event_id: EVENT, member_id: BO, created_at: "2097-01-02T00:00:00Z", created_by: null }],
  } as never);
  state.repos = createInMemoryRepos(dataset);
});

const params = { params: Promise.resolve({ id: EVENT, memberId: BO }) };
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), params);
const add = (body: unknown) => POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: EVENT }) });
const eventBody = async () => (await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: EVENT }) })).json();

describe("ticket origin routes", () => {
  it("sets the source and the origin together, returns the origin with its title and the other events to pick from", async () => {
    expect((await patch({ ticketSource: "transferred", ticketFromEventId: SPRING })).status).toBe(200);

    const body = await eventBody();
    expect(body.attendees[0]).toMatchObject({ ticketSource: "transferred", ticketFromEvent: { id: SPRING, title: "Spring retreat" } });
    expect(body.otherEvents).toEqual([{ id: SPRING, title: "Spring retreat" }]);
  });

  it("refuses a transferred source without an origin, with an unknown or this event, and an origin on another source", async () => {
    const missing = await patch({ ticketSource: "transferred" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("Pick the event the ticket was bought for");
    expect((await patch({ ticketSource: "transferred", ticketFromEventId: "evt_ZZZZZZZZZZZ9" })).status).toBe(400);
    expect((await patch({ ticketSource: "transferred", ticketFromEventId: EVENT })).status).toBe(400);
    expect((await patch({ ticketSource: "comped", ticketFromEventId: SPRING })).status).toBe(400);
    expect((await patch({ ticketFromEventId: SPRING })).status).toBe(400);
    expect((await patch({ ticketFromEventId: "not-an-id" })).status).toBe(400);
    expect(dataset.eventAttendees[0].ticket_source ?? null).toBeNull();
  });

  it("clears the origin when the source changes away from transferred, and refuses to clear it alone", async () => {
    await patch({ ticketSource: "transferred", ticketFromEventId: SPRING });
    expect((await patch({ ticketFromEventId: null })).status).toBe(400);
    expect(dataset.eventAttendees[0].ticket_from_event_id).toBe(SPRING);

    expect((await patch({ ticketSource: "comped" })).status).toBe(200);
    expect(dataset.eventAttendees[0].ticket_from_event_id).toBeNull();
  });

  it("checks the origin before adding a transferred attendee, and adds nobody on a refusal", async () => {
    expect((await add({ memberId: ADA, ticketSource: "transferred" })).status).toBe(400);
    expect((await add({ memberId: ADA, ticketSource: "transferred", ticketFromEventId: EVENT })).status).toBe(400);
    expect((await add({ memberId: ADA, ticketSource: "transferred", ticketFromEventId: "evt_ZZZZZZZZZZZ9" })).status).toBe(400);
    expect((await add({ memberId: ADA, ticketSource: "comped", ticketFromEventId: SPRING })).status).toBe(400);
    expect((await add({ memberId: ADA, ticketFromEventId: SPRING })).status).toBe(400);
    expect(state.rpcCalls).toEqual([]);

    // The add function is faked, so put the attendee row where it would have.
    dataset.eventAttendees.push({ id: "a2", event_id: EVENT, member_id: ADA });
    expect((await add({ memberId: ADA, ticketSource: "transferred", ticketFromEventId: SPRING })).status).toBe(201);
    expect(dataset.eventAttendees.find((a) => a.member_id === ADA)).toMatchObject({ ticket_source: "transferred", ticket_from_event_id: SPRING });
  });
});
