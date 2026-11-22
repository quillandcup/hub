import { ADMIN_ROLE, can, primaryRole, staffRolesIn, type Permission, type StaffRole } from "@/lib/permissions";

/**
 * The decision every staff guard makes, once: given who the signed-in person really is (the roles they hold), the role
 * an admin may be previewing, and the permission asked for, is this allowed? The three guards (`requirePermission` for
 * pages, `requireActionPermission` for server actions, `requireApiPermission` for route handlers) differ only in how
 * they find the person and in how a "no" is delivered (a redirect, `{ ok: false, error }`, an HTTP 401 or 403);
 * this function is the part they share, so they can't disagree about who may do what.
 *
 * A person can hold several roles and may do what the union allows. `role` is the primary one (the highest priority,
 * what `user_profiles.role` holds); `roles` is every role in effect: the real roles, or just the previewed one while a
 * real admin previews. `realRole`/`realRoles` are who they are, whatever is previewed.
 *
 * Order matters and is the same everywhere: not staff, then lacking the permission, then the second sign-in step
 * (so someone without access is never told to set up a second step).
 */
export type StaffDecision =
  | { ok: true; role: StaffRole; roles: StaffRole[]; realRole: StaffRole; realRoles: StaffRole[] }
  | { ok: false; reason: "not_staff" }
  | { ok: false; reason: "forbidden"; role: StaffRole; roles: StaffRole[]; realRole: StaffRole; realRoles: StaffRole[]; previewing: boolean }
  | { ok: false; reason: "mfa"; role: StaffRole; roles: StaffRole[]; realRole: StaffRole; realRoles: StaffRole[] };

export async function decideStaff(input: {
  /** The roles held, read from the database (`user_roles`, with `user_profiles.role`), never the token claim. */
  realRoles?: readonly string[] | null;
  /** One role held; the same as `realRoles` with one entry (kept for single-role callers). */
  realRole?: string | null;
  /** The role an admin is previewing, if any; ignored for anyone who does not hold admin. Routes pass none. */
  previewRole?: StaffRole | null;
  permission: Permission;
  /** Asked only once the permission is held. */
  mfaBlocked: () => Promise<boolean>;
}): Promise<StaffDecision> {
  const realRoles = staffRolesIn([...(input.realRoles ?? []), ...(input.realRole ? [input.realRole] : [])]);
  const realRole = primaryRole(realRoles);
  if (!realRole) return { ok: false, reason: "not_staff" };
  // Previewing lowers a real admin to one role; nobody else's preview counts. The effective set is just that role.
  const previewing = realRoles.includes(ADMIN_ROLE) && !!input.previewRole && input.previewRole !== ADMIN_ROLE;
  const roles: StaffRole[] = previewing ? [input.previewRole as StaffRole] : realRoles;
  const role = roles[0];
  if (!can({ roles }, input.permission)) return { ok: false, reason: "forbidden", role, roles, realRole, realRoles, previewing };
  if (await input.mfaBlocked()) return { ok: false, reason: "mfa", role, roles, realRole, realRoles };
  return { ok: true, role, roles, realRole, realRoles };
}
