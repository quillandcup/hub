import { createClient } from "@/lib/supabase/server";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";

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
  const isServiceRole =
    authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);
  const isCron =
    authHeader && cronSecret && serviceRoleKey && authHeader === `Bearer ${cronSecret}`;

  if (isServiceRole || isCron) {
    const supabase = createDirectClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    return { supabase, user: { id: isCron ? "cron" : "service-role" } as const };
  }

  const supabase = await createClient();
  let user = null;
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_CHECK_TIMEOUT_MS);
    user = data.user;
  } catch {
    // Supabase unreachable or too slow — fall through to the documented
    // "return null for user, caller returns 401" contract instead of
    // crashing the function with an uncaught rejection.
  }

  return { supabase, user };
}

/**
 * Verifies that the request is from an authenticated admin user.
 *
 * Returns an object with:
 * - supabase: the client
 * - user: the authenticated user (or null if no session)
 * - forbidden: true if user is not admin, false otherwise
 *
 * Service-role key in Authorization header bypasses role check (used by tests).
 * Vercel Cron secret in Authorization header also bypasses role check.
 */
export async function requireAdmin(request: NextRequest) {
  const auth = await createApiAuth(request);
  if (!auth.user) return { ...auth, forbidden: true as const };
  // Service-role key (tests) or cron secret (Vercel Cron) bypasses role check
  if (auth.user.id === "service-role" || auth.user.id === "cron") {
    return { ...auth, forbidden: false as const };
  }
  const { data: profile } = await auth.supabase
    .from("user_profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (profile?.role !== "admin") return { ...auth, forbidden: true as const };
  return { ...auth, forbidden: false as const };
}
