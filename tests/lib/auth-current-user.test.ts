import { describe, it, expect, vi, beforeEach } from "vitest";

// getCurrentUser() is the request-scoped auth check used by layouts, pages,
// server actions and API routes in place of a per-call auth.getUser() round
// trip. It trusts only claims that auth.getClaims() has verified, and treats
// every failure mode (no session, AuthError, a thrown "JWT has expired") as
// "not signed in" rather than crashing the render.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function mockClaims(impl: () => Promise<unknown>) {
  const getClaims = vi.fn(impl);
  const getUser = vi.fn();
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims, getUser } } as any);
  return { getClaims, getUser };
}

describe("getCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns id and email from verified claims without calling getUser", async () => {
    const { getClaims, getUser } = mockClaims(async () => ({
      data: { claims: { sub: "user-1", email: "a@example.com", role: "authenticated" } },
      error: null,
    }));

    await expect(getCurrentUser()).resolves.toEqual({ id: "user-1", email: "a@example.com" });
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("omits email when the claim is absent", async () => {
    mockClaims(async () => ({ data: { claims: { sub: "user-1" } }, error: null }));
    await expect(getCurrentUser()).resolves.toEqual({ id: "user-1", email: undefined });
  });

  it("returns null when there is no session", async () => {
    mockClaims(async () => ({ data: null, error: null }));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when verification fails with an AuthError", async () => {
    mockClaims(async () => ({ data: null, error: { name: "AuthInvalidJwtError", message: "Invalid JWT signature" } }));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when getClaims throws (e.g. expired token)", async () => {
    mockClaims(async () => {
      throw new Error("JWT has expired");
    });
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
