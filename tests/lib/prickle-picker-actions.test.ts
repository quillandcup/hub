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

vi.mock("@/lib/timezone", () => ({
  getUserTimezonePreference: vi.fn().mockResolvedValue("America/New_York"),
}));

import { getWizardRecommendations, saveHostVibe } from "@/app/(member)/prickle-picker/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

function makeSupabaseMock({ hostsType, upsertError }: { hostsType: boolean; upsertError?: string }) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError ? { message: upsertError } : null });

  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }),
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
    mockSupabase.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
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

// ---------------------------------------------------------------------------
// getWizardRecommendations: feelings + personal history
// ---------------------------------------------------------------------------

/** A chainable query fake: every filter returns itself, awaiting resolves the table's rows. */
function makeQueryFake(tables: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ["select", "eq", "gte", "lte", "lt", "order", "not", "is", "in", "range"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    return builder;
  });
  return {
    client: {
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
      from,
    },
    calls,
  };
}

const MEMBER = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const BASE_ANSWERS = { windowDays: 7, timeOfDay: "any" as const, vibe: "any" as const, purpose: "any" as const, withMemberIds: [] };

describe("getWizardRecommendations", () => {
  it("rejects unknown feelings before querying anything", async () => {
    const fake = makeQueryFake({});
    vi.mocked(createClient).mockResolvedValue(fake.client as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(MEMBER);

    const result = await getWizardRecommendations({ ...BASE_ANSWERS, feelings: ["hangry" as any] });
    expect(result).toEqual({ error: "Invalid feelings" });
    expect(fake.client.from).not.toHaveBeenCalled();
  });

  it("ranks with the member's own rated check-ins from similar times", async () => {
    const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const fake = makeQueryFake({
      prickle_types: [{ id: "t1", name: "Heads Down", purpose: "writing", solo_task_friendly: true }],
      member_directory: [],
      prickles: [
        { id: "p-a", type_id: "t1", host_id: "host-a", start_time: soon(2) },
        { id: "p-b", type_id: "t1", host_id: "host-b", start_time: soon(3) },
      ],
      prickle_host_vibes: [],
      prickle_attendance: [],
      prickle_checkins: [
        { feelings_before: ["anxious"], need: null, session_rating: 5, prickles: { type_id: "t1", host: "host-b" } },
        { feelings_before: ["anxious"], need: null, session_rating: 5, prickles: { type_id: "t1", host: "host-b" } },
        { feelings_before: ["calm"], need: null, session_rating: 1, prickles: { type_id: "t1", host: "host-a" } },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(fake.client as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(MEMBER);

    const result = await getWizardRecommendations({ ...BASE_ANSWERS, feelings: ["stressed"], need: null });
    if ("error" in result) throw new Error(result.error);

    expect(result.recommendations[0].hostId).toBe("host-b");
    expect(result.recommendations[0].personal).toEqual({ sessions: 2, avgRating: 5 });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "eq", args: ["member_id", "member-1"] });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "not", args: ["session_rating", "is", null] });
    expect(fake.calls).toContainEqual({ table: "prickle_checkins", method: "is", args: ["deleted_at", null] });
  });
});
