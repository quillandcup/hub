import { describe, it, expect } from "vitest";
import { getSessionIdFromAccessToken } from "@/lib/supabase/session-claims";

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
