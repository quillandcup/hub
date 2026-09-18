import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { DELETE } from "@/app/api/admin/aliases/[id]/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

function makeRequest() {
  return {} as unknown as NextRequest;
}

function makeSupabaseMock({
  alias = { id: "alias-1", member_id: "member-1", alias: "River Wilde" } as any,
  fetchError = undefined as { message: string } | undefined,
  deleteError = undefined as { message: string } | undefined,
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: fetchError ? null : alias, error: fetchError ?? null });
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const deleteEq = vi.fn().mockResolvedValue({ error: deleteError ?? null });
  const del = vi.fn(() => ({ eq: deleteEq }));

  const updateEq2 = vi.fn().mockResolvedValue({ error: null });
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq1 }));

  const from = vi.fn((table: string) => {
    if (table === "member_name_aliases") return { select, delete: del };
    if (table === "members") return { update };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, __delete: del, __update: update, __updateEq1: updateEq1, __updateEq2: updateEq2 };
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
    const mock = makeSupabaseMock({ fetchError: { message: "not found" } });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(404);
  });

  it("deletes the alias and clears display_name if it matched", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });

    expect(response.status).toBe(200);
    expect(mock.__delete).toHaveBeenCalled();
    expect(mock.__update).toHaveBeenCalledWith({ display_name: null });
    expect(mock.__updateEq1).toHaveBeenCalledWith("id", "member-1");
    expect(mock.__updateEq2).toHaveBeenCalledWith("display_name", "River Wilde");
  });

  it("returns 500 when the delete fails", async () => {
    const mock = makeSupabaseMock({ deleteError: { message: "db error" } });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await DELETE(makeRequest(), { params: Promise.resolve({ id: "alias-1" }) });
    expect(response.status).toBe(500);
  });
});
