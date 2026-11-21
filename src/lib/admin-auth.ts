import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { ADMIN_NO_ACCESS_PATH } from "@/lib/admin-paths";
import { COMMUNITY_MANAGER_HOME, COMMUNITY_MANAGER_ROLE } from "@/lib/staff-access";
import { getStaffPreviewRole } from "@/lib/staff-preview.server";
import { getStaffMfaState } from "@/lib/staff-mfa.server";
import { blocksStaff } from "@/lib/staff-mfa";
import { redirectToGate } from "@/lib/gates.server";
import { GATES } from "@/lib/gates";

/** What an action returns when the staff member hasn't passed (or set up) the second sign-in step. */
export const MFA_REQUIRED_ERROR = "Two-step sign-in required";

/** Staff who must pass (or set up) their second sign-in step are sent to /mfa, then back (src/lib/staff-mfa.ts). */
async function requireStaffMfaPage(): Promise<void> {
  if (blocksStaff(await getStaffMfaState())) await redirectToGate(GATES.staffMfa);
}

/**
 * Secure admin check for admin-area server components (the Data Access Layer
 * check the Next.js auth guide recommends). Call it at the top of
 * `src/app/(admin)/layout.tsx` and of every `src/app/(admin)/admin/**\/page.tsx`:
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
 * `src/proxy.ts` does an optimistic version of this same check first; this is the
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
  if (!(await createRepos(supabase).profiles.isAdmin(user.id))) redirect(ADMIN_NO_ACCESS_PATH);
  // An admin previewing a lower role is refused an admin-only page like that role would be. They go to that
  // role's home, not /no-access, which has no banner to leave the preview from.
  if (await getStaffPreviewRole()) redirect(COMMUNITY_MANAGER_HOME);
  await requireStaffMfaPage();

  return user;
});

export type StaffRole = "admin" | typeof COMMUNITY_MANAGER_ROLE;
/** `role` is the one to check against (the previewed role for an admin previewing); `realRole` is who they are. */
export type StaffUser = AuthUser & { role: StaffRole; realRole: StaffRole };

/**
 * Secure check for an admin page a community manager may also open (the read-only pages in
 * src/lib/staff-access.ts), and for the admin layout. Same redirects as requireAdminPage(); returns
 * the user with the role that let them in. Reads `user_profiles.role`, never the token claim.
 *
 * A page that calls this must show a community manager no write control: its server actions keep
 * `requireAdminAction()`, which refuses them.
 */
export const requireStaffPage = cache(async (): Promise<StaffUser> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profile = await createRepos(await createClient()).profiles.byId(user.id).catch(() => null);
  if (profile?.role !== "admin" && profile?.role !== COMMUNITY_MANAGER_ROLE) redirect(ADMIN_NO_ACCESS_PATH);
  await requireStaffMfaPage();

  // A real admin previewing a lower role is that role here.
  const role = (profile.role === "admin" && (await getStaffPreviewRole())) || profile.role;
  return { ...user, role, realRole: profile.role };
});

export type AdminActionAuth =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: "Not authenticated" | "Not authorized" | typeof MFA_REQUIRED_ERROR };

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
  if (!(await createRepos(supabase).profiles.isAdmin(user.id))) return { ok: false, error: "Not authorized" };
  // Previewing a lower role: its actions are refused, as they would be for that role.
  if (await getStaffPreviewRole()) return { ok: false, error: "Not authorized" };
  if (blocksStaff(await getStaffMfaState())) return { ok: false, error: MFA_REQUIRED_ERROR };
  return { ok: true, user, supabase };
}

export type StaffActionAuth =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>>; role: StaffRole; realRole: StaffRole }
  | { ok: false; error: "Not authenticated" | "Not authorized" | typeof MFA_REQUIRED_ERROR };

/**
 * Staff check for a server action a community manager may also call (a page that lists them in
 * src/lib/staff-access.ts and gives them a write control through `STAFF_FEATURES`). Same shape as
 * requireAdminAction(), but lets an admin and a community manager in:
 *
 *   const auth = await requireStaffAction();
 *   if (!auth.ok) return { error: auth.error };
 *
 * `role` is the one to check a feature against (`staffCan(auth.role, ...)`): an admin previewing a lower
 * role is that role here, as in requireStaffPage(), so what the role may not do is refused while
 * previewing. The returned client is the signed-in user's, so row-level security still decides the data.
 * Reads `user_profiles.role`, never the token claim. Actions that stay admin-only keep
 * requireAdminAction(), which refuses a community manager.
 */
export async function requireStaffAction(): Promise<StaffActionAuth> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  const profile = await createRepos(supabase).profiles.byId(user.id).catch(() => null);
  if (profile?.role !== "admin" && profile?.role !== COMMUNITY_MANAGER_ROLE) return { ok: false, error: "Not authorized" };

  if (blocksStaff(await getStaffMfaState())) return { ok: false, error: MFA_REQUIRED_ERROR };

  const role = (profile.role === "admin" && (await getStaffPreviewRole())) || profile.role;
  return { ok: true, user, supabase, role, realRole: profile.role };
}
