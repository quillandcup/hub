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

describe("GET /api/members?email= host eligibility", () => {
  function asAdmin(rows: unknown[] = []) {
    const mock = makeSupabaseMock(rows);
    vi.mocked(requireAdmin).mockResolvedValue({ supabase: mock.supabase, user: { id: "u1" }, forbidden: false } as any);
    return mock;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T16:00:00Z"));
    return () => vi.useRealTimers();
  });

  it("adds host_eligibility (from first join) to exact-email lookups, without leaking the join dates", async () => {
    const { chain } = asAdmin([
      { id: "m1", name: "New Hedgie", email: "new@example.com", first_joined_at: "2026-09-10", most_recent_joined_at: "2026-09-10" },
    ]);

    const res = await GET(makeRequest("?email=new@example.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        {
          id: "m1",
          name: "New Hedgie",
          email: "new@example.com",
          host_eligibility: { eligible: false, tenureStartDate: "2026-09-10", eligibleOn: "2026-10-10" },
        },
      ],
    });
    expect(chain.select).toHaveBeenCalledWith("id, name, email, first_joined_at, most_recent_joined_at");
    expect(chain.ilike).toHaveBeenCalledWith("email", "new@example.com");
  });

  it("treats a recent rejoiner who first joined years ago as eligible", async () => {
    asAdmin([
      { id: "m2", name: "Rejoiner", email: "back@example.com", first_joined_at: "2021-01-01", most_recent_joined_at: "2026-09-20" },
    ]);
    const body = await (await GET(makeRequest("?email=back@example.com"))).json();
    expect(body.members[0].host_eligibility).toEqual({
      eligible: true,
      tenureStartDate: "2021-01-01",
      eligibleOn: "2021-02-01",
    });
  });

  it("marks a member with no join dates as not eligible", async () => {
    asAdmin([{ id: "m3", name: "Dateless", email: "x@example.com", first_joined_at: null, most_recent_joined_at: null }]);
    const body = await (await GET(makeRequest("?email=x@example.com"))).json();
    expect(body.members[0].host_eligibility).toEqual({ eligible: false, tenureStartDate: null, eligibleOn: null });
  });

  it("leaves search lookups unchanged (no join dates selected, no eligibility)", async () => {
    const rows = [{ id: "m1", name: "Alice", email: "alice@example.com" }];
    const { chain } = asAdmin(rows);
    const body = await (await GET(makeRequest("?search=ali"))).json();
    expect(body).toEqual({ members: rows });
    expect(chain.select).toHaveBeenCalledWith("id, name, email");
  });
});
