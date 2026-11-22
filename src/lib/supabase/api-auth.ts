import { createClient } from "@/lib/supabase/server";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import { createRepos } from "@/lib/data/repos";
import { NextRequest } from "next/server";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { secretsMatch } from "@/lib/webhook-auth";
import { staffMfaStateFor } from "@/lib/staff-mfa.server";
import { blocksStaff } from "@/lib/staff-mfa";
import type { Permission } from "@/lib/permissions";
import { decideStaff } from "@/lib/staff-guard";

/**
 * Creates a Supabase client for API routes.
 *
 * Supports three auth modes:
 * - Service role key in Authorization header: used by integration tests,
 *   returns a service role client that bypasses RLS
 * - Vercel Cron secret in Authorization header: used by scheduled cron
 *   invocations, returns a service role client that bypasses RLS
 * - Cookie-based: normal browser sessions
 *
 * Returns null for `user` if auth fails (caller should return 401).
 */
export async function createApiAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;
  // Exact `Bearer <secret>` only, compared in constant time (never a substring match).
  const isServiceRole = !!serviceRoleKey && secretsMatch(`Bearer ${serviceRoleKey}`, authHeader);
  const isCron = !!cronSecret && !!serviceRoleKey && secretsMatch(`Bearer ${cronSecret}`, authHeader);

  if (isServiceRole || isCron) {
    const supabase = createDirectClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    return { supabase, user: { id: isCron ? "cron" : "service-role" } as const };
  }

  const supabase = await createClient();
  let user: AuthUser | null = null;
  try {
    // Verified JWT claims (local signature check against cached JWKS), not a
    // per-request getUser() round trip to Supabase Auth -- see src/lib/auth.ts.
    // The timeout still guards the occasional JWKS refresh fetch.
    user = await withTimeout(getCurrentUser(), AUTH_CHECK_TIMEOUT_MS);
  } catch {
    // Supabase unreachable or too slow — fall through to the documented
    // "return null for user, caller returns 401" contract instead of
    // crashing the function with an uncaught rejection.
  }

  return { supabase, user };
}

/**
 * Verifies that the request is from an authenticated staff member whose role holds the permission
 * (src/lib/permissions.ts). The route handler's guard:
 *
 *   const auth = await requireApiPermission(request, "pages.edit");
 *   if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 *
 * Returns an object with:
 * - supabase: the client
 * - user: the authenticated user (or null if no session)
 * - forbidden: true if the user's role lacks the permission, false otherwise
 *
 * Reads the roles from the database (`user_roles`, with `user_profiles.role`), never the token claim. A "view as role" preview doesn't apply to routes (it is
 * UI and routing only). Service-role key in Authorization header bypasses the role check (used by tests).
 * Vercel Cron secret in Authorization header also bypasses the role check.
 */
export async function requireApiPermission(request: NextRequest, permission: Permission) {
  const auth = await createApiAuth(request);
  if (!auth.user) return { ...auth, forbidden: true as const };
  // Service-role key (tests) or cron secret (Vercel Cron) bypasses role check
  if (auth.user.id === "service-role" || auth.user.id === "cron") {
    return { ...auth, forbidden: false as const };
  }
  // The shared decision (src/lib/staff-guard.ts); this guard only says how a "no" is delivered: `forbidden` (a 403 in the
  // route). Staff who haven't passed (or set up) the second sign-in step get what a non-staff user gets (src/lib/staff-mfa.ts).
  const realRoles = await createRepos(auth.supabase).profiles.rolesOf(auth.user.id).catch(() => []);
  const decision = await decideStaff({
    realRoles,
    permission,
    mfaBlocked: async () => blocksStaff(await staffMfaStateFor(auth.supabase)),
  });
  return { ...auth, forbidden: !decision.ok };
}
