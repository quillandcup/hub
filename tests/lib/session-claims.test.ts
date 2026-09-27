import { describe, it, expect } from "vitest";
import { getAppRoleFromAccessToken, getSessionIdFromAccessToken } from "@/lib/supabase/session-claims";

function makeJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url(payload);
  // Signature is never verified by getSessionIdFromAccessToken — a dummy
  // value is fine here.
  return `${header}.${body}.dummy-signature`;
}

describe("getSessionIdFromAccessToken", () => {
  it("extracts the session_id claim from a well-formed token", () => {
    const token = makeJwt({ sub: "user-1", session_id: "11111111-1111-1111-1111-111111111111" });
    expect(getSessionIdFromAccessToken(token)).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns null for a malformed, non-JWT string", () => {
    expect(getSessionIdFromAccessToken("not-a-jwt")).toBeNull();
    expect(getSessionIdFromAccessToken("")).toBeNull();
  });

  it("returns null when the session_id claim is missing", () => {
    const token = makeJwt({ sub: "user-1" });
    expect(getSessionIdFromAccessToken(token)).toBeNull();
  });

  it("returns null when the session_id claim is present but not a string", () => {
    const token = makeJwt({ sub: "user-1", session_id: 12345 });
    expect(getSessionIdFromAccessToken(token)).toBeNull();
  });
});

describe("getAppRoleFromAccessToken", () => {
  it("returns the app_role claim added by the custom access token hook", () => {
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", role: "authenticated", app_role: "admin" }))).toBe("admin");
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", app_role: "member" }))).toBe("member");
  });

  it("returns null when the hook found no user_profiles row", () => {
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", app_role: null }))).toBeNull();
  });

  it("returns undefined when the claim is absent (token minted before the hook)", () => {
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", role: "authenticated" }))).toBeUndefined();
  });

  it("never reads the reserved role claim as the app role", () => {
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", role: "admin" }))).toBeUndefined();
  });

  it("returns undefined for a malformed token or a non-string claim", () => {
    expect(getAppRoleFromAccessToken("not-a-jwt")).toBeUndefined();
    expect(getAppRoleFromAccessToken("")).toBeUndefined();
    expect(getAppRoleFromAccessToken(makeJwt({ sub: "u", app_role: 1 }))).toBeUndefined();
  });

  it("still reads the claim when the payload has non-ASCII characters", () => {
    const token = makeJwt({ sub: "u", email: "zo\u00eb@example.com", app_role: "admin" });
    expect(getAppRoleFromAccessToken(token)).toBe("admin");
  });
});
