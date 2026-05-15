import { createClient } from "@/lib/supabase/server";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

/**
 * Creates a Supabase client for API routes.
 *
 * Supports two auth modes:
 * - Service role key in Authorization header: used by integration tests,
 *   returns a service role client that bypasses RLS
 * - Cookie-based: normal browser sessions
 *
 * Returns null for `user` if auth fails (caller should return 401).
 */
export async function createApiAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole =
    authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  if (isServiceRole) {
    const supabase = createDirectClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    return { supabase, user: { id: "service-role" } as const };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
 */
export async function requireAdmin(request: NextRequest) {
  const auth = await createApiAuth(request);
  if (!auth.user) return { ...auth, forbidden: true as const };
  // Service-role key used by integration tests bypasses role check
  if (auth.user.id === "service-role") return { ...auth, forbidden: false as const };
  const { data: profile } = await auth.supabase
    .from("user_profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if (profile?.role !== "admin") return { ...auth, forbidden: true as const };
  return { ...auth, forbidden: false as const };
}
