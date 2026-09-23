import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The slice of the authenticated user that authorization and member lookups
 * actually need. Both a full Supabase `User` (from `auth.getUser()`) and the
 * object returned by `getCurrentUser()` below satisfy it, so helpers like
 * `getEffectiveIdentity` accept either.
 */
export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * Resolve the signed-in user for the current request from their verified JWT
 * claims, without a Supabase Auth network round trip.
 *
 * `auth.getClaims()` verifies the access token's signature locally against
 * the project's JWKS (asymmetric ES256 keys; the key set is cached in-process
 * for 10 minutes by auth-js) and rejects expired tokens. That's the same trust
 * level PostgREST applies to every RLS-scoped query, so it's safe for authz.
 * If the project were ever switched back to a symmetric (HS256) secret,
 * auth-js transparently falls back to a `getUser()` network call instead.
 *
 * What it does NOT do is check that the session is still live server-side
 * (revoked sessions keep a valid JWT until it expires). That check still
 * happens once per request in middleware (lib/supabase/middleware.ts), whose
 * `getUser()` clears the auth cookies from the forwarded request when the
 * session is gone — so by the time a layout/page/action runs here, a revoked
 * session has no token to verify. Anything that needs fields not carried in
 * the JWT (`last_sign_in_at`, `identities`, confirmation timestamps, ...)
 * must still call `auth.getUser()` directly.
 *
 * Wrapped in React `cache()` so the layout, page and any nested server
 * components share one verification per render. Outside a render (server
 * actions, route handlers) `cache()` is a pass-through, which is fine — the
 * verification is local and cheap.
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || !sub) return null;
    return {
      id: sub,
      email: typeof data.claims.email === "string" ? data.claims.email : undefined,
    };
  } catch {
    // getClaims() rethrows non-AuthError failures (notably "JWT has expired"
    // from its exp check). An unverifiable token is simply "not signed in".
    return null;
  }
});
