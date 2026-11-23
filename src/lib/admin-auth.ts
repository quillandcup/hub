import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { ADMIN_NO_ACCESS_PATH } from "@/lib/admin-paths";
import { staffHome, type Permission, type StaffRole } from "@/lib/permissions";
import { decideStaff } from "@/lib/staff-guard";
import { getStaffPreviewRole } from "@/lib/staff-preview.server";
import { getStaffMfaState } from "@/lib/staff-mfa.server";
import { blocksStaff } from "@/lib/staff-mfa";
import { redirectToGate } from "@/lib/gates.server";
import { GATES } from "@/lib/gates";

/** What an action returns when the staff member hasn't passed (or set up) the second sign-in step. */
export const MFA_REQUIRED_ERROR = "Two-step sign-in required";

export type { StaffRole };
/**
 * `roles` are the ones to check against (just the previewed role for an admin previewing) and `role` is the primary of
 * them, the highest priority; `realRoles`/`realRole` are who they are. `can(user, ...)` reads both, so the union decides.
 */
export type StaffUser = AuthUser & { role: StaffRole; roles: StaffRole[]; realRole: StaffRole; realRoles: StaffRole[] };

const mfaBlocked = async () => blocksStaff(await getStaffMfaState());

/** The signed-in user's staff roles, read from the database (`user_roles` and `user_profiles`, never the token claim); none for a member. One read per request. */
const staffRolesOf = cache(async (userId: string): Promise<StaffRole[]> => {
  return createRepos(await createClient()).profiles.rolesOf(userId).catch(() => []);
});

/**
 * Secure permission check for admin-area server components (the Data Access Layer check the Next.js auth
 * guide recommends). Call it at the top of `src/app/(admin)/layout.tsx` (with `"staff.access"`) and of every
 * `src/app/(admin)/admin/**\/page.tsx`, with the permission the page needs:
 *
 *   const user = await requirePermission("pages.read");
 *
 * - signed out → redirect("/login")
 * - signed in but not staff (holds no staff role in `user_roles`) → redirect("/no-access")
 * - staff none of whose roles holds the permission → redirect("/no-access"); a real admin previewing a lower role goes
 *   to that role's home instead, since /no-access has no banner to leave the preview from
 * - otherwise returns the verified user with the roles that let them in
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

  // The shared decision (src/lib/staff-guard.ts); this guard only says how a "no" is delivered: a redirect.
  const decision = await decideStaff({ realRoles: await staffRolesOf(user.id), previewRole: await getStaffPreviewRole(), permission, mfaBlocked });
  if (!decision.ok) {
    if (decision.reason === "mfa") return await redirectToGate(GATES.staffMfa);
    // A previewing admin goes to the previewed role's home: /no-access has no banner to leave the preview from.
    redirect(decision.reason === "forbidden" && decision.previewing ? staffHome(decision.role) : ADMIN_NO_ACCESS_PATH);
  }
  return { ...user, role: decision.role, roles: decision.roles, realRole: decision.realRole, realRoles: decision.realRoles };
});

export type ActionAuth =
  | { ok: true; user: AuthUser; supabase: Awaited<ReturnType<typeof createClient>>; role: StaffRole; roles: StaffRole[]; realRole: StaffRole; realRoles: StaffRole[] }
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
 * the data. Reads the roles from the database, never the token claim. Sudo doesn't matter (see above).
 */
export async function requireActionPermission(permission: Permission): Promise<ActionAuth> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // The shared decision (src/lib/staff-guard.ts); this guard only says how a "no" is delivered: `{ ok: false, error }`.
  const supabase = await createClient();
  const decision = await decideStaff({ realRoles: await staffRolesOf(user.id), previewRole: await getStaffPreviewRole(), permission, mfaBlocked });
  if (!decision.ok) return { ok: false, error: decision.reason === "mfa" ? MFA_REQUIRED_ERROR : "Not authorized" };
  return { ok: true, user, supabase, role: decision.role, roles: decision.roles, realRole: decision.realRole, realRoles: decision.realRoles };
}
