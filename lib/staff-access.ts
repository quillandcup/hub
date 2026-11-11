/**
 * Who may open which part of the admin area.
 *
 * `admin` opens all of it. `community_manager` (a member who is a semi-volunteer, paid in comps)
 * opens only the pages below, read-only except where a feature (`COMMUNITY_MANAGER_FEATURES`) lets her
 * write. Anything not listed here is admin-only, so a new admin page is closed to a community manager
 * until someone adds it on purpose.
 *
 * This module is plain (no server imports), so the proxy can use it for its optimistic pre-filter.
 * The secure check is `requireStaffPage()` in each page (lib/admin-auth.ts); the data itself is
 * guarded by RLS (`is_community_manager()` policies), not by this list.
 */
export const COMMUNITY_MANAGER_ROLE = "community_manager";

/**
 * Controls and views inside the pages a community manager opens, each opt-in. An admin has every
 * feature; a community manager has only those in `COMMUNITY_MANAGER_FEATURES`, which starts empty,
 * so a new control is hidden from them until a feature is added there on purpose. UI only: the
 * server (requireAdminAction, RLS) refuses what the role may not do whatever the page renders.
 */
export const STAFF_FEATURES = [
  "member.sudo",
  "member.merge",
  "member.split",
  "member.remove",
  "member.notes_write",
  "member.timeline_edit",
  "member.badges_edit",
  "member.identity_tab",
  "member.activity_tab",
  "member.billing_links",
  "member.record_history",
  "member.push_devices",
  "member.status_overrides",
  "member.alias_admin",
  "members.bulk_merge",
  "prickle.edit",
  "prickle.show_in_events",
  "prickle.test_dms",
  "prickle.ignore_names",
  "prickle.alias_form",
  "prickle.insights_link",
  "care.write",
] as const;
export type StaffFeature = (typeof STAFF_FEATURES)[number];

/** What a community manager may see or do beyond reading the page. Add a feature here to grant it. */
export const COMMUNITY_MANAGER_FEATURES: readonly StaffFeature[] = [
  // Hedgie Care, her reach-outs to members: she is the first staff role that writes (docs/HEDGIE_CARE.md).
  "care.write",
];

/** The features this role has: all for an admin, the list above for a community manager, none otherwise. */
export function staffFeaturesFor(role: string | null | undefined): readonly StaffFeature[] {
  if (role === "admin") return STAFF_FEATURES;
  if (role === COMMUNITY_MANAGER_ROLE) return COMMUNITY_MANAGER_FEATURES;
  return [];
}

export function staffCan(role: string | null | undefined, feature: StaffFeature): boolean {
  return staffFeaturesFor(role).includes(feature);
}

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
  "/admin/care", // Hedgie Care, the one place she writes (the `care.write` feature)
  "/admin/care/earlier",
] as const;

/**
 * Pages under a prefix, one level or more: a member's profile and its tabs, a prickle's page.
 * A tool that lives beside them (`/admin/members/network`) is not included, nor is a member's
 * Identity tab (emails, aliases, legal name), Activity Log tab (audit entries) or Notifications tab (devices, email): those stay admin-only.
 */
const PREFIX_PATHS = [
  { prefix: "/admin/members/", except: ["/admin/members/network"] },
  { prefix: "/admin/prickles/", except: [] as string[] },
] as const;

export function isCommunityManagerPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((EXACT_PATHS as readonly string[]).includes(path)) return true;
  if (/^\/admin\/members\/[^/]+\/(identity|activity|notifications)$/.test(path)) return false;
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
