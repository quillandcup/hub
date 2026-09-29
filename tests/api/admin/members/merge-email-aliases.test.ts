import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/members/merge/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

const PRIMARY = { id: "primary-1", name: "Wren Holloway", email: "wren@example.com", kajabi_id: "k1", stripe_customer_id: null, user_id: null };
const SECONDARY = { id: "secondary-1", name: "Wren H", email: "Wren.Old@example.com", kajabi_id: null, stripe_customer_id: null, user_id: null };

type Call = { table: string; op: string; payload?: unknown; options?: unknown; filters: [string, string, unknown][] };

/**
 * Chainable, awaitable query-builder stand-in that records every write and its
 * filters. `failOn(table, op)` makes that write resolve with an error.
 */
function makeSupabaseMock(failOn?: { table: string; op: string }) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const builder: any = {
      select: () => builder,
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), calls.push(call), builder),
      delete: () => ((call.op = "delete"), calls.push(call), builder),
      upsert: (payload: unknown, options?: unknown) => (
        (call.op = "upsert"), (call.payload = payload), (call.options = options), calls.push(call), builder
      ),
      eq: (col: string, val: unknown) => (call.filters.push(["eq", col, val]), builder),
      in: (col: string, val: unknown) => (call.filters.push(["in", col, val]), builder),
      contains: (col: string, val: unknown) => (call.filters.push(["contains", col, val]), builder),
      single: () => {
        const id = call.filters.find(([, col]) => col === "id")?.[2];
        return Promise.resolve({ data: id === PRIMARY.id ? PRIMARY : id === SECONDARY.id ? SECONDARY : null, error: null });
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve(
          failOn && failOn.table === table && failOn.op === call.op
            ? { data: null, error: { message: `${table} ${call.op} failed` } }
            : { data: [], error: null }
        ),
    };
    return builder;
  });
  return { from, calls };
}

function makeRequest() {
  return { json: async () => ({ primaryId: PRIMARY.id, secondaryId: SECONDARY.id }) } as unknown as NextRequest;
}

function useMock(mock: ReturnType<typeof makeSupabaseMock>) {
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });
}

describe("POST /api/admin/members/merge -- email aliases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the secondary's aliases to the primary by member_id", async () => {
    const mock = makeSupabaseMock();
    useMock(mock);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const updates = mock.calls.filter((c) => c.table === "member_email_aliases" && c.op === "update");
    expect(updates).toEqual([
      {
        table: "member_email_aliases",
        op: "update",
        payload: { member_id: PRIMARY.id },
        filters: [["eq", "member_id", SECONDARY.id]],
      },
    ]);
  });

  it("records the secondary's email (lowercased) as an alias of the primary by member_id", async () => {
    const mock = makeSupabaseMock();
    useMock(mock);
    await POST(makeRequest());

    const upserts = mock.calls.filter((c) => c.table === "member_email_aliases" && c.op === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toEqual({ member_id: PRIMARY.id, alias_email: "wren.old@example.com", source: "manual" });
    expect(upserts[0].options).toEqual({ onConflict: "alias_email" });
  });

  it("never re-points aliases by email any more", async () => {
    const mock = makeSupabaseMock();
    useMock(mock);
    await POST(makeRequest());

    const byEmail = mock.calls.filter(
      (c) => c.table === "member_email_aliases" && c.filters.some(([, col]) => col === "canonical_email")
    );
    expect(byEmail).toEqual([]);
  });

  it("moves aliases, then adds the secondary's email, before deleting the secondary (ON DELETE CASCADE)", async () => {
    const mock = makeSupabaseMock();
    useMock(mock);
    await POST(makeRequest());

    const index = (table: string, op: string) => mock.calls.findIndex((c) => c.table === table && c.op === op);
    const move = index("member_email_aliases", "update");
    const upsert = index("member_email_aliases", "upsert");
    const del = index("members", "delete");
    expect(move).toBeGreaterThanOrEqual(0);
    expect(upsert).toBeGreaterThan(move);
    expect(del).toBeGreaterThan(upsert);
  });

  it.each([
    ["update", "moving aliases"],
    ["upsert", "adding the secondary's email"],
  ])("aborts without deleting the secondary when %s of member_email_aliases fails (%s)", async (op) => {
    const mock = makeSupabaseMock({ table: "member_email_aliases", op });
    useMock(mock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: `member_email_aliases ${op} failed` });
    expect(mock.calls.some((c) => c.table === "members" && c.op === "delete")).toBe(false);
  });

  it("aborts without deleting the secondary when an earlier transfer fails", async () => {
    const mock = makeSupabaseMock({ table: "prickle_schedules", op: "update" });
    useMock(mock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mock.calls.some((c) => c.table === "members" && c.op === "delete")).toBe(false);
  });
});
