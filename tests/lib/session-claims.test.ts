import { describe, it, expect } from "vitest";
import { getAppRolesFromAccessToken, getSessionIdFromAccessToken } from "@/lib/supabase/session-claims";

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

describe("getAppRolesFromAccessToken", () => {
  it("returns the app_roles array of the custom access token hook, highest priority first", () => {
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_roles: ["conversion_specialist", "community_manager"], app_role: "community_manager" }))).toEqual([
      "community_manager",
      "conversion_specialist",
    ]);
  });

  it("returns an empty list for a member, and drops anything that is not a staff role", () => {
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_roles: [], app_role: "member" }))).toEqual([]);
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_roles: ["member", "owner", 3, "admin"] }))).toEqual(["admin"]);
  });

  it("does not read the single app_role: a token without the array has no usable claim", () => {
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_role: "assistant" }))).toBeUndefined();
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_role: null }))).toBeUndefined();
  });

  it("returns undefined when there is no usable claim, never reading the reserved role claim", () => {
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", role: "admin" }))).toBeUndefined();
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_role: 1 }))).toBeUndefined();
    expect(getAppRolesFromAccessToken("not-a-jwt")).toBeUndefined();
  });

  it("treats a non-array app_roles as absent", () => {
    expect(getAppRolesFromAccessToken(makeJwt({ sub: "u", app_roles: "admin", app_role: "assistant" }))).toBeUndefined();
  });
});
