import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// The admin prickle-schedules routes answer a database error with a 500 and its message (the happy
// paths run against the real database in tests/api/prickle-schedules/); a schedule that is gone is a 404.

let repos = createInMemoryRepos(new InMemoryDataset());
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin-1" }, supabase: {} }),
}));
vi.mock("@/lib/host-eligibility", () => ({ fetchHostEligibilityByMember: async () => new Map() }));
vi.mock("@/lib/prickle-schedules", async () => ({
  ...(await vi.importActual<typeof import("@/lib/prickle-schedules")>("@/lib/prickle-schedules")),
  seedNextMonthSchedules: async () => 0,
}));

import { GET, POST } from "@/app/api/prickle-schedules/route";
import { DELETE, PATCH } from "@/app/api/prickle-schedules/[id]/route";

const failing = (method: string, message: string) => {
  repos = {
    ...repos,
    prickleSchedules: Object.assign(Object.create(repos.prickleSchedules), {
      [method]: async () => {
        throw new Error(message);
      },
    }),
  };
};

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({ id: "psch_AAAAAAAAAAA1" }) };

const TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const NEW_SCHEDULE = { host_id: "mbr_AAAAAAAAAAA1", type_id: TYPE.id, month: "2097-03-01", recurrence_type: "weekly", day_of_week: 2, start_time_local: "19:00" };

beforeEach(() => {
  repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "Ada Example" }], prickleTypes: [TYPE] }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("admin prickle-schedules routes", () => {
  it("lists a month's schedules with host and type, and answers 500 when they can't be read", async () => {
    await repos.prickleSchedules.insert([{ ...NEW_SCHEDULE, status: "confirmed" }]);

    const ok = await GET(json("http://x/api/prickle-schedules?month=2097-03-01", "GET"));
    const { schedules } = await ok.json();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ status: "confirmed", member: { name: "Ada Example" }, prickle_type: { name: "Sprint" }, host_eligibility: null });

    failing("detailsOfMonth", "read failed");
    const failed = await GET(json("http://x/api/prickle-schedules?month=2097-03-01", "GET"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "read failed" });
  });

  it("creates a schedule, and answers 500 with the message when the insert fails", async () => {
    const created = await POST(json("http://x/api/prickle-schedules", "POST", { ...NEW_SCHEDULE, status: "confirmed" }));
    expect(created.status).toBe(201);
    expect((await created.json()).schedule).toMatchObject({ host_id: NEW_SCHEDULE.host_id, status: "confirmed", confirmed_by: "admin-1" });

    failing("insertDetailed", "insert failed");
    const failed = await POST(json("http://x/api/prickle-schedules", "POST", NEW_SCHEDULE));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "insert failed" });
  });

  it("updates a schedule, 404s one that is gone, and answers 500 when the update fails", async () => {
    const { id } = await repos.prickleSchedules.insertDetailed(NEW_SCHEDULE);
    const target = { params: Promise.resolve({ id }) };

    const ok = await PATCH(json("http://x/api/prickle-schedules/x", "PATCH", { status: "confirmed", notes: "Hi" }), target);
    expect((await ok.json()).schedule).toMatchObject({ id, status: "confirmed", notes: "Hi", confirmed_by: "admin-1" });

    const missing = await PATCH(json("http://x/api/prickle-schedules/x", "PATCH", { notes: "Hi" }), ctx);
    expect(missing.status).toBe(404);

    failing("updateLive", "update failed");
    const failed = await PATCH(json("http://x/api/prickle-schedules/x", "PATCH", { notes: "Hi" }), target);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "update failed" });
  });

  it("soft deletes a schedule, and answers 500 when that fails", async () => {
    const { id } = await repos.prickleSchedules.insertDetailed(NEW_SCHEDULE);

    const ok = await DELETE(json("http://x/api/prickle-schedules/x", "DELETE"), { params: Promise.resolve({ id }) });
    expect(await ok.json()).toEqual({ success: true });
    expect(await repos.prickleSchedules.liveById(id)).toBeNull();

    failing("update", "delete failed");
    const failed = await DELETE(json("http://x/api/prickle-schedules/x", "DELETE"), ctx);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "delete failed" });
  });
});
