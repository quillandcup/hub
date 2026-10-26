import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (fn: () => void) => fn(),
}));

const updateContactMock = vi.fn();
vi.mock("@/lib/kajabi/client", () => ({
  createKajabiClient: () => ({ updateContact: updateContactMock }),
}));

vi.mock("@/lib/processing/trigger", () => ({
  triggerReprocessing: vi.fn(),
}));

// Pen names live in the alias repository; the twin stands in for it over a dataset each test seeds.
const aliasStore = vi.hoisted(() => ({ repo: null as unknown }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...real, createRepos: (db: never) => ({ ...real.createRepos(db), aliases: aliasStore.repo as never }) };
});

let aliasData: InMemoryDataset;
const seedAlias = (alias: string, active = true, id = "a1") => aliasData.nameAliases.push({ id, member_id: "member-1", alias, source: "member", active });

// Whether a name is taken is asked as the service role (members can't read each other's names).
const nameConflictMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc: nameConflictMock }),
}));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryAliasRepository } from "@/lib/data/aliases";
import { setCustomDisplayName, setDisplayName, updateRealName } from "@/app/(member)/settings/identityActions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { SUPPORT_EMAIL } from "@/lib/config"

const IDENTITY = {
  memberId: "member-1",
  memberName: "Edy Hackett",
  memberEmail: "edy@example.com",
  isSudo: false,
};

function makeSupabaseMock({
  currentMember,
  updateError = undefined as string | undefined,
}: {
  currentMember: { name: string; kajabi_id: string | null; self_service_name_changed_at: string | null };
  updateError?: string;
}) {
  const single = vi.fn().mockResolvedValue({ data: currentMember, error: null });
  // The members repository reads with maybeSingle; .single() stays for the pen-name lookups.
  const selectEq = vi.fn(() => ({ single, maybeSingle: single }));
  const select = vi.fn(() => ({ eq: selectEq }));

  // The members repository awaits update().eq().select("id") and counts the rows that came back.
  const updateSelect = vi
    .fn()
    .mockResolvedValue(updateError ? { data: null, error: { message: updateError } } : { data: [{ id: "member-1" }], error: null });
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const from = vi.fn(() => ({ select, update }));

  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from,
    __update: update,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  aliasData = new InMemoryDataset();
  aliasStore.repo = new InMemoryAliasRepository(aliasData);
  nameConflictMock.mockResolvedValue({ data: [], error: null });
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

describe("updateRealName", () => {
  it("blocks a second self-service change and points to support", async () => {
    const mock = makeSupabaseMock({
      currentMember: { name: "Edy Hackett", kajabi_id: "kj-1", self_service_name_changed_at: "2026-01-01T00:00:00Z" },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateRealName("Erica Haraldsen");
    expect(result).toEqual({ error: expect.stringContaining(SUPPORT_EMAIL) });
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("is a no-op that doesn't consume the allowance when the name is unchanged", async () => {
    const mock = makeSupabaseMock({
      currentMember: { name: "Edy Hackett", kajabi_id: "kj-1", self_service_name_changed_at: null },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateRealName("Edy Hackett");
    expect(result).toEqual({ success: true });
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("pushes to Kajabi and sets the lock when kajabi_id is present", async () => {
    updateContactMock.mockResolvedValue({});
    const mock = makeSupabaseMock({
      currentMember: { name: "Edy Hackett", kajabi_id: "kj-1", self_service_name_changed_at: null },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateRealName("Erica Haraldsen");
    expect(result).toEqual({ success: true });
    expect(updateContactMock).toHaveBeenCalledWith("kj-1", { name: "Erica Haraldsen" });
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Erica Haraldsen", self_service_name_changed_at: expect.any(String) })
    );
  });

  it("skips the Kajabi push when kajabi_id is null", async () => {
    const mock = makeSupabaseMock({
      currentMember: { name: "Edy Hackett", kajabi_id: null, self_service_name_changed_at: null },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateRealName("Erica Haraldsen");
    expect(result).toEqual({ success: true });
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(mock.__update).toHaveBeenCalled();
  });

  it("leaves the DB untouched when the Kajabi push fails", async () => {
    updateContactMock.mockRejectedValue(new Error("Kajabi is down"));
    const mock = makeSupabaseMock({
      currentMember: { name: "Edy Hackett", kajabi_id: "kj-1", self_service_name_changed_at: null },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateRealName("Erica Haraldsen");
    expect(result).toEqual({ error: "Kajabi is down" });
    expect(mock.__update).not.toHaveBeenCalled();
  });
});

describe("setDisplayName", () => {
  function makeMock({
    alias = true,
    updateResult = { data: [{ id: "member-1" }], error: null } as { data: unknown; error: { message: string } | null },
  } = {}) {
    const update = vi.fn(() => ({
      eq: () => ({ select: () => Promise.resolve(updateResult) }),
    }));
    if (alias) seedAlias("Pen Name");
    const from = vi.fn(() => ({ update }));
    return {
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
      from,
      __update: update,
    };
  }

  it("saves one of the member's active aliases", async () => {
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setDisplayName("Pen Name")).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith({ display_name: "Pen Name" });
  });

  it("rejects a name that isn't an active alias of the member", async () => {
    const mock = makeMock({ alias: false });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setDisplayName("Someone Else")).toEqual({ error: expect.any(String) });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("clears the display name with null, without an alias lookup", async () => {
    const mock = makeMock({ alias: false });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setDisplayName(null)).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith({ display_name: null });
  });

  it("returns the database error when the update fails", async () => {
    const mock = makeMock({ updateResult: { data: null, error: { message: "boom" } } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setDisplayName("Pen Name")).toEqual({ error: "boom" });
  });

  it("requires a member record", async () => {
    vi.mocked(createClient).mockResolvedValue(makeMock() as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    expect(await setDisplayName(null)).toEqual({ error: "No member record" });
  });
});

describe("setCustomDisplayName", () => {
  function makeMock({
    existing = null as { active: boolean } | null,
  } = {}) {
    if (existing) seedAlias("River Wilde", existing.active);
    const memberUpdate = vi.fn(() => ({
      eq: () => ({ select: () => Promise.resolve({ data: [{ id: "member-1" }], error: null }) }),
    }));
    // The member's own name is read through the members repository, which uses maybeSingle.
    const memberSelect = () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: IDENTITY.memberName }, error: null }) }) });
    const from = vi.fn(() => ({ select: memberSelect, update: memberUpdate }));
    return { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) }, from, __memberUpdate: memberUpdate };
  }

  it("adds the name as a pen name, then chooses it", async () => {
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("  River Wilde ")).toEqual({ success: true });
    expect(aliasData.nameAliases.map((a) => [a.member_id, a.alias, a.source, a.active])).toEqual([["member-1", "River Wilde", "member", true]]);
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: "River Wilde" });
  });

  it("reactivates an existing inactive pen name instead of adding a duplicate", async () => {
    const mock = makeMock({ existing: { active: false } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("River Wilde")).toEqual({ success: true });
    expect(aliasData.nameAliases.map((a) => [a.alias, a.active])).toEqual([["River Wilde", true]]);
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: "River Wilde" });
  });

  it("just chooses an existing active pen name", async () => {
    const mock = makeMock({ existing: { active: true } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("River Wilde")).toEqual({ success: true });
    expect(aliasData.nameAliases).toHaveLength(1);
  });

  it("clears the display name when the Real Name is typed, without adding an alias", async () => {
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName(IDENTITY.memberName)).toEqual({ success: true });
    expect(aliasData.nameAliases).toEqual([]);
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: null });
  });

  it("doesn't choose the name when another member already owns that alias", async () => {
    nameConflictMock.mockResolvedValue({ data: [{ kind: "other_alias", other_member_id: "member-2", other_member_name: "Other Member" }], error: null });
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("Taken Name")).toEqual({ error: expect.stringContaining("already uses that name") });
    expect(aliasData.nameAliases).toEqual([]);
    expect(mock.__memberUpdate).not.toHaveBeenCalled();
  });

  it("rejects a blank name", async () => {
    vi.mocked(createClient).mockResolvedValue(makeMock() as any);

    expect(await setCustomDisplayName("   ")).toEqual({ error: expect.any(String) });
  });
});
