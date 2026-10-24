import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/members/split/route";

vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/processing/trigger", () => ({ triggerAttendanceReprocessing: vi.fn().mockResolvedValue({}) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

vi.mock("@/lib/data/repos", () => import("@/tests/helpers/in-memory-members").then((m) => m.reposWithInMemoryMembers(() => members)));

import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";

const ORIGINAL = { id: "orig-1", name: "Wren Holloway", email: "wren@example.com" };
const NEW_ID = "new-1";

// The members the route finds, in the in-memory repository: the one being split, and whoever already has the new email.
let members: { id: string; name: string; email: string }[] = [];

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

interface Fixtures {
  emailHolder?: { id: string } | null;
  emailAlias?: { id: string; member_id: string } | null;
  nameRows?: { id: string }[];
  noAttendance?: boolean;
  failOn?: { table: string; op: string };
  emailRows?: { id: string; alias_email: string }[];
}

function makeSupabaseMock(fx: Fixtures = {}) {
  const calls: Call[] = [];
  members = [ORIGINAL, ...(fx.emailHolder ? [{ id: fx.emailHolder.id, name: (fx.emailHolder as { name?: string }).name ?? fx.emailHolder.id, email: "ivy@example.com" }] : [])];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const builder: any = {
      select: () => builder,
      insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), calls.push(call), builder),
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), calls.push(call), builder),
      delete: () => ((call.op = "delete"), calls.push(call), builder),
      eq: (col: string, val: unknown) => (call.filters.push(["eq", col, val]), builder),
      in: (col: string, val: unknown) => (call.filters.push(["in", col, val]), builder),
      order: () => builder,
      limit: () => builder,
      single: () =>
        Promise.resolve(
          call.op === "insert"
            ? { data: { id: NEW_ID }, error: null }
            : { data: call.filters.some(([, , v]) => v === ORIGINAL.id) ? ORIGINAL : null, error: null }
        ),
      maybeSingle: () => {
        if (table === "members") return Promise.resolve({ data: fx.emailHolder ?? null, error: null });
        if (table === "member_email_aliases") return Promise.resolve({ data: fx.emailAlias ?? null, error: null });
        return Promise.resolve({ data: fx.noAttendance ? null : { join_time: "2025-01-02T10:00:00Z" }, error: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (fx.failOn && fx.failOn.table === table && fx.failOn.op === call.op) {
          return resolve({ data: null, error: { message: `${table} ${call.op} failed` } });
        }
        const data =
          call.op !== "select" ? [] : table === "member_name_aliases" ? (fx.nameRows ?? []) : (fx.emailRows ?? []);
        return resolve({ data, error: null });
      },
    };
    return builder;
  });
  return { from, calls };
}

function request(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function useMock(mock: ReturnType<typeof makeSupabaseMock>) {
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });
}

const BODY = { memberId: ORIGINAL.id, name: "Ivy Marsh", email: "Ivy@Example.com", nameAliasIds: ["n1"], emailAliasIds: ["e1"] };

describe("POST /api/admin/members/split", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the member, moves the chosen aliases, and reprocesses attendance from the original's first record", async () => {
    const mock = makeSupabaseMock({
      emailAlias: { id: "e1", member_id: ORIGINAL.id },
      nameRows: [{ id: "n1" }],
      emailRows: [{ id: "e1", alias_email: "ivy@example.com" }, { id: "e2", alias_email: "ivy.old@example.com" }],
    });
    useMock(mock);

    const res = await POST(request({ ...BODY, emailAliasIds: ["e1", "e2"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ memberId: NEW_ID, movedNameAliases: 1, movedEmailAliases: 1 });

    const insert = mock.calls.find((c) => c.table === "members" && c.op === "insert");
    expect(insert?.payload).toMatchObject({ name: "Ivy Marsh", email: "ivy@example.com" });

    // The new primary email stops being an alias; the other email moves.
    expect(mock.calls.find((c) => c.table === "member_email_aliases" && c.op === "delete")?.filters).toEqual([["eq", "id", "e1"]]);
    expect(mock.calls.find((c) => c.table === "member_email_aliases" && c.op === "update")).toMatchObject({
      payload: { member_id: NEW_ID },
      filters: [["in", "id", ["e2"]]],
    });
    expect(mock.calls.find((c) => c.table === "member_name_aliases" && c.op === "update")).toMatchObject({
      payload: { member_id: NEW_ID },
      filters: [["in", "id", ["n1"]]],
    });

    expect(triggerAttendanceReprocessing).toHaveBeenCalledTimes(1);
    expect(vi.mocked(triggerAttendanceReprocessing).mock.calls[0][0].from.toISOString()).toBe("2025-01-02T10:00:00.000Z");
  });

  it("rejects an email another member already has", async () => {
    const mock = makeSupabaseMock({ emailHolder: { id: "other", name: "Ivy Marsh" } as any });
    useMock(mock);
    const res = await POST(request(BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflictingMemberId: "other", canMoveAliases: true, error: expect.stringContaining("Ivy Marsh") });
    expect(mock.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("rejects the original member's own primary email", async () => {
    useMock(makeSupabaseMock({ emailHolder: { id: ORIGINAL.id, name: ORIGINAL.name } as any }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("own primary email");
  });

  it("rejects an email that is an alias of a different member", async () => {
    const mock = makeSupabaseMock({ emailAlias: { id: "e9", member_id: "other" } });
    useMock(mock);
    const res = await POST(request(BODY));
    expect(res.status).toBe(409);
    expect(mock.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("falls back to the last 90 days when the original has no attendance", async () => {
    useMock(makeSupabaseMock({ noAttendance: true }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(200);
    const { from } = vi.mocked(triggerAttendanceReprocessing).mock.calls[0][0];
    expect(Date.now() - from.getTime()).toBeGreaterThan(89 * 86_400_000);
    expect(Date.now() - from.getTime()).toBeLessThan(91 * 86_400_000);
  });

  it("reports a failed alias move as a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useMock(makeSupabaseMock({ nameRows: [{ id: "n1" }], failOn: { table: "member_name_aliases", op: "update" } }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "member_name_aliases update failed" });
  });

  it("still succeeds when the background reprocess fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(triggerAttendanceReprocessing).mockRejectedValueOnce(new Error("boom"));
    useMock(makeSupabaseMock());
    const res = await POST(request(BODY));
    expect(res.status).toBe(200);
  });

  it("validates the body", async () => {
    useMock(makeSupabaseMock());
    expect((await POST(request({ ...BODY, name: " " }))).status).toBe(400);
    expect((await POST(request({ ...BODY, email: "nope" }))).status).toBe(400);
    expect((await POST(request({ ...BODY, memberId: undefined }))).status).toBe(400);
  });

  it("requires an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null } as any);
    expect((await POST(request(BODY))).status).toBe(401);
  });
});
