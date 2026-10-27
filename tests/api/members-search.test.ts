import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset, type MemberSeed } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { GET } from "@/app/api/members/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));
// Members come from their repository, in memory here.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/members${query}`);
}

const asAdmin = () => vi.mocked(requireAdmin).mockResolvedValue({ supabase: {} as never, user: { id: "u1" }, forbidden: false } as never);

beforeEach(() => {
  vi.clearAllMocks();
  repos = createInMemoryRepos(new InMemoryDataset({ members: [] }));
});

describe("GET /api/members admin guard", () => {
  it("returns 401 without a session and never reads members", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ supabase: {} as never, user: null, forbidden: true } as never);
    const search = vi.spyOn(repos.members, "search");

    const res = await GET(makeRequest("?search=al&limit=20"));

    expect(res.status).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin and never reads members", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ supabase: {} as never, user: { id: "u1" }, forbidden: true } as never);
    const search = vi.spyOn(repos.members, "search");

    const res = await GET(makeRequest("?search=al&limit=20"));

    expect(res.status).toBe(403);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("GET /api/members search + limit", () => {
  const people = [
    { id: "m1", name: "Alice Example", email: "alice@example.test" },
    { id: "m2", name: "Bob Example", email: "bob@example.test" },
    { id: "m3", name: "Cleo Example", email: "cleo@alibi.test" },
  ];
  beforeEach(() => {
    asAdmin();
    repos = createInMemoryRepos(new InMemoryDataset({ members: people }));
  });

  it("finds members whose name or email contains the search, by name, with only id, name and email", async () => {
    const res = await GET(makeRequest("?search=ali&limit=20"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        { id: "m1", name: "Alice Example", displayName: null, email: "alice@example.test" },
        { id: "m3", name: "Cleo Example", displayName: null, email: "cleo@alibi.test" },
      ],
    });
  });

  it("finds a member by display name and returns it next to the legal name", async () => {
    repos = createInMemoryRepos(new InMemoryDataset({ members: [...people, { id: "m4", name: "Penelope Legal", displayName: "Penny Pen", email: "pp@example.test" }] }));

    const res = await GET(makeRequest("?search=penny&limit=20"));

    expect((await res.json()).members).toEqual([{ id: "m4", name: "Penelope Legal", displayName: "Penny Pen", email: "pp@example.test" }]);
  });

  it("applies the limit, clamping oversized ones to 50", async () => {
    const search = vi.spyOn(repos.members, "search");

    expect((await (await GET(makeRequest("?search=example&limit=2"))).json()).members).toHaveLength(2);
    await GET(makeRequest("?search=a&limit=100000"));

    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("does not apply a limit or a search when none is requested (existing callers)", async () => {
    const search = vi.spyOn(repos.members, "search");

    const { members } = await (await GET(makeRequest())).json();

    expect(members).toHaveLength(3);
    expect(search).toHaveBeenCalledWith({ emailEquals: undefined, words: undefined, limit: undefined });
  });

  it("strips PostgREST filter syntax from the search term", async () => {
    const search = vi.spyOn(repos.members, "search");

    await GET(makeRequest(`?search=${encodeURIComponent("a,id.eq.x)")}&limit=20`));

    const { words } = search.mock.calls[0][0];
    expect(words).toEqual(["a id.eq.x"]); // the separators became spaces
    expect(words!.join("")).not.toMatch(/[,()]/);
  });
});

describe("GET /api/members?email= host eligibility", () => {
  beforeEach(() => {
    asAdmin();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T16:00:00Z"));
    return () => vi.useRealTimers();
  });
  const seed = (members: MemberSeed[]) => {
    repos = createInMemoryRepos(new InMemoryDataset({ members }));
  };

  it("adds host_eligibility (from first join) to exact-email lookups, without leaking the join dates", async () => {
    seed([{ id: "m1", name: "New Hedgie", email: "new@example.com", firstJoinedAt: "2026-09-10", mostRecentJoinedAt: "2026-09-10" }]);

    const res = await GET(makeRequest("?email=NEW@example.com")); // any case

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
  });

  it("looks the email up exactly, not as a substring or with wildcards", async () => {
    seed([{ id: "m1", name: "Someone", email: "someone@example.com", firstJoinedAt: "2020-01-01", mostRecentJoinedAt: "2020-01-01" }]);

    expect((await (await GET(makeRequest("?email=some"))).json()).members).toEqual([]);
    expect((await (await GET(makeRequest("?email=%25@example.com"))).json()).members).toEqual([]);
  });

  it("treats a recent rejoiner who first joined years ago as eligible", async () => {
    seed([{ id: "m2", name: "Rejoiner", email: "back@example.com", firstJoinedAt: "2021-01-01", mostRecentJoinedAt: "2026-09-20" }]);

    const body = await (await GET(makeRequest("?email=back@example.com"))).json();

    expect(body.members[0].host_eligibility).toEqual({ eligible: true, tenureStartDate: "2021-01-01", eligibleOn: "2021-02-01" });
  });

  it("marks a member with no join dates as not eligible", async () => {
    seed([{ id: "m3", name: "Dateless", email: "x@example.com" }]);

    const body = await (await GET(makeRequest("?email=x@example.com"))).json();

    expect(body.members[0].host_eligibility).toEqual({ eligible: false, tenureStartDate: null, eligibleOn: null });
  });

  it("leaves search lookups unchanged (no eligibility)", async () => {
    seed([{ id: "m1", name: "Alice", email: "alice@example.com", firstJoinedAt: "2020-01-01" }]);

    const body = await (await GET(makeRequest("?search=ali"))).json();

    expect(body).toEqual({ members: [{ id: "m1", name: "Alice", displayName: null, email: "alice@example.com" }] });
  });
});
