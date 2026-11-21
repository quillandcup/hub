/**
 * Where a signed-in non-admin lands when they try to open the admin area.
 *
 * Deliberately not /dashboard: member pages send anyone without a member
 * record to /admin, so a non-admin with no member record would bounce
 * /admin ↔ /dashboard forever. /no-access lives outside both route groups and
 * never redirects a signed-in user, so it ends the chain.
 */
export const ADMIN_NO_ACCESS_PATH = "/no-access";

/** `/admin` and anything under `/admin/` -- but not look-alikes such as `/administrivia`. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
