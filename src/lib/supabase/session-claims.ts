import { staffRolesIn, type StaffRole } from "@/lib/permissions";

// Reads claims off a Supabase Auth JWT access token WITHOUT verifying the
// signature — this is intentionally not a verification step. Callers
// (src/lib/supabase/middleware.ts) only call these after supabase.auth.getUser()
// has already verified the same token over the network; they just read
// claims off it. Anything decided from them must be re-checked where it
// matters (RLS scopes data by auth.uid(); requirePermission(...) re-reads the
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
 * The staff roles the token's claims say the user holds, highest priority first: the `app_roles` array that the
 * custom access token hook adds (supabase/migrations/20271028000000_user_roles.sql). The hook still adds `app_role` (the primary
 * role) too, but nothing reads it.
 *
 * - an array (possibly empty) -- the roles held when the token was minted (anything that isn't a staff role is dropped)
 * - `undefined` -- no usable claim (the hook isn't enabled, or its lookup failed): the proxy treats this as no role
 *
 * Only as fresh as the token, so it is for the proxy's optimistic check only -- never for authorization.
 */
export function getAppRolesFromAccessToken(token: string): StaffRole[] | undefined {
  const claims = decodeAccessTokenClaims(token);
  if (!claims || !Array.isArray(claims.app_roles)) return undefined;
  return staffRolesIn(claims.app_roles.filter((r): r is string => typeof r === "string"));
}

/**
 * The `aal` claim: `"aal2"` once the session has passed a second factor (a TOTP code), `"aal1"` after a
 * link or code sign-in alone, `null` when the token doesn't carry it. Only as trustworthy as the caller's
 * own verification of the token (the proxy reads it after `getUser()`); never for anything but a pre-filter.
 */
export function getAalFromAccessToken(token: string): string | null {
  const aal = decodeAccessTokenClaims(token)?.aal;
  return typeof aal === "string" ? aal : null;
}
