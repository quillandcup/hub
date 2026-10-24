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

  const updateSingle = vi
    .fn()
    .mockResolvedValue(updateError ? { data: null, error: { message: updateError } } : { data: { id: "member-1" }, error: null });
  const updateEq = vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingle })) }));
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
    alias = { id: "a1" } as { id: string } | null,
    updateResult = { data: { id: "member-1" }, error: null } as { data: unknown; error: { message: string } | null },
  } = {}) {
    const update = vi.fn(() => ({
      eq: () => ({ select: () => ({ single: () => Promise.resolve(updateResult) }) }),
    }));
    const aliasChain: any = {
      select: () => aliasChain,
      eq: () => aliasChain,
      maybeSingle: () => Promise.resolve({ data: alias }),
    };
    const from = vi.fn((table: string) => (table === "member_name_aliases" ? aliasChain : { update }));
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
    const mock = makeMock({ alias: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setDisplayName("Someone Else")).toEqual({ error: expect.any(String) });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("clears the display name with null, without an alias lookup", async () => {
    const mock = makeMock({ alias: null });
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
    existing = null as { id: string; active: boolean } | null,
    insertError = null as { code?: string; message: string } | null,
  } = {}) {
    // The alias is looked up twice: once to see whether it exists, then by setDisplayName.
    const lookups = [{ data: existing }, { data: { id: "a1" } }];
    const aliasChain: any = {
      select: () => aliasChain,
      eq: () => aliasChain,
      maybeSingle: () => Promise.resolve(lookups.shift()),
    };
    const insert = vi.fn(() => Promise.resolve({ error: insertError }));
    const aliasUpdate = vi.fn(() => ({
      eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "a1" }, error: null }) }) }) }),
    }));
    const memberUpdate = vi.fn(() => ({
      eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "member-1" }, error: null }) }) }),
    }));
    // The member's own name is read through the members repository, which uses maybeSingle.
    const memberSelect = () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: IDENTITY.memberName }, error: null }) }) });
    const from = vi.fn((table: string) =>
      table === "member_name_aliases"
        ? Object.assign(aliasChain, { insert, update: aliasUpdate })
        : { select: memberSelect, update: memberUpdate }
    );
    return { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) }, from, __insert: insert, __aliasUpdate: aliasUpdate, __memberUpdate: memberUpdate };
  }

  it("adds the name as a pen name, then chooses it", async () => {
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("  River Wilde ")).toEqual({ success: true });
    expect(mock.__insert).toHaveBeenCalledWith({ member_id: "member-1", alias: "River Wilde", source: "member" });
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: "River Wilde" });
  });

  it("reactivates an existing inactive pen name instead of adding a duplicate", async () => {
    const mock = makeMock({ existing: { id: "a1", active: false } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("River Wilde")).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
    expect(mock.__aliasUpdate).toHaveBeenCalledWith({ active: true });
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: "River Wilde" });
  });

  it("just chooses an existing active pen name", async () => {
    const mock = makeMock({ existing: { id: "a1", active: true } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("River Wilde")).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
    expect(mock.__aliasUpdate).not.toHaveBeenCalled();
  });

  it("clears the display name when the Real Name is typed, without adding an alias", async () => {
    const mock = makeMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName(IDENTITY.memberName)).toEqual({ success: true });
    expect(mock.__insert).not.toHaveBeenCalled();
    expect(mock.__memberUpdate).toHaveBeenCalledWith({ display_name: null });
  });

  it("doesn't choose the name when another member already owns that alias", async () => {
    const mock = makeMock({ insertError: { code: "23505", message: "duplicate" } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    expect(await setCustomDisplayName("Taken Name")).toEqual({ error: expect.stringContaining("already registered") });
    expect(mock.__memberUpdate).not.toHaveBeenCalled();
  });

  it("rejects a blank name", async () => {
    vi.mocked(createClient).mockResolvedValue(makeMock() as any);

    expect(await setCustomDisplayName("   ")).toEqual({ error: expect.any(String) });
  });
});
