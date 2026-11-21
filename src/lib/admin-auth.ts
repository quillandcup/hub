import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { ADMIN_NO_ACCESS_PATH } from "@/lib/admin-paths";
import { ADMIN_ROLE, can, isStaffRole, staffHome, type Permission, type StaffRole } from "@/lib/permissions";
import { getStaffPreviewRole } from "@/lib/staff-preview.server";
import { getStaffMfaState } from "@/lib/staff-mfa.server";
import { blocksStaff } from "@/lib/staff-mfa";
import { redirectToGate } from "@/lib/gates.server";
import { GATES } from "@/lib/gates";

/** What an action returns when the staff member hasn't passed (or set up) the second sign-in step. */
export const MFA_REQUIRED_ERROR = "Two-step sign-in required";

export type { StaffRole };
/** `role` is the one to check against (the previewed role for an admin previewing); `realRole` is who they are. */
export type StaffUser = AuthUser & { role: StaffRole; realRole: StaffRole };

/** Staff who must pass (or set up) their second sign-in step are sent to /mfa, then back (src/lib/staff-mfa.ts). */
async function requireStaffMfaPage(): Promise<void> {
  if (blocksStaff(await getStaffMfaState())) await redirectToGate(GATES.staffMfa);
}

/** The signed-in user's staff role, read from `user_profiles` (never the token claim), or null. One read per request. */
const staffRoleOf = cache(async (userId: string): Promise<StaffRole | null> => {
  const profile = await createRepos(await createClient()).profiles.byId(userId).catch(() => null);
  return isStaffRole(profile?.role) ? profile.role : null;
});

/** A real admin looking at the area as a lower role is that role; everyone else is who they are. */
async function effectiveRole(realRole: StaffRole): Promise<StaffRole> {
  return (realRole === ADMIN_ROLE && (await getStaffPreviewRole())) || realRole;
}

/**
 * Secure permission check for admin-area server components (the Data Access Layer check the Next.js auth
 * guide recommends). Call it at the top of `src/app/(admin)/layout.tsx` (with `"staff.access"`) and of every
 * `src/app/(admin)/admin/**\/page.tsx`, with the permission the page needs:
 *
 *   const user = await requirePermission("pages.read");
 *
 * - signed out → redirect("/login")
 * - signed in but not staff (`user_profiles.role`, or no profile row) → redirect("/no-access")
 * - staff whose role lacks the permission → redirect("/no-access"); a real admin previewing a lower role goes
 *   to that role's home instead, since /no-access has no banner to leave the preview from
 * - otherwise returns the verified user with the role that let them in
 *
 * Why every page and not just the layout: layouts don't re-render on client navigation (partial rendering), and
 * a layout that swaps out `{children}` doesn't stop the page segment from running or reaching the RSC payload.
 * `src/proxy.ts` does an optimistic version of this same check first; this is the one that actually guards the
 * page's data. Sudo is irrelevant here: the sudo cookie changes the effective *member*, not the signed-in staff.
 *
 * Memoized per render with React `cache()`, so the layout and page share one role lookup.
 */
export const requirePermission = cache(async (permission: Permission): Promise<StaffUser> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const realRole = await staffRoleOf(user.id);
  if (!realRole) redirect(ADMIN_NO_ACCESS_PATH);
  const role = await effectiveRole(realRole);
  if (!can({ role }, permission)) redirect(role === realRole ? ADMIN_NO_ACCESS_PATH : staffHome(role));
  await requireStaffMfaPage();

  return { ...user, role, realRole };
});

export type ActionAuth =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>>; role: StaffRole; realRole: StaffRole }
  | { ok: false; error: "Not authenticated" | "Not authorized" | typeof MFA_REQUIRED_ERROR };

/**
 * Permission check for server actions (`"use server"` exports). Server actions are POST endpoints anyone
 * signed in can call directly, independent of the page that renders them, so neither the proxy nor
 * requirePermission() covers them. Every staff action starts with:
 *
 *   const auth = await requireActionPermission("pages.edit");
 *   if (!auth.ok) return { error: auth.error };
 *
 * Returns rather than redirects/throws so actions keep their `{ error }` result shape; callers that throw on
 * failure can `throw new Error(auth.error)` instead. `role` is the one to check finer features against
 * (`can(auth, ...)`): an admin previewing a lower role is that role here, so what the role may not do is
 * refused while previewing. The returned client is the signed-in user's, so row-level security still decides
 * the data. Reads `user_profiles.role`, never the token claim. Sudo doesn't matter (see above).
 */
export async function requireActionPermission(permission: Permission): Promise<ActionAuth> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  const realRole = await staffRoleOf(user.id);
  if (!realRole) return { ok: false, error: "Not authorized" };
  const role = await effectiveRole(realRole);
  if (!can({ role }, permission)) return { ok: false, error: "Not authorized" };
  if (blocksStaff(await getStaffMfaState())) return { ok: false, error: MFA_REQUIRED_ERROR };
  return { ok: true, user, supabase, role, realRole };
}
