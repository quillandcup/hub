/**
 * Who may open which part of the admin area.
 *
 * `admin` opens all of it. `community_manager` (a member who is a semi-volunteer, paid in comps)
 * opens only the read-only pages below. Anything not listed here is admin-only, so a new admin page
 * is closed to a community manager until someone adds it on purpose.
 *
 * This module is plain (no server imports), so the proxy can use it for its optimistic pre-filter.
 * The secure check is `requireStaffPage()` in each page (lib/admin-auth.ts); the data itself is
 * guarded by RLS (`is_community_manager()` policies), not by this list.
 */
export const COMMUNITY_MANAGER_ROLE = "community_manager";

/** Where a community manager lands when they open the admin area. */
export const COMMUNITY_MANAGER_HOME = "/admin/at-risk";

/** Pages a community manager opens, exactly. */
const EXACT_PATHS = [
  "/admin", // redirects to COMMUNITY_MANAGER_HOME
  "/admin/at-risk",
  "/admin/stats",
  "/admin/calendar",
  "/admin/members",
  "/admin/insights/slack-engagement",
  "/admin/insights/resubscriptions",
] as const;

/**
 * Pages under a prefix, one level or more: a member's profile and its tabs, a prickle's page.
 * A tool that lives beside them (`/admin/members/network`) is not included, nor is a member's
 * Identity tab (emails, aliases, legal name) or Activity Log tab (audit entries): those stay admin-only.
 */
const PREFIX_PATHS = [
  { prefix: "/admin/members/", except: ["/admin/members/network"] },
  { prefix: "/admin/prickles/", except: [] as string[] },
] as const;

export function isCommunityManagerPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((EXACT_PATHS as readonly string[]).includes(path)) return true;
  if (/^\/admin\/members\/[^/]+\/(identity|activity)$/.test(path)) return false;
  return PREFIX_PATHS.some(
    ({ prefix, except }) =>
      path.startsWith(prefix) && path.length > prefix.length && !except.some((e) => path === e || path.startsWith(`${e}/`))
  );
}

/**
 * Whether a signed-in user with this role may open the admin path. Optimistic: `role` may come from
 * the access token's `app_role` claim, up to an hour old. A missing or unknown role is "no".
 */
export function mayOpenAdminPath(role: string | null | undefined, pathname: string): boolean {
  if (role === "admin") return true;
  if (role === COMMUNITY_MANAGER_ROLE) return isCommunityManagerPath(pathname);
  return false;
}
