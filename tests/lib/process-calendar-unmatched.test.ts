import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// /api/process/calendar and the review queue: decisions an admin made are applied, items without a type are
// queued, and a failing queue never stops the run. The repositories are in memory; the atomic rebuild is a fake RPC.

let dataset = new InMemoryDataset();
let failing: Set<"decisions" | "deletePending" | "queue">;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    const boom = async () => { throw new Error("boom"); };
    if (failing.has("decisions")) repos.unmatchedEvents.decisions = boom;
    if (failing.has("deletePending")) repos.unmatchedEvents.deletePendingForCalendarEvents = boom;
    if (failing.has("queue")) repos.unmatchedEvents.queue = boom;
    return repos;
  },
}));

const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null }));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, forbidden: false, supabase: { rpc } }),
}));
vi.mock("@/lib/calendar-events", async () => ({
  ...(await vi.importActual<typeof import("@/lib/calendar-events")>("@/lib/calendar-events")),
  syncCalendarEvents: async () => 0,
  ensureCalendarEvents: async () => 0,
  reconcileAutomaticEvents: async () => 0,
}));

import { POST } from "@/app/api/process/calendar/route";

const SPRINT = { id: "prty_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing" as const, requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const item = (id: string, summary: string) => ({
  id, google_event_id: `g-${id}`, summary, description: null, location: null, raw_data: {},
  start_time: "2097-03-03T15:00:00Z", end_time: "2097-03-03T16:00:00Z",
  creator_email: null, creator_name: null, organizer_email: null, organizer_name: null, imported_at: null,
});
const row = (id: string, calendar_event_id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, calendar_event_id, raw_summary: `Summary ${id}`, status, created_at: null, resolved_at: null, suggested_host: null, suggested_type: null,
  resolved_type_id: null, resolved_host_id: null, resolved_title: null, resolved_description: null, resolved_guest_speaker: null, ...extra,
});
const run = () => POST(new NextRequest("http://localhost/api/process/calendar", { method: "POST", body: JSON.stringify({ fromDate: "2097-03-01", toDate: "2097-03-31" }) }));
const rebuilt = () => (rpc.mock.calls[0][1].new_data as { calendar_event_id: string; type_id: string }[]).map((p) => [p.calendar_event_id, p.type_id]);

beforeEach(() => {
  rpc.mockClear();
  failing = new Set();
  dataset = new InMemoryDataset({
    prickleTypes: [SPRINT],
    calendarEvents: [item("c1", "Mystery Session"), item("c2", "Something Else"), item("c3", "Another Unknown"), item("c4", "Sprint")],
    unmatchedEvents: [
      row("u1", "c1", "pending"),
      row("u2", "c2", "ignored"),
      row("u3", "c3", "resolved", { resolved_type_id: SPRINT.id }),
    ],
  });
});

describe("POST /api/process/calendar and unmatched events", () => {
  it("applies earlier decisions and queues what has no type, replacing the stale waiting row", async () => {
    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pricklesCreated: 2, autoResolved: 1, ignored: 1, skippedNoMatch: 1 });
    expect(rebuilt()).toEqual([["c3", SPRINT.id], ["c4", SPRINT.id]]);
    // The ignored and resolved decisions are kept; the waiting item is deleted and queued again.
    expect(dataset.unmatchedEvents.map((u) => [u.calendar_event_id, u.status]).sort()).toEqual([["c1", "pending"], ["c2", "ignored"], ["c3", "resolved"]]);
    expect(dataset.unmatchedEvents.find((u) => u.calendar_event_id === "c1")).toMatchObject({ raw_summary: "Mystery Session", status: "pending" });
  });

  it("carries on when the decisions, the cleanup or the queue fail", async () => {
    failing = new Set(["decisions", "deletePending", "queue"]);

    const res = await run();

    expect(res.status).toBe(200);
    // Without the decisions, nothing resolved is applied: only the event whose title names a type becomes a prickle.
    expect(rebuilt()).toEqual([["c4", SPRINT.id]]);
    expect(dataset.unmatchedEvents.find((u) => u.calendar_event_id === "c1")).toMatchObject({ raw_summary: "Summary u1" });
  });
});
