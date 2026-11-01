import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
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
// The aliases the route reads and writes, in the in-memory alias repository.
let aliasData = new InMemoryDataset();
let memberReads: ({ id: string; name: string; email: string; displayName: string | null; kajabiId: string | null } | null)[] = [];
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return {
    ...actual,
    createRepos: (db: Parameters<typeof actual.createRepos>[0]) => ({
      ...actual.createRepos(db),
      aliases: actual.createInMemoryRepos(aliasData).aliases,
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
  takenAlias = undefined as string | undefined,
  aliases = [] as { id: string; alias: string; source: string; active: boolean }[],
  updatedMember = { name: "Erica Haraldsen", display_name: null } as any,
} = {}) {
  memberWrites.length = 0;
  aliasData = new InMemoryDataset({
    nameAliases: [
      ...aliases.map((a) => ({ ...a, member_id: "member-1" })),
      ...(takenAlias ? [{ id: "nal_other", member_id: "member-2", alias: takenAlias, source: "member", active: true }] : []),
    ],
  });
  memberReads = [
    member && { id: member.id, name: member.name, email: member.email ?? "member@example.test", displayName: null, kajabiId: member.kajabi_id ?? null },
    updatedMember && { id: member?.id ?? "member-1", name: updatedMember.name, email: updatedMember.email ?? "member@example.test", displayName: updatedMember.display_name ?? null, kajabiId: member?.kajabi_id ?? null },
  ];

  const updateResult = updateError ? { error: { message: updateError } } : { error: null };
  const updateEq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn(() => ({ eq: updateEq }));

  // Members and aliases come from the repositories; nothing else is read.
  const from = vi.fn((table: string) => {
    if (table === "members") return { update };
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return { from, __update: update };
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

    expect(aliasData.nameAliases.map((a) => [a.member_id, a.alias, a.source])).toEqual([["member-1", "Edy Hackett", "admin"]]);
    expect(memberWrites).toEqual([expect.objectContaining({ name: "Erica Haraldsen", displayName: "Edy Hackett" })]);
  });

  it("rejects a displayName that isn't one of the member's aliases", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin-1" } as any, forbidden: false, supabase: mock as any });

    const response = await PATCH(
      makeRequest({ displayName: "Not A Real Alias" }),
      { params: Promise.resolve({ id: "member-1" }) }
    );

    expect(response.status).toBe(400);
    expect(memberWrites).toEqual([]);
  });

  it("returns 409 when a new pen name collides with another member's alias", async () => {
    const mock = makeSupabaseMock({ takenAlias: "Taken Name" });
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
