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
