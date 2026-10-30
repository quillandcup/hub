import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Ignoring unmatched calendar events marks their queue rows through the repository, in memory here.

let dataset = new InMemoryDataset();
let failing = false;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    if (failing) repos.unmatchedEvents.markIgnored = async () => { throw new Error("boom"); };
    return repos;
  },
}));

let signedIn = true;
let forbidden = false;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden, supabase: {} } : { user: null }),
}));

import { POST as ignoreOne } from "@/app/api/prickle-types/ignore/route";
import { POST as ignoreBatch } from "@/app/api/prickle-types/ignore-batch/route";

const queued = (id: string) => ({
  id, calendar_event_id: `c-${id}`, raw_summary: `Summary ${id}`, status: "pending", created_at: null, resolved_at: null, suggested_host: null, suggested_type: null,
  resolved_type_id: null, resolved_host_id: null, resolved_title: null, resolved_description: null, resolved_guest_speaker: null,
});
const statuses = () => dataset.unmatchedEvents.map((u) => [u.id, u.status]);
const post = (route: typeof ignoreOne, body: unknown) => route(new NextRequest("http://localhost/api/prickle-types/ignore", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  signedIn = true;
  forbidden = false;
  failing = false;
  dataset = new InMemoryDataset({ unmatchedEvents: [queued("u1"), queued("u2"), queued("u3")] });
});

describe("POST /api/prickle-types/ignore", () => {
  it("marks one queued event ignored", async () => {
    const res = await post(ignoreOne, { unmatchedEventId: "u2" });

    expect(res.status).toBe(200);
    expect(statuses()).toEqual([["u1", "pending"], ["u2", "ignored"], ["u3", "pending"]]);
    expect(dataset.unmatchedEvents[1].resolved_at).not.toBeNull();
  });

  it("answers 500 when the update fails, 400 without an id, 401 signed out and 403 for a non-admin", async () => {
    failing = true;
    expect((await post(ignoreOne, { unmatchedEventId: "u2" })).status).toBe(500);
    failing = false;
    expect((await post(ignoreOne, {})).status).toBe(400);
    signedIn = false;
    expect((await post(ignoreOne, { unmatchedEventId: "u2" })).status).toBe(401);
    signedIn = true;
    forbidden = true;
    expect((await post(ignoreOne, { unmatchedEventId: "u2" })).status).toBe(403);
    expect(statuses().every(([, status]) => status === "pending")).toBe(true);
  });
});

describe("POST /api/prickle-types/ignore-batch", () => {
  it("marks several queued events ignored", async () => {
    const res = await post(ignoreBatch, { unmatchedEventIds: ["u1", "u3"] });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, count: 2 });
    expect(statuses()).toEqual([["u1", "ignored"], ["u2", "pending"], ["u3", "ignored"]]);
  });

  it("answers 500 when the update fails, 400 without ids, 401 signed out and 403 for a non-admin", async () => {
    failing = true;
    expect((await post(ignoreBatch, { unmatchedEventIds: ["u1"] })).status).toBe(500);
    failing = false;
    expect((await post(ignoreBatch, { unmatchedEventIds: [] })).status).toBe(400);
    signedIn = false;
    expect((await post(ignoreBatch, { unmatchedEventIds: ["u1"] })).status).toBe(401);
    signedIn = true;
    forbidden = true;
    expect((await post(ignoreBatch, { unmatchedEventIds: ["u1"] })).status).toBe(403);
    expect(statuses().every(([, status]) => status === "pending")).toBe(true);
  });
});
