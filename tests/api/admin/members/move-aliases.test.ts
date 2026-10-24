import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/members/move-aliases/route";

vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/processing/trigger", () => ({ triggerAttendanceReprocessing: vi.fn().mockResolvedValue({}) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

vi.mock("@/lib/data/repos", () => import("@/tests/helpers/in-memory-members").then((m) => m.reposWithInMemoryMembers(() => members)));

import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";

const FROM = { id: "from-1" };
const TO = { id: "to-1", email: "Ivy@Example.com" };

// The members the route finds, in the in-memory repository; a test can leave one out.
let members: { id: string; name: string; email: string }[] = [];

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

function makeSupabaseMock(opts: { noAttendance?: boolean; failOn?: { table: string; op: string }; missing?: string } = {}) {
  const calls: Call[] = [];
  members = [FROM, TO].filter((m) => m.id !== opts.missing).map((m) => ({ id: m.id, name: m.id, email: "email" in m ? String(m.email) : `${m.id}@example.test` }));
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const builder: any = {
      select: () => builder,
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), calls.push(call), builder),
      delete: () => ((call.op = "delete"), calls.push(call), builder),
      eq: (col: string, val: unknown) => (call.filters.push(["eq", col, val]), builder),
      in: (col: string, val: unknown) => (call.filters.push(["in", col, val]), builder),
      order: () => builder,
      limit: () => builder,
      single: () => {
        const id = call.filters.find(([, col]) => col === "id")?.[2];
        const row = id === FROM.id ? FROM : id === TO.id ? TO : null;
        return Promise.resolve({ data: id === opts.missing ? null : row, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: opts.noAttendance ? null : { join_time: "2025-01-02T10:00:00Z" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (opts.failOn && opts.failOn.table === table && opts.failOn.op === call.op) {
          return resolve({ data: null, error: { message: `${table} ${call.op} failed` } });
        }
        if (call.op !== "select") return resolve({ data: [], error: null });
        return resolve({
          data:
            table === "member_name_aliases"
              ? [{ id: "n1" }]
              : [{ id: "e1", alias_email: "ivy@example.com" }, { id: "e2", alias_email: "ivy.old@example.com" }],
          error: null,
        });
      },
    };
    return builder;
  });
  return { from, calls };
}

const request = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const useMock = (mock: ReturnType<typeof makeSupabaseMock>) =>
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

const BODY = { fromMemberId: FROM.id, toMemberId: TO.id, nameAliasIds: ["n1"], emailAliasIds: ["e1", "e2"] };

describe("POST /api/admin/members/move-aliases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves names and emails, drops the target's own email, and reprocesses from the source's first attendance", async () => {
    const mock = makeSupabaseMock();
    useMock(mock);
    const res = await POST(request(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ movedNameAliases: 1, movedEmailAliases: 1, droppedEmailAliases: 1 });

    expect(mock.calls.find((c) => c.table === "member_email_aliases" && c.op === "delete")?.filters).toEqual([["in", "id", ["e1"]]]);
    expect(mock.calls.find((c) => c.table === "member_email_aliases" && c.op === "update")).toMatchObject({
      payload: { member_id: TO.id },
      filters: [["in", "id", ["e2"]]],
    });
    expect(mock.calls.find((c) => c.table === "member_name_aliases" && c.op === "update")).toMatchObject({
      payload: { member_id: TO.id },
      filters: [["in", "id", ["n1"]]],
    });
    expect(vi.mocked(triggerAttendanceReprocessing).mock.calls[0][0].from.toISOString()).toBe("2025-01-02T10:00:00.000Z");
  });

  it("falls back to the last 90 days without attendance", async () => {
    useMock(makeSupabaseMock({ noAttendance: true }));
    await POST(request(BODY));
    const { from } = vi.mocked(triggerAttendanceReprocessing).mock.calls[0][0];
    expect(Date.now() - from.getTime()).toBeGreaterThan(89 * 86_400_000);
  });

  it("validates the body", async () => {
    useMock(makeSupabaseMock());
    expect((await POST(request({ ...BODY, toMemberId: undefined }))).status).toBe(400);
    expect((await POST(request({ ...BODY, toMemberId: FROM.id }))).status).toBe(400);
    expect((await POST(request({ ...BODY, nameAliasIds: [], emailAliasIds: [] }))).status).toBe(400);
  });

  it("404s when either member is missing", async () => {
    useMock(makeSupabaseMock({ missing: FROM.id }));
    expect((await POST(request(BODY))).status).toBe(404);
    useMock(makeSupabaseMock({ missing: TO.id }));
    expect((await POST(request(BODY))).status).toBe(404);
  });

  it("reports a failed move as a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useMock(makeSupabaseMock({ failOn: { table: "member_name_aliases", op: "update" } }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "member_name_aliases update failed" });
  });

  it("still succeeds when the background reprocess fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(triggerAttendanceReprocessing).mockRejectedValueOnce(new Error("boom"));
    useMock(makeSupabaseMock());
    expect((await POST(request(BODY))).status).toBe(200);
  });

  it("requires an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null } as any);
    expect((await POST(request(BODY))).status).toBe(401);
  });
});
