import { describe, it, expect, vi, beforeEach } from "vitest";

// These actions are the RPC-calling server logic backing the self-service
// "Active Sessions" panel on /settings. They must always resolve the real
// authenticated auth user (supabase.auth.getUser()) — never
// getEffectiveIdentity — because Supabase Auth sessions belong to
// auth.users, not to the members table, and a sudo'd admin must never end
// up managing (or worse, revoking) the member's sessions instead of their
// own. The actual per-user scoping happens server-side in the
// get_my_sessions()/revoke_my_session() RPCs via auth.uid() — these tests
// verify the client-side auth gate and RPC wiring around them.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  getMySessions,
  revokeSession,
  signOutOtherSessions,
} from "@/app/(member)/settings/actions";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function makeSupabaseMock({
  authenticated = true,
  rpcResult = { data: [], error: null },
  signOutError = null as { message: string } | null,
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: "auth-user-1" } : null },
      }),
      signOut: vi.fn().mockResolvedValue({ error: signOutError }),
    },
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMySessions", () => {
  it("rejects when there is no authenticated user", async () => {
    const mockSupabase = makeSupabaseMock({ authenticated: false });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await getMySessions();
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("calls get_my_sessions with no arguments (server scopes via auth.uid())", async () => {
    const rows = [{ id: "s1", is_current: true }];
    const mockSupabase = makeSupabaseMock({ rpcResult: { data: rows, error: null } });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await getMySessions();
    expect(mockSupabase.rpc).toHaveBeenCalledWith("get_my_sessions");
    expect(result).toEqual({ sessions: rows });
  });

  it("surfaces an RPC error", async () => {
    const mockSupabase = makeSupabaseMock({
      rpcResult: { data: null, error: { message: "permission denied" } },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await getMySessions();
    expect(result).toEqual({ error: "permission denied" });
  });
});

describe("revokeSession", () => {
  it("rejects when there is no authenticated user", async () => {
    const mockSupabase = makeSupabaseMock({ authenticated: false });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await revokeSession("session-1");
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("passes the target session id and revalidates on success", async () => {
    const mockSupabase = makeSupabaseMock({ rpcResult: { data: true, error: null } });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await revokeSession("session-1");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("revoke_my_session", {
      target_session_id: "session-1",
    });
    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("reports a friendly error when the RPC deletes nothing (not found / not owned)", async () => {
    const mockSupabase = makeSupabaseMock({ rpcResult: { data: false, error: null } });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await revokeSession("someone-elses-session");
    expect(result).toEqual({ error: "That session was already signed out" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error", async () => {
    const mockSupabase = makeSupabaseMock({
      rpcResult: { data: null, error: { message: "boom" } },
    });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await revokeSession("session-1");
    expect(result).toEqual({ error: "boom" });
  });
});

describe("signOutOtherSessions", () => {
  it("rejects when there is no authenticated user", async () => {
    const mockSupabase = makeSupabaseMock({ authenticated: false });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await signOutOtherSessions();
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("calls signOut with scope 'others' and revalidates on success", async () => {
    const mockSupabase = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await signOutOtherSessions();
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("surfaces a signOut error", async () => {
    const mockSupabase = makeSupabaseMock({ signOutError: { message: "network error" } });
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await signOutOtherSessions();
    expect(result).toEqual({ error: "network error" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
