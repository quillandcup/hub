import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/members/merge/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

const PRIMARY = { id: "primary-1", name: "Wren Holloway", email: "wren@example.com", kajabi_id: "k1", stripe_customer_id: null, user_id: null };
const SECONDARY = { id: "secondary-1", name: "Wren H", email: "wren.old@example.com", kajabi_id: null, stripe_customer_id: null, user_id: null };

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

/** Chainable, awaitable query-builder stand-in that records every write and its filters. */
function makeSupabaseMock() {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const builder: any = {
      select: () => builder,
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), calls.push(call), builder),
      delete: () => ((call.op = "delete"), calls.push(call), builder),
      upsert: (payload: unknown) => ((call.op = "upsert"), (call.payload = payload), calls.push(call), builder),
      eq: (col: string, val: unknown) => (call.filters.push(["eq", col, val]), builder),
      in: (col: string, val: unknown) => (call.filters.push(["in", col, val]), builder),
      contains: (col: string, val: unknown) => (call.filters.push(["contains", col, val]), builder),
      single: () => {
        const id = call.filters.find(([, col]) => col === "id")?.[2];
        return Promise.resolve({ data: id === PRIMARY.id ? PRIMARY : id === SECONDARY.id ? SECONDARY : null, error: null });
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    return builder;
  });
  return { from, calls };
}

function makeRequest() {
  return { json: async () => ({ primaryId: PRIMARY.id, secondaryId: SECONDARY.id }) } as unknown as NextRequest;
}

describe("POST /api/admin/members/merge -- hosting records", () => {
  let mock: ReturnType<typeof makeSupabaseMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });
  });

  it("re-points hosted prickles via the real `host` column before deleting the secondary", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const prickleUpdates = mock.calls.filter((c) => c.table === "prickles" && c.op === "update");
    expect(prickleUpdates).toEqual([
      { table: "prickles", op: "update", payload: { host: PRIMARY.id }, filters: [["eq", "host", SECONDARY.id]] },
    ]);
  });

  it("transfers the secondary's prickle_schedules instead of letting ON DELETE CASCADE drop them", async () => {
    await POST(makeRequest());

    const scheduleUpdates = mock.calls.filter((c) => c.table === "prickle_schedules" && c.op === "update");
    expect(scheduleUpdates).toEqual([
      { table: "prickle_schedules", op: "update", payload: { host_id: PRIMARY.id }, filters: [["eq", "host_id", SECONDARY.id]] },
    ]);

    const memberDeleteIndex = mock.calls.findIndex((c) => c.table === "members" && c.op === "delete");
    const scheduleUpdateIndex = mock.calls.findIndex((c) => c.table === "prickle_schedules" && c.op === "update");
    expect(memberDeleteIndex).toBeGreaterThan(scheduleUpdateIndex);
  });
});
