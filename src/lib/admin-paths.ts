import { can, hasAdminLikeRole, staffRolesIn, type Permission, type RoleInput } from "@/lib/permissions";

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

/**
 * The permission each admin page needs, first match wins. This is what the proxy (optimistic, from the
 * token's role) and the sidebar (`navGroups`) use; each page's own `requirePermission(...)` is the secure
 * check, and `tests/lib/permission-guards.test.ts` fails when a page's guard and this table disagree.
 * A path that matches nothing is open only to the admin-like roles (the admin and the assistant),
 * so a new page is closed to the other roles until someone lists it here on purpose.
 */
const ADMIN_PAGE_PERMISSIONS: ReadonlyArray<readonly [RegExp, Permission]> = [
  [/^\/admin$/, "staff.access"],
  [/^\/admin\/activity(\/|$)/, "activity.read"],
  [/^\/admin\/(analytics|wheel-of-wonder)(\/|$)/, "analytics.usage.read"],
  [/^\/admin\/at-risk(\/|$)/, "members.at_risk.read"],
  [/^\/admin\/badges(\/|$)/, "badges.manage"],
  [/^\/admin\/calendar(\/|$)/, "calendar.read"],
  [/^\/admin\/care(\/|$)/, "care.read"],
  [/^\/admin\/changelog(\/|$)/, "changelog.read"],
  [/^\/admin\/(compliance|security|privacy)(\/|$)/, "system.compliance.read"],
  [/^\/admin\/courses(\/|$)/, "courses.manage"],
  [/^\/admin\/data-health\/missing-hosts(\/|$)/, "prickles.manage"],
  [/^\/admin\/data-health(\/|$)/, "data.hygiene.manage"],
  [/^\/admin\/data\/import(\/|$)/, "data.pipeline.run"],
  [/^\/admin\/data\/prickle-types(\/|$)/, "prickles.manage"],
  [/^\/admin\/data\/(aliases|slack-channels)(\/|$)/, "data.hygiene.manage"],
  [/^\/admin\/events(\/|$)/, "events.manage"],
  [/^\/admin\/feedback(\/|$)/, "system.feedback.manage"],
  [/^\/admin\/(finishers|hedgieversaries|work-queue)(\/|$)/, "community.manage"],
  [/^\/admin\/hosts(\/|$)/, "prickles.manage"],
  [/^\/admin\/hygiene(\/|$)/, "data.hygiene.manage"],
  [/^\/admin\/insights\/prickles(\/|$)/, "analytics.prickles.read"],
  [/^\/admin\/insights\/resubscriptions(\/|$)/, "analytics.resubscriptions.read"],
  [/^\/admin\/insights\/slack-engagement(\/|$)/, "analytics.engagement.read"],
  [/^\/admin\/media(\/|$)/, "media.manage"],
  [/^\/admin\/member-overrides(\/|$)/, "members.overrides.manage"],
  [/^\/admin\/members\/network(\/|$)/, "members.network.read"],
  [/^\/admin\/members\/[^/]+\/(account|identity|notifications)$/, "member.account_tab"],
  [/^\/admin\/members\/[^/]+\/transactions$/, "member.transactions_tab"],
  [/^\/admin\/members(\/|$)/, "members.read"],
  [/^\/admin\/mentorship(\/|$)/, "mentorship.manage"],
  [/^\/admin\/(notifications|player-spike)(\/|$)/, "system.dev_tools.use"],
  [/^\/admin\/offers(\/|$)/, "offers.manage"],
  [/^\/admin\/outreach(\/|$)/, "outreach.manage"],
  [/^\/admin\/pages\/(design|new)$/, "pages.edit"],
  [/^\/admin\/pages\/(templates|landing)$/, "pages.read"],
  [/^\/admin\/pages\/[^/]+\/preview$/, "pages.read"],
  [/^\/admin\/pages\/[^/]+$/, "pages.edit"],
  [/^\/admin\/pages$/, "pages.read"],
  [/^\/admin\/(previews|segments)(\/|$)/, "system.previews.manage"],
  [/^\/admin\/prickle-join(\/|$)/, "prickles.manage"],
  [/^\/admin\/prickles\/[^/]+/, "prickles.read"],
  [/^\/admin\/programs(\/|$)/, "programs.manage"],
  [/^\/admin\/roles(\/|$)/, "roles.read"],
  [/^\/admin\/search(\/|$)/, "system.search.use"],
  [/^\/admin\/stats(\/|$)/, "analytics.community.read"],
  [/^\/admin\/users(\/|$)/, "system.users.manage"],
];

/** The permission an admin page needs, or undefined for a page nobody has listed (admin and assistant only). */
export function permissionForAdminPath(pathname: string): Permission | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ADMIN_PAGE_PERMISSIONS.find(([pattern]) => pattern.test(path))?.[1];
}

/**
 * Whether a signed-in user holding these roles (one, or several: the union decides) may open the admin path.
 * Optimistic: the roles may come from the access token's `app_roles` claim, up to an hour old. No staff role is "no".
 */
export function mayOpenAdminPath(roles: RoleInput, pathname: string): boolean {
  if (staffRolesIn(roles).length === 0) return false;
  const needed = permissionForAdminPath(pathname);
  return needed ? can({ roles: staffRolesIn(roles) }, needed) : hasAdminLikeRole(roles);
}
