import { can, type Actor, type Permission } from "@/lib/permissions";

/**
 * Controls and views inside the pages a staff role opens, each its own permission (src/lib/permissions.ts).
 * An admin has every one; a community manager only those the registry lists for the role, so a new control
 * is hidden from them until it is granted on purpose. UI only: the server (`requireActionPermission`, RLS)
 * refuses what the role may not do whatever the page renders.
 *
 * `staffCan` and `staffFeaturesFor` are the same check as `can` over this subset, kept because pages and
 * components read "which controls does this role get" as a list.
 */
export const STAFF_FEATURES = [
  "member.sudo",
  "member.merge",
  "member.split",
  "member.remove",
  "member.notes_write",
  "member.timeline_edit",
  "member.badges_edit",
  "member.account_tab",
  "member.activity_tab",
  "member.activity_tab_limited",
  "member.billing_links",
  "member.transactions_tab",
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
  "care.member_activity.read",
] as const satisfies readonly Permission[];
export type StaffFeature = (typeof STAFF_FEATURES)[number];

/** The features this person has: the union over their roles (all for an admin or assistant, those in a bundle for another staff role), none otherwise. */
export function staffFeaturesFor(subject: Actor): readonly StaffFeature[] {
  return STAFF_FEATURES.filter((feature) => can(subject, feature));
}

export function staffCan(subject: Actor, feature: StaffFeature): boolean {
  return can(subject, feature);
}
