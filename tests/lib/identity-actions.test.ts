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

import { updateRealName } from "@/app/(member)/settings/identityActions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

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
  const selectEq = vi.fn(() => ({ single }));
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
    expect(result).toEqual({ error: expect.stringContaining("support@quillandcup.com") });
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
