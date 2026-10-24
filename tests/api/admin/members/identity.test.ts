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

// The route reads the member before its edit and again after it; members come from the
// repository, so each read answers with the next record a test queued (the last one repeats).
const memberWrites: Record<string, unknown>[] = [];
let memberReads: ({ id: string; name: string; email: string; displayName: string | null; kajabiId: string | null } | null)[] = [];
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => ({
      ...actual.createRepos(db),
      members: {
        byId: async () => (memberReads.length > 1 ? memberReads.shift()! : memberReads[0]),
        byEmail: async () => null,
        // Writes are recorded, not applied.
        setName: async (id: string, name: string, options?: object) => (memberWrites.push({ id, name, ...options }), true),
        setDisplayName: async (id: string, displayName: string | null) => (memberWrites.push({ id, displayName }), true),
        setEmail: async (id: string, email: string) => (memberWrites.push({ id, email }), { ok: true }),
      },
    }),
  };
});

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
  memberWrites.length = 0;
  memberReads = [
    member && { id: member.id, name: member.name, email: member.email ?? "member@example.test", displayName: null, kajabiId: member.kajabi_id ?? null },
    updatedMember && { id: member?.id ?? "member-1", name: updatedMember.name, email: updatedMember.email ?? "member@example.test", displayName: updatedMember.display_name ?? null, kajabiId: member?.kajabi_id ?? null },
  ];

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


  const from = vi.fn((table: string) => {
    if (table === "members") {
      return { update, upsert, insert };
    }
    if (table === "member_name_aliases") {
      return { select: aliasSelect, upsert, insert };
    }
    if (table === "member_email_aliases") {
      // Only the final email-alias list fetch; the email paths are covered
      // against the real DB in identity-email.test.ts.
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) })) })) };
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
    expect(memberWrites).toEqual([expect.objectContaining({ name: "Erica Haraldsen" })]);
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
    expect(memberWrites).toEqual([]);
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
    expect(memberWrites).toEqual([expect.objectContaining({ name: "Erica Haraldsen", displayName: "Edy Hackett" })]);
  });

  it("rejects a displayName that isn't one of the member's aliases", async () => {
    const mock = makeSupabaseMock({ aliasRow: null });
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ displayName: "Not A Real Alias" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(400);
    expect(memberWrites).toEqual([]);
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
    expect(memberWrites).toHaveLength(1);
  });
});
