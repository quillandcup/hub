// Reads claims off a Supabase Auth JWT access token WITHOUT verifying the
// signature — this is intentionally not a verification step. Callers
// (lib/supabase/middleware.ts) only call these after supabase.auth.getUser()
// has already verified the same token over the network; they just read
// claims off it. Anything decided from them must be re-checked where it
// matters (RLS scopes data by auth.uid(); requireAdminPage() re-reads the
// role from user_profiles).
function decodeAccessTokenClaims(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return null;

    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json);

    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * The `session_id` claim, for tagging access_events rows. A malformed or
 * spoofed token can at worst mistag a row.
 */
export function getSessionIdFromAccessToken(token: string): string | null {
  const claims = decodeAccessTokenClaims(token);
  return typeof claims?.session_id === "string" ? claims.session_id : null;
}

/**
 * The `app_role` claim added by the custom access token hook
 * (supabase/migrations/20260926000900_add_role_to_access_token.sql):
 *
 * - a string (`"admin"`, `"member"`, ...) — `user_profiles.role` when the token was minted
 * - `null` — the hook ran and found no `user_profiles` row (not an admin)
 * - `undefined` — no claim (the hook isn't enabled, or its lookup failed);
 *   the proxy treats this as not-admin
 *
 * Only as fresh as the token (up to auth.jwt_expiry old), so it's for the
 * proxy's optimistic check only — never for authorization.
 */
export function getAppRoleFromAccessToken(token: string): string | null | undefined {
  const claims = decodeAccessTokenClaims(token);
  if (!claims || !("app_role" in claims)) return undefined;
  const role = claims.app_role;
  if (role === null || typeof role === "string") return role;
  return undefined;
}
