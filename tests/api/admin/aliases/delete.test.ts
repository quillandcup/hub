import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { DELETE } from "@/app/api/admin/aliases/[id]/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

// The alias comes from the in-memory alias repository; the member's display name is still the fake client's.
let aliasData = new InMemoryDataset();
let deleteError: string | undefined;
let lookupError: string | undefined;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => {
      const aliases = actual.createInMemoryRepos(aliasData).aliases;
      if (lookupError) aliases.nameById = async () => Promise.reject(new Error(lookupError));
      if (deleteError) aliases.removeNames = async () => Promise.reject(new Error(deleteError));
      return { ...actual.createRepos(db), aliases };
    },
  };
});

function makeRequest() {
  return {} as unknown as NextRequest;
}

function makeSupabaseMock({
  alias = { id: "alias-1", member_id: "member-1", alias: "River Wilde", source: "zoom", active: true } as { id: string; member_id: string; alias: string; source: string; active: boolean } | null,
  failDelete = undefined as string | undefined,
  failLookup = undefined as string | undefined,
} = {}) {
  aliasData = new InMemoryDataset({ nameAliases: alias ? [alias] : [] });
  deleteError = failDelete;
  lookupError = failLookup;

  const updateEq2 = vi.fn().mockResolvedValue({ error: null });
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq1 }));

  const from = vi.fn((table: string) => {
    if (table === "members") return { update };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, __update: update, __updateEq1: updateEq1, __updateEq2: updateEq2 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    user: { id: "admin-1" } as any,
    forbidden: false,
    supabase: {} as any,
  });
});

describe("DELETE /api/admin/aliases/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as any });
    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(401);
  });

  it("returns 403 when not an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "u1" } as any, forbidden: true, supabase: {} as any });
    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(403);
  });

  it("returns 404 when the alias doesn't exist", async () => {
    const mock = makeSupabaseMock({ alias: null });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(404);
  });

  it("returns 404 with the database's message when the alias can't be read", async () => {
    const mock = makeSupabaseMock({ failLookup: "db down" });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "db down" });
  });

  it("deletes the alias and clears display_name if it matched", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });

    expect(response.status).toBe(200);
    expect(aliasData.nameAliases).toEqual([]);
    expect(mock.__update).toHaveBeenCalledWith({ display_name: null });
    expect(mock.__updateEq1).toHaveBeenCalledWith("id", "member-1");
    expect(mock.__updateEq2).toHaveBeenCalledWith("display_name", "River Wilde");
  });

  it("returns 500 when the delete fails", async () => {
    const mock = makeSupabaseMock({ failDelete: "db error" });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "db error" });
  });
});
