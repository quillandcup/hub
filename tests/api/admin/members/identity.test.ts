import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/members/[id]/route";

vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: vi.fn(),
}));

const updateContactMock = vi.fn();
vi.mock("@/lib/kajabi/client", () => ({
  createKajabiClient: () => ({ updateContact: updateContactMock }),
}));

import { requireAdmin } from "@/lib/supabase/api-auth";

function makeRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

function makeSupabaseMock({
  member = { id: "member-1", name: "Edy Hackett", kajabi_id: "kj-1" } as any,
  updateError = undefined as string | undefined,
  aliasInsertError = undefined as { code?: string; message: string } | undefined,
  aliasRow = null as { id: string } | null,
  aliases = [] as any[],
  updatedMember = { name: "Erica Haraldsen", display_name: null } as any,
} = {}) {
  const memberSingle = vi.fn().mockResolvedValue({ data: member, error: null });
  const memberEq = vi.fn(() => ({ single: memberSingle }));
  const memberSelect = vi.fn(() => ({ eq: memberEq }));

  const updateResult = updateError ? { error: { message: updateError } } : { error: null };
  const updateEq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn(() => ({ eq: updateEq }));

  const upsert = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: aliasInsertError ?? null });

  // A single flexible chain that supports both call shapes used against
  // member_name_aliases: .select(...).eq(...).eq(...).maybeSingle() (the
  // displayName ownership check) and .select(...).eq(...).order(...) (the
  // final alias list fetch).
  const aliasMaybeSingle = vi.fn().mockResolvedValue({ data: aliasRow });
  const aliasOrder = vi.fn().mockResolvedValue({ data: aliases, error: null });
  const aliasChain: any = {
    eq: vi.fn(() => aliasChain),
    order: aliasOrder,
    maybeSingle: aliasMaybeSingle,
  };
  const aliasSelect = vi.fn(() => aliasChain);

  const finalMemberSingle = vi.fn().mockResolvedValue({ data: updatedMember, error: null });
  const finalMemberEq = vi.fn(() => ({ single: finalMemberSingle }));

  let memberSelectCallCount = 0;

  const from = vi.fn((table: string) => {
    if (table === "members") {
      memberSelectCallCount++;
      if (memberSelectCallCount === 1) {
        return { select: memberSelect, update, upsert, insert };
      }
      return { select: vi.fn(() => ({ eq: finalMemberEq })), update, upsert, insert };
    }
    if (table === "member_name_aliases") {
      return { select: aliasSelect, upsert, insert };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, __update: update, __insert: insert, __upsert: upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    user: { id: "admin-1" } as any,
    forbidden: false,
    supabase: {} as any,
  });
});

describe("PATCH /api/admin/members/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as any });
    const response = await PATCH(makeRequest({ name: "x" }), { params: Promise.resolve({ id: "member-1" }) });
    expect(response.status).toBe(401);
  });

  it("returns 403 when not an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "u1" } as any, forbidden: true, supabase: {} as any });
    const response = await PATCH(makeRequest({ name: "x" }), { params: Promise.resolve({ id: "member-1" }) });
    expect(response.status).toBe(403);
  });

  it("pushes the new name to Kajabi and updates the member when kajabi_id is set", async () => {
    updateContactMock.mockResolvedValue({});
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ name: "Erica Haraldsen" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateContactMock).toHaveBeenCalledWith("kj-1", { name: "Erica Haraldsen" });
    expect(mock.__update).toHaveBeenCalledWith(expect.objectContaining({ name: "Erica Haraldsen" }));
  });

  it("returns 502 and leaves the DB untouched when the Kajabi push fails", async () => {
    updateContactMock.mockRejectedValue(new Error("Kajabi is down"));
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ name: "Erica Haraldsen" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(502);
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("keeps the old name as a pen name and sets it as the default display name", async () => {
    updateContactMock.mockResolvedValue({});
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    await PATCH(
      makeRequest({ name: "Erica Haraldsen", keepOldNameAsPenName: true }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(mock.__upsert).toHaveBeenCalledWith(
      { member_id: "member-1", alias: "Edy Hackett", source: "admin" },
      { onConflict: "alias" }
    );
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Erica Haraldsen", display_name: "Edy Hackett" })
    );
  });

  it("rejects a displayName that isn't one of the member's aliases", async () => {
    const mock = makeSupabaseMock({ aliasRow: null });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ displayName: "Not A Real Alias" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("returns 409 when a new pen name collides with another member's alias", async () => {
    const mock = makeSupabaseMock({ aliasInsertError: { code: "23505", message: "duplicate" } });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ newPenName: "Taken Name" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(409);
  });

  it("skips the Kajabi call when the member has no kajabi_id", async () => {
    const mock = makeSupabaseMock({ member: { id: "member-1", name: "Local Staffer", kajabi_id: null } });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ name: "New Name" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(mock.__update).toHaveBeenCalled();
  });
});
