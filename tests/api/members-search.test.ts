import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/members/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/members${query}`);
}

function makeSupabaseMock(rows: unknown[] = []) {
  const chain: any = {
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    or: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  const from = vi.fn(() => chain);
  return { supabase: { from } as any, chain, from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/members admin guard", () => {
  it("returns 401 without a session and never queries members", async () => {
    const { supabase, from } = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ supabase, user: null, forbidden: true } as any);

    const res = await GET(makeRequest("?search=al&limit=20"));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin and never queries members", async () => {
    const { supabase, from } = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ supabase, user: { id: "u1" }, forbidden: true } as any);

    const res = await GET(makeRequest("?search=al&limit=20"));
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("GET /api/members search + limit", () => {
  function asAdmin(rows: unknown[] = []) {
    const mock = makeSupabaseMock(rows);
    vi.mocked(requireAdmin).mockResolvedValue({ supabase: mock.supabase, user: { id: "u1" }, forbidden: false } as any);
    return mock;
  }

  it("filters by name/email ilike and applies the limit", async () => {
    const rows = [{ id: "m1", name: "Alice", email: "alice@example.com" }];
    const { chain } = asAdmin(rows);

    const res = await GET(makeRequest("?search=ali&limit=20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members: rows });
    expect(chain.or).toHaveBeenCalledWith("name.ilike.%ali%,email.ilike.%ali%");
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it("clamps oversized limits", async () => {
    const { chain } = asAdmin();
    await GET(makeRequest("?search=a&limit=100000"));
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it("does not apply a limit when none is requested (existing callers)", async () => {
    const { chain } = asAdmin();
    await GET(makeRequest());
    expect(chain.limit).not.toHaveBeenCalled();
    expect(chain.or).not.toHaveBeenCalled();
  });

  it("strips PostgREST filter syntax from the search term", async () => {
    const { chain } = asAdmin();
    await GET(makeRequest(`?search=${encodeURIComponent("a,id.eq.x)")}&limit=20`));
    const filter = chain.or.mock.calls[0][0] as string;
    // Only the one comma separating the name/email clauses remains.
    expect(filter.split(",")).toHaveLength(2);
    expect(filter).not.toContain(")");
  });
});
