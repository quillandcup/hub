import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/members/merge/route";

vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: vi.fn() }));
// The two members come from the members repository, in memory; the writes go to the fake client below.
let members: { id: string; name: string; email: string; kajabiId: string | null; stripeCustomerId: string | null; userId: string | null }[] = [];
vi.mock("@/lib/data/repos", () => import("@/tests/helpers/in-memory-members").then((m) => m.reposWithInMemoryMembers(() => members)));

import { requireAdmin } from "@/lib/supabase/api-auth";

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

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
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    return builder;
  });
  return { from, calls };
}

const request = () => ({ json: async () => ({ primaryId: "primary-1", secondaryId: "secondary-1" }) }) as unknown as NextRequest;

describe("POST /api/admin/members/merge -- external ids", () => {
  let mock: ReturnType<typeof makeSupabaseMock>;
  beforeEach(() => {
    vi.clearAllMocks();
    mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as never, forbidden: false, supabase: mock as never });
  });

  it("gives the primary the Kajabi, Stripe and account ids it was missing from the secondary", async () => {
    members = [
      { id: "primary-1", name: "Wren Holloway", email: "wren@example.com", kajabiId: null, stripeCustomerId: null, userId: null },
      { id: "secondary-1", name: "Wren H", email: "wren.old@example.com", kajabiId: "kj-2", stripeCustomerId: "cus_2", userId: "user-2" },
    ];

    const res = await POST(request());

    expect(res.status).toBe(200);
    const patch = mock.calls.find((c) => c.table === "members" && c.op === "update");
    expect(patch).toMatchObject({ payload: { kajabi_id: "kj-2", stripe_customer_id: "cus_2", user_id: "user-2" }, filters: [["eq", "id", "primary-1"]] });
  });

  it("keeps the primary's own ids, and reports the conflict instead of overwriting", async () => {
    members = [
      { id: "primary-1", name: "Wren Holloway", email: "wren@example.com", kajabiId: "kj-1", stripeCustomerId: null, userId: null },
      { id: "secondary-1", name: "Wren H", email: "wren.old@example.com", kajabiId: "kj-2", stripeCustomerId: null, userId: null },
    ];

    const res = await POST(request());
    const body = await res.json();

    expect(mock.calls.some((c) => c.table === "members" && c.op === "update")).toBe(false); // nothing to fill in
    expect(JSON.stringify(body)).toContain("kj-2"); // the discarded value is reported
  });
});
