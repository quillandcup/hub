import { ADMIN_ROLE, can, isStaffRole, type Permission, type StaffRole } from "@/lib/permissions";

/**
 * The decision every staff guard makes, once: given who the signed-in person really is, the role an admin may be
 * previewing, and the permission asked for, is this allowed? The three guards (`requirePermission` for pages,
 * `requireActionPermission` for server actions, `requireApiPermission` for route handlers) differ only in how
 * they find the person and in how a "no" is delivered (a redirect, `{ ok: false, error }`, an HTTP 401 or 403);
 * this function is the part they share, so they can't disagree about who may do what.
 *
 * Order matters and is the same everywhere: not staff, then lacking the permission, then the second sign-in step
 * (so someone without access is never told to set up a second step).
 */
export type StaffDecision =
  | { ok: true; role: StaffRole; realRole: StaffRole }
  | { ok: false; reason: "not_staff" }
  | { ok: false; reason: "forbidden"; role: StaffRole; realRole: StaffRole; previewing: boolean }
  | { ok: false; reason: "mfa"; role: StaffRole; realRole: StaffRole };

export async function decideStaff(input: {
  /** `user_profiles.role` as read from the database (never the token claim). */
  realRole: string | null | undefined;
  /** The role an admin is previewing, if any; ignored for anyone but a real admin. Routes pass none. */
  previewRole?: StaffRole | null;
  permission: Permission;
  /** Asked only once the permission is held. */
  mfaBlocked: () => Promise<boolean>;
}): Promise<StaffDecision> {
  const { realRole } = input;
  if (!isStaffRole(realRole)) return { ok: false, reason: "not_staff" };
  const role = (realRole === ADMIN_ROLE && input.previewRole) || realRole;
  if (!can({ role }, input.permission)) return { ok: false, reason: "forbidden", role, realRole, previewing: role !== realRole };
  if (await input.mfaBlocked()) return { ok: false, reason: "mfa", role, realRole };
  return { ok: true, role, realRole };
}
