import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { ADMIN_NO_ACCESS_PATH } from "@/lib/admin-paths";

/**
 * Secure admin check for admin-area server components (the Data Access Layer
 * check the Next.js auth guide recommends). Call it at the top of
 * `app/(admin)/layout.tsx` and of every `app/(admin)/admin/**\/page.tsx`:
 *
 *   const user = await requireAdminPage();
 *
 * - signed out → redirect("/login")
 * - signed in but `user_profiles.role !== "admin"` (or no profile row) → redirect("/no-access")
 * - admin → returns the verified user
 *
 * Why every page and not just the layout: layouts don't re-render on client
 * navigation (partial rendering), and a layout that swaps out `{children}`
 * doesn't stop the page segment from running or reaching the RSC payload.
 * `proxy.ts` does an optimistic version of this same check first; this is the
 * one that actually guards the page's data.
 *
 * Sudo is irrelevant here, as in the proxy: the sudo cookie changes the
 * effective *member* identity, not the signed-in admin, so an admin in sudo
 * mode still passes.
 *
 * Memoized per render with React `cache()`, so the layout and page share a
 * single role lookup (and `getCurrentUser()` is itself cached).
 */
export const requireAdminPage = cache(async (): Promise<AuthUser> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") redirect(ADMIN_NO_ACCESS_PATH);

  return user;
});

export type AdminActionAuth =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: "Not authenticated" | "Not authorized" };

/**
 * Admin check for server actions (`"use server"` exports). Server actions are
 * POST endpoints anyone signed in can call directly, independent of the page
 * that renders them, so neither the proxy nor requireAdminPage() covers them.
 * Every admin-only action starts with:
 *
 *   const auth = await requireAdminAction();
 *   if (!auth.ok) return { error: auth.error };
 *
 * Returns rather than redirects/throws so actions keep their existing
 * `{ error }` result shape; callers that throw on failure can
 * `throw new Error(auth.error)` instead. Sudo doesn't matter (see above).
 */
export async function requireAdminAction(): Promise<AdminActionAuth> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return { ok: false, error: "Not authorized" };
  return { ok: true, user, supabase };
}
