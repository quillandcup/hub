/**
 * What a signed-in person may do in the staff area: permissions are operations defined here in code,
 * roles are named bundles of them, and every check goes through `can(actor, permission)`
 * (`requirePermission*` in src/lib/admin-auth.ts and src/lib/supabase/api-auth.ts call it).
 * Architecture notes: docs/architecture/PERMISSIONS.md.
 *
 * This module is plain (no server imports), so the proxy, the sidebar and client components can use it.
 * It is the application-level gate; the data itself is guarded by RLS (`is_admin()`,
 * `is_community_manager()`, `is_conversion_specialist()`), which a permission here never replaces.
 *
 * A permission is named `<area>.<action>` (or `<area>.<thing>.<action>`). A new one is an entry in
 * `PERMISSIONS`, a guard that uses it, and a decision about each role below; `tests/lib/permissions.test.ts`
 * and `tests/lib/permission-guards.test.ts` fail until all three agree.
 */
export const PERMISSIONS = {
  // Getting in
  "staff.access": "Open the staff area at all (every staff role has it)",
  "dashboard.read": "The admin dashboard",
  "activity.read": "The Activity Log (audit entries, page visits)",
  "changelog.read": "The engineering and staff Changelog pages",
  "changelog.edit": "Edit changelog entries (they are edited in code today; reserved)",

  // Members
  "members.read": "The member list and a member's page (profile, attendance, Slack)",
  "members.write": "Change a member's record, hiatus or external status; move aliases",
  "members.network.read": "The member network graph",
  "members.overrides.manage": "Member overrides (comped access and similar)",
  "members.at_risk.read": "The At-Risk Members list",
  "members.bulk_merge": "Bulk merge from the member list",
  "member.sudo": "Act as a member (sudo)",
  "member.merge": "Merge two member records",
  "member.split": "Split a member record",
  "member.remove": "Remove a member and their data",
  "member.notes_write": "Write staff notes on a member",
  "member.timeline_edit": "Edit a member's membership timeline",
  "member.badges_edit": "Award or remove a member's badges",
  "member.account_tab": "A member's Account and Notifications tabs (emails, devices)",
  "member.activity_tab": "A member's full Activity tab (audit entries, page visits, staff notes)",
  "member.activity_tab_limited": "A member's Activity tab with only the member's own activity",
  "member.billing_links": "Billing links on a member's page",
  "member.record_history": "The record history of any entity",
  "member.push_devices": "A member's push devices",
  "member.status_overrides": "A member's status overrides",
  "member.alias_admin": "Administer a member's aliases",

  // Prickles and Hedgie Care
  "calendar.read": "The Calendar View",
  "prickles.read": "A prickle's page",
  "prickles.manage": "Prickle schedules, types, hosts, Zoom links and their data fixes",
  "prickle.edit": "Edit a prickle",
  "prickle.show_in_events": "Show a prickle in events",
  "prickle.test_dms": "Send a prickle's test DMs",
  "prickle.ignore_names": "Ignore names on a prickle's attendance",
  "prickle.alias_form": "The alias form on a prickle's attendance",
  "prickle.insights_link": "The insights link on a prickle",
  "care.read": "Hedgie Care (read)",
  "care.write": "Hedgie Care reach-outs (write)",
  "care.takeover": "Take a care plan from its owner without their agreement",
  "care.member_activity.read": "In Hedgie Care, read the text of a member's tracked DMs and what they did during a plan",

  // Education and community programs
  "courses.manage": "Courses, lessons, media, comments and rosters",
  "programs.manage": "Programs, cohorts and enrolments",
  "mentorship.manage": "Big Sisters (mentorship) administration",
  "badges.manage": "Badge types and recipients",
  "events.manage": "Events, photos and offers",
  "community.manage": "Finishers, Hedgieversaries and the Work Queue",
  "media.read": "Browse the shared media library",
  "media.manage": "Upload, edit and remove shared media",

  // Sales and marketing
  "pages.read": "See landing pages, their previews and templates",
  "pages.edit": "Create and edit landing pages, templates and the site header and footer",
  "pages.publish": "Publish and unpublish landing pages and the site header and footer",
  "pages.delete": "Delete landing pages",
  "outreach.manage": "Outreach to leads and prospects",
  "offers.manage": "Kajabi offer mapping",
  "email.send": "Send email to members or leads (no surface yet; reserved)",
  "email.schedule": "Schedule email (no surface yet; reserved)",
  "announcements.manage": "Manage announcements (no surface yet; reserved)",

  // Analytics
  "analytics.usage.read": "Feature usage, the explorer and the Wheel of Wonder",
  "analytics.community.read": "Community Stats",
  "analytics.engagement.read": "Slack Engagement",
  "analytics.resubscriptions.read": "Resubscriptions (names members)",
  "analytics.prickles.read": "Prickle Insights",
  "analytics.cohorts.read": "Conversion and retention cohorts in aggregate or de-identified form (no surface yet; reserved)",

  // Data and system
  "data.export": "Download or export data (no admin surface yet; reserved)",
  "data.pipeline.run": "Imports, processing, reconciliation and the analyses",
  "data.hygiene.manage": "Data health and hygiene tools, aliases and restricted Slack channels",
  "system.users.manage": "Users and their roles",
  "system.compliance.read": "The Security, Privacy and Compliance staff pages",
  "system.previews.manage": "Feature previews, flags and segments",
  "system.feedback.manage": "Member feedback",
  "system.integrations.manage": "Connect Google and Slack",
  "system.dev_tools.use": "Test notifications and developer spikes",
  "system.search.use": "The admin search",
  "system.internal.run": "Internal jobs (digest, CSP health, notifications)",
  "roles.read": "The Roles page: every permission and which role holds it",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Permissions that exist ahead of any page, action or route that checks them (the surface isn't built yet),
 * so a role can already be granted or denied them. Shrinks as each surface ships: when one does, the guard
 * that uses it takes it off this list (`tests/lib/permission-guards.test.ts` fails on a stale entry).
 */
export const RESERVED_PERMISSIONS: readonly Permission[] = [
  "changelog.edit",
  "email.send",
  "email.schedule",
  "announcements.manage",
  "analytics.cohorts.read",
  "data.export",
];

export const ADMIN_ROLE = "admin";
export const ASSISTANT_ROLE = "assistant";
export const COMMUNITY_MANAGER_ROLE = "community_manager";
export const CONVERSION_SPECIALIST_ROLE = "conversion_specialist";

/** Every role that opens the staff area. (`member`, the default, is not one.) */
export const STAFF_ROLES = [ADMIN_ROLE, ASSISTANT_ROLE, COMMUNITY_MANAGER_ROLE, CONVERSION_SPECIALIST_ROLE] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** What each role is called on screen (the Users page, the preview banner and picker). */
export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  assistant: "Assistant",
  community_manager: "Community Manager",
  conversion_specialist: "Conversion Specialist",
};

/** What each role is for, in a plain sentence (the Roles page). */
export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  admin: "Runs the Hub: holds every permission, including the ones added later.",
  assistant: "Works beside the admin with the same access, except what the privacy page promises an assistant never sees.",
  community_manager: "A semi-volunteer who looks after members: reads the member side and works in Hedgie Care.",
  conversion_specialist: "Marketing: builds and publishes landing pages and runs outreach, with no view of members.",
};

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role ?? "");
}

/** The roles that open the whole staff area, listed or not: everything not listed here is closed to them by default. */
export const ADMIN_LIKE_ROLES = [ADMIN_ROLE, ASSISTANT_ROLE] as const;

/** The admin's set: everything. */
const ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

/**
 * What the assistant does not hold although it otherwise mirrors the admin. Hedgie Care shows the text of a member's tracked
 * DMs and their activity only to admins and community managers (the privacy page says so: "never an assistant"), so
 * until that promise is changed on purpose the assistant is kept out of them.
 */
export const ASSISTANT_WITHHELD: readonly Permission[] = ["care.member_activity.read"];

/** Why each withheld permission is withheld (the Roles page shows it); every entry of `ASSISTANT_WITHHELD` needs one. */
export const ASSISTANT_WITHHELD_REASONS: Partial<Record<Permission, string>> = {
  "care.member_activity.read": "The privacy page promises that the text of tracked DMs and activity in Hedgie Care is seen by admins and community managers, never an assistant.",
};

/**
 * Each role's bundle. Opt-in is the rule: a new permission is in no bundle but the admin's until someone
 * adds it to another on purpose. Read-only staff roles hold no write permission unless it is listed.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  admin: ADMIN_PERMISSIONS,
  // Derived from the admin's set, so the two stay in lockstep until they are told apart on purpose (ASSISTANT_WITHHELD).
  assistant: ADMIN_PERMISSIONS.filter((permission) => !ASSISTANT_WITHHELD.includes(permission)),
  // A semi-volunteer: reads part of the member side, and writes in Hedgie Care. Exactly what the role could do before this registry.
  community_manager: [
    "staff.access",
    "calendar.read",
    "members.read",
    "members.at_risk.read",
    "prickles.read",
    "care.read",
    "care.write",
    "care.member_activity.read",
    "analytics.community.read",
    "analytics.engagement.read",
    "analytics.resubscriptions.read",
    // The Activity tab with only the member's own activity (get_activity_feed enforces it in the database).
    "member.activity_tab_limited",
  ],
  // Marketing: landing pages, outreach, email and announcements, and conversion and retention numbers in aggregate.
  // No members area (list, pages, notes, contact data, merges, overrides, sudo), no changelog, no data export.
  conversion_specialist: [
    "staff.access",
    "pages.read",
    "pages.edit",
    "pages.publish",
    "outreach.manage",
    "media.read",
    "email.send",
    "email.schedule",
    "announcements.manage",
    "analytics.cohorts.read",
  ],
};

/**
 * Anyone with roles (a signed-in staff member, a `StaffUser`, an action's `auth`): what they may do is the union of the
 * roles they hold. A guard's result also carries `role`, the primary one, for display and routing; it is not read here.
 */
export type Actor = { roles?: readonly (string | null | undefined)[] | null } | null | undefined;

/** A set of roles as callers have it: one role, a list, or nothing. */
export type RoleInput = string | readonly (string | null | undefined)[] | null | undefined;

/**
 * The staff roles in a set of roles, deduplicated, highest priority first. Priority is the order of `STAFF_ROLES`
 * (admin, assistant, community manager, conversion specialist), the same order `staff_role_rank()` has in SQL, so the
 * first one is the primary role (where a person lands, what is shown first). Anything else (`member`, unknown values) is dropped.
 */
export function staffRolesIn(input: RoleInput): StaffRole[] {
  const list = typeof input === "string" ? [input] : (input ?? []);
  return STAFF_ROLES.filter((role) => list.includes(role));
}

/** The staff roles an actor holds, by priority. */
export function rolesOf(actor: Actor): StaffRole[] {
  return staffRolesIn(actor?.roles);
}

/** The highest-priority staff role in the set, or null when there is none. */
export function primaryRole(input: RoleInput): StaffRole | null {
  return staffRolesIn(input)[0] ?? null;
}

/** Whether any of the actor's roles holds the permission (the union). An unknown role, a member or nobody holds none. */
export function can(actor: Actor, permission: Permission): boolean {
  return rolesOf(actor).some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/** Whether any of these roles opens the whole staff area, unlisted pages included (the admin and the assistant). */
export function hasAdminLikeRole(input: RoleInput): boolean {
  return staffRolesIn(input).some((role) => (ADMIN_LIKE_ROLES as readonly string[]).includes(role));
}

/** Where a person lands when they open the admin area, and where they are sent from a page they may not open while previewing: their primary role's home. */
export function staffHome(input: RoleInput): string {
  const role = primaryRole(input);
  if (role === COMMUNITY_MANAGER_ROLE) return "/admin/at-risk";
  if (role === CONVERSION_SPECIALIST_ROLE) return "/admin/pages";
  return "/admin";
}

/**
 * Who may change whose roles. An actor gives or takes away only roles strictly BELOW their own highest role, and only on people
 * strictly below it; an admin may manage any. Nobody removes their own admin role, and the last admin stays. The database enforces
 * the same rules (`enforce_user_role_changes()` on `user_roles`, which is the authority); this is the one copy in code, for the
 * Users page (to disable what the actor can't do) and the route (for a clear refusal before the call).
 */
export const ROLE_CHANGE_REFUSALS = {
  notManager: "Only admins and assistants can change roles.",
  assistantOnAdmin: "An assistant can't change the roles of an admin or another assistant.",
  assistantRoles: "An assistant can only give or take away the community manager and conversion specialist roles.",
  ownAdmin: "You can't remove your own admin role; ask another admin.",
  lastAdmin: "You can't remove the last admin.",
} as const;

export function roleChangeRefusal(input: {
  /** The roles the person making the change holds. */
  actor: RoleInput;
  /** The person's roles now, and the set they would hold. */
  target: RoleInput;
  next: RoleInput;
  /** Whether the person is changing their own roles. */
  self: boolean;
  /** How many admins there are besides the person whose roles change. */
  otherAdmins: number;
}): string | null {
  const actorRoles = staffRolesIn(input.actor);
  const actorRank = actorRoles.length ? STAFF_ROLES.indexOf(actorRoles[0]) + 1 : Infinity;
  const before = staffRolesIn(input.target);
  const after = staffRolesIn(input.next);
  const changed = STAFF_ROLES.filter((role) => before.includes(role) !== after.includes(role));
  if (changed.length === 0) return null;
  if (actorRank > STAFF_ROLES.indexOf(ASSISTANT_ROLE) + 1) return ROLE_CHANGE_REFUSALS.notManager;
  if (actorRank > 1) {
    const targetRank = before.length ? STAFF_ROLES.indexOf(before[0]) + 1 : Infinity;
    if (targetRank <= actorRank) return ROLE_CHANGE_REFUSALS.assistantOnAdmin;
    if (changed.some((role) => STAFF_ROLES.indexOf(role) + 1 <= actorRank)) return ROLE_CHANGE_REFUSALS.assistantRoles;
  }
  if (changed.includes(ADMIN_ROLE) && before.includes(ADMIN_ROLE)) {
    if (input.self) return ROLE_CHANGE_REFUSALS.ownAdmin;
    if (input.otherAdmins === 0) return ROLE_CHANGE_REFUSALS.lastAdmin;
  }
  return null;
}

/** The roles whose checkbox the actor may flip for this person (each tested alone), so the Users page disables the rest. */
export function changeableRoles(input: { actor: RoleInput; target: RoleInput; self: boolean; otherAdmins: number }): StaffRole[] {
  const held = staffRolesIn(input.target);
  return STAFF_ROLES.filter((role) => {
    const next = held.includes(role) ? held.filter((r) => r !== role) : [...held, role];
    return roleChangeRefusal({ ...input, next }) === null;
  });
}
