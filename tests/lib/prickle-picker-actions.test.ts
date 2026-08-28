import { describe, it, expect, vi, beforeEach } from "vitest";

// saveHostVibe never takes a host_id parameter from the caller — it's always
// derived from getEffectiveIdentity, which is the actual authorization
// boundary here (RLS on prickle_host_vibes is permissive, per this project's
// convention). These tests verify that boundary holds, including under sudo.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { saveHostVibe } from "@/app/(member)/prickle-picker/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

function makeSupabaseMock({ hostsType, upsertError }: { hostsType: boolean; upsertError?: string }) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError ? { message: upsertError } : null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }),
    },
    from: vi.fn((table: string) => {
      if (table === "prickles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: hostsType ? { id: "p1" } : null }),
        };
      }
      if (table === "prickle_host_vibes") {
        return { upsert };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
    __upsert: upsert,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveHostVibe authorization scoping", () => {
  it("rejects when there is no authenticated user", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: true });
    mockSupabase.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mockSupabase.__upsert).not.toHaveBeenCalled();
  });

  it("rejects when the authenticated user has no member record", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: true });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "No member record" });
    expect(mockSupabase.__upsert).not.toHaveBeenCalled();
  });

  it("rejects when the acting member does not host the given type", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: false });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "You can only tag prickle types you host" });
    expect(mockSupabase.__upsert).not.toHaveBeenCalled();
  });

  it("scopes the write to the acting member's own host_id", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: true });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "opens with a check-in");
    expect(result).toEqual({ success: true });
    expect(mockSupabase.__upsert).toHaveBeenCalledWith(
      expect.objectContaining({ type_id: "type-a", host_id: "member-1", vibe: "chatty" }),
      { onConflict: "type_id,host_id" }
    );
  });

  it("scopes the write to the sudo'd member, not the real admin, while sudo'd", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: true });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
    // getEffectiveIdentity already resolves to the sudo'd member's own id —
    // saveHostVibe has no separate admin-id parameter to leak through.
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "sudo-target-member",
      memberName: "Sudo Target",
      memberEmail: "target@example.com",
      isSudo: true,
    });

    await saveHostVibe("type-a", "focused", "");
    expect(mockSupabase.__upsert).toHaveBeenCalledWith(
      expect.objectContaining({ host_id: "sudo-target-member" }),
      { onConflict: "type_id,host_id" }
    );
  });

  it("surfaces a database error from the upsert", async () => {
    const mockSupabase = makeSupabaseMock({ hostsType: true, upsertError: "constraint violation" });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue({
      memberId: "member-1",
      memberName: "Member One",
      memberEmail: "m1@example.com",
      isSudo: false,
    });

    const result = await saveHostVibe("type-a", "chatty", "");
    expect(result).toEqual({ error: "constraint violation" });
  });
});
