import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// The "gifted by" link on an event attendee: set and cleared by the attendee routes, returned by the event GET.

const state = vi.hoisted(() => ({ repos: null as unknown, rpcCalls: [] as unknown[] }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({
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
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
let dataset: InMemoryDataset;

beforeEach(() => {
  state.rpcCalls = [];
  dataset = new InMemoryDataset({
    ...eventSeed([{ id: EVENT, title: "Open house", slug: "open-house" }]),
    members: [
      { id: ADA, name: "Ada Example", displayName: "Ada E", email: "ada@example.com" },
      { id: BO, name: "Bo Example", displayName: null, email: "bo@example.com" },
    ],
    eventAttendees: [{ id: "a1", event_id: EVENT, member_id: BO, created_at: "2097-01-02T00:00:00Z", created_by: null, ticket_source: "gifted" }],
  } as never);
  state.repos = createInMemoryRepos(dataset);
});

const params = { params: Promise.resolve({ id: EVENT, memberId: BO }) };
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), params);
const add = (body: unknown) => POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: EVENT }) });
const eventBody = async () => (await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: EVENT }) })).json();

describe("ticket giver routes", () => {
  it("sets the giver, returns them on the event with their display name, and clears them", async () => {
    expect((await patch({ ticketGiverId: ADA })).status).toBe(200);
    expect((await eventBody()).attendees[0].ticketGiver).toEqual({ id: ADA, name: "Ada E" });

    // A gifted ticket always has a giver, so clearing it alone is refused and the giver stays.
    const cleared = await patch({ ticketGiverId: null });
    expect(cleared.status).toBe(400);
    expect((await cleared.json()).error).toBe("Pick who gave the ticket");
    expect((await eventBody()).attendees[0].ticketGiver).toEqual({ id: ADA, name: "Ada E" });
  });

  it("needs a giver in the same request to set gifted, unless the row already has one", async () => {
    await patch({ ticketSource: "comped" });
    expect((await patch({ ticketSource: "gifted" })).status).toBe(400);
    expect(dataset.eventAttendees[0].ticket_source).toBe("comped");
    expect((await patch({ ticketSource: "gifted", ticketGiverId: ADA })).status).toBe(200);
    expect((await patch({ ticketNote: "thanks" })).status).toBe(200);
    expect(dataset.eventAttendees[0]).toMatchObject({ ticket_source: "gifted", ticket_giver_id: ADA });
  });

  it("refuses a gifted attendee without a giver, or with an unknown one, and adds nobody", async () => {
    const noGiver = await add({ memberId: ADA, ticketSource: "gifted" });
    expect(noGiver.status).toBe(400);
    expect((await noGiver.json()).error).toBe("Pick who gave the ticket");
    expect((await add({ memberId: ADA, ticketSource: "gifted", ticketGiverId: "mbr_ZZZZZZZZZZZ9" })).status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
  });

  it("answers 400, never 500, for a bad id, a self-gift, a giver without a gift and an unknown member", async () => {
    expect((await patch({ ticketGiverId: "not-an-id" })).status).toBe(400);
    expect((await patch({ ticketGiverId: BO })).status).toBe(400);
    expect((await patch({ ticketGiverId: "mbr_ZZZZZZZZZZZ9" })).status).toBe(400);
    await patch({ ticketSource: "comped" });
    expect((await patch({ ticketGiverId: ADA })).status).toBe(400);
  });

  it("clears the giver when the source changes away from gifted", async () => {
    await patch({ ticketGiverId: ADA });
    await patch({ ticketSource: "comped" });
    expect(dataset.eventAttendees[0].ticket_giver_id).toBeNull();
  });

  it("accepts a giver when adding a gifted attendee, and refuses one on another source or a self-gift", async () => {
    expect((await add({ memberId: ADA, ticketSource: "gifted", ticketGiverId: ADA })).status).toBe(400);
    expect((await add({ memberId: ADA, ticketSource: "comped", ticketGiverId: BO })).status).toBe(400);
    expect(state.rpcCalls).toEqual([]);

    // The add function is faked, so put the attendee row where it would have.
    dataset.eventAttendees.push({ id: "a2", event_id: EVENT, member_id: ADA });
    expect((await add({ memberId: ADA, ticketSource: "gifted", ticketGiverId: BO })).status).toBe(201);
    expect(dataset.eventAttendees.find((a) => a.member_id === ADA)?.ticket_giver_id).toBe(BO);
  });

  it("says when the member is not an attendee", async () => {
    const res = await PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ ticketGiverId: BO }) }), {
      params: Promise.resolve({ id: EVENT, memberId: ADA }),
    });
    expect(res.status).toBe(404);
  });
});
