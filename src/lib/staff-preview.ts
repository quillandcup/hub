import { COMMUNITY_MANAGER_ROLE } from "@/lib/staff-access";

/**
 * "Preview as <role>": an admin looks at the admin area the way a lower staff role would, to check
 * what that role sees. Plain module (no server imports) so the proxy can read it too.
 *
 * The cookie only ever lowers access: it is read when the real role is `admin`, and any other real
 * role ignores it, so it can't be used to gain anything. Unlike sudo (which changes the member being
 * acted as), this changes the staff role being checked. It is UI and routing only: the data is still
 * read with the admin's own RLS access, so it can't prove a database limit.
 */
export const STAFF_PREVIEW_COOKIE = "staff_preview_role";

/** Roles an admin can preview. */
export const PREVIEWABLE_ROLES = [COMMUNITY_MANAGER_ROLE] as const;
export type PreviewableRole = (typeof PREVIEWABLE_ROLES)[number];

export function parsePreviewRole(value: string | null | undefined): PreviewableRole | null {
  return (PREVIEWABLE_ROLES as readonly string[]).includes(value ?? "") ? (value as PreviewableRole) : null;
}

/** The role to check this request against: the previewed role for a real admin, else the real role. */
export function effectiveStaffRole(realRole: string | null | undefined, previewCookie: string | null | undefined): string | null | undefined {
  return realRole === "admin" ? (parsePreviewRole(previewCookie) ?? realRole) : realRole;
}
