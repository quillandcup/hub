import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// Marking a ticket buyer as not attending an event, and undoing it.

const state = vi.hoisted(() => ({ repos: null as unknown, auth: "ok" as "ok" | "anonymous" | "forbidden", userId: "00000000-0000-4000-8000-0000000000a1" }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireApiPermission: async () => ({
    user: state.auth === "anonymous" ? null : { id: state.userId },
    forbidden: state.auth === "forbidden",
    supabase: {},
  }),
}));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => state.repos,
}));

import { POST } from "@/app/api/admin/events/[id]/not-attending/route";
import { DELETE } from "@/app/api/admin/events/[id]/not-attending/[memberId]/route";

const EVENT = "evt_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
let dataset: InMemoryDataset;

beforeEach(() => {
  state.auth = "ok";
  state.userId = "00000000-0000-4000-8000-0000000000a1";
  dataset = new InMemoryDataset({
    ...eventSeed([{ id: EVENT, title: "Open house", slug: "open-house" }]),
    members: [
      { id: ADA, name: "Ada Example", displayName: null, email: "ada@example.com" },
      { id: BO, name: "Bo Example", displayName: null, email: "bo@example.com" },
    ],
    eventAttendees: [{ id: "a1", event_id: EVENT, member_id: BO, created_at: "2097-01-02T00:00:00Z", created_by: null }],
  } as never);
  state.repos = createInMemoryRepos(dataset);
});

const post = (body: unknown, id = EVENT) => POST(new NextRequest("http://localhost/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const del = (memberId: string, id = EVENT) => DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id, memberId }) });

describe("POST /api/admin/events/[id]/not-attending", () => {
  it("marks a buyer with a reason and records who did it", async () => {
    const res = await post({ memberId: ADA, reason: "forfeited" });

    expect(res.status).toBe(201);
    expect(dataset.eventNotAttending).toMatchObject([{ event_id: EVENT, member_id: ADA, reason: "forfeited", note: null, created_by: state.userId }]);
  });

  it("keeps a note with Other, trimmed, and records no admin for the service role", async () => {
    state.userId = "service-role";

    expect((await post({ memberId: ADA, reason: "other", note: "  ticket moved to autumn " })).status).toBe(201);

    expect(dataset.eventNotAttending[0]).toMatchObject({ reason: "other", note: "ticket moved to autumn", created_by: null });
  });

  it("answers 400 for a body that is not JSON, a bad member id, an unknown reason, Other without a note and a note too long", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ memberId: "not-an-id", reason: "forfeited" })).status).toBe(400);
    expect((await post({ reason: "forfeited" })).status).toBe(400);
    expect((await post({ memberId: ADA, reason: "refunded" })).status).toBe(400);
    expect((await post({ memberId: ADA, reason: "forfeited", note: 5 })).status).toBe(400);
    const noNote = await post({ memberId: ADA, reason: "other", note: "  " });
    expect(noNote.status).toBe(400);
    expect((await noNote.json()).error).toBe("Say what happened: a note is needed for Other.");
    expect((await post({ memberId: ADA, reason: "other", note: "x".repeat(501) })).status).toBe(400);
    expect(dataset.eventNotAttending).toEqual([]);
  });

  it("answers 409 for a member who is on the roster, and 404 for an unknown event or member", async () => {
    const onRoster = await post({ memberId: BO, reason: "forfeited" });
    expect(onRoster.status).toBe(409);
    expect((await onRoster.json()).error).toMatch(/attendee list/);
    expect((await post({ memberId: ADA, reason: "forfeited" }, "evt_ZZZZZZZZZZZ9")).status).toBe(404);
    expect((await post({ memberId: "mbr_ZZZZZZZZZZZ9", reason: "forfeited" })).status).toBe(404);
    expect(dataset.eventNotAttending).toEqual([]);
  });

  it("answers 500 when the repository fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    (state.repos as { events: { markNotAttending: unknown } }).events.markNotAttending = async () => {
      throw new Error("boom");
    };

    expect((await post({ memberId: ADA, reason: "forfeited" })).status).toBe(500);
  });

  it("needs a signed-in admin with the events permission", async () => {
    state.auth = "anonymous";
    expect((await post({ memberId: ADA, reason: "forfeited" })).status).toBe(401);
    state.auth = "forbidden";
    expect((await post({ memberId: ADA, reason: "forfeited" })).status).toBe(403);
    expect(dataset.eventNotAttending).toEqual([]);
  });
});

describe("DELETE /api/admin/events/[id]/not-attending/[memberId]", () => {
  it("removes the mark, and says when there is none", async () => {
    await post({ memberId: ADA, reason: "forfeited" });

    expect((await del(ADA)).status).toBe(200);
    expect(dataset.eventNotAttending).toEqual([]);
    expect((await del(ADA)).status).toBe(404);
  });

  it("answers 400 for a bad member id and 500 when the repository fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await del("not-an-id")).status).toBe(400);
    (state.repos as { events: { unmarkNotAttending: unknown } }).events.unmarkNotAttending = async () => {
      throw new Error("boom");
    };
    expect((await del(ADA)).status).toBe(500);
  });

  it("needs a signed-in admin with the events permission", async () => {
    state.auth = "anonymous";
    expect((await del(ADA)).status).toBe(401);
    state.auth = "forbidden";
    expect((await del(ADA)).status).toBe(403);
  });
});
