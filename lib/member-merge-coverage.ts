/**
 * What a member merge (`app/api/admin/members/merge/route.ts`) does with every table that references
 * `members`. The merge deletes the duplicate and nearly every such table cascades on delete, so whatever the
 * merge does not move goes with it. The merge dialog shows the duplicate's rows by this classification, and
 * `tests/lib/member-merge-coverage.test.ts` fails when a table that references `members` is not listed, so
 * the dialog and the guard cannot drift.
 *
 * NOT_MOVED is the known gap, an allowlist that only shrinks: move the table in the merge, then delete its
 * line (docs/TODO.md, "Member merge drops most of a member's data").
 */

/** Moved to the member that is kept (skipping what the kept member already has). */
export const MOVED = [
  "ambiguous_zoom_names",
  "big_sister_volunteers",
  "event_attendees",
  "member_activities",
  "member_badges",
  "member_email_aliases",
  "member_hiatus_history",
  "member_name_aliases",
  "member_program_enrollments",
  "member_status_overrides",
  "mentorships",
  "prickle_attendance",
  "prickle_schedules",
  "prickle_types",
  "prickles",
] as const;

/** Rebuilt by processing, or keyed by the member's own id: nothing to move. */
export const DERIVED = ["member_directory", "member_engagement", "member_metrics"] as const;

/** Not moved today: the duplicate's rows go with it. */
export const NOT_MOVED = [
  "admin_work_queue_completions",
  "calendar_feed_items",
  "calendar_feed_tokens",
  "chat_channel_members",
  "chat_drafts",
  "chat_messages",
  "chat_reactions",
  "chat_slack_authors",
  "conversations",
  "course_access",
  "course_access_grants",
  "feedback",
  "hub_sessions",
  "in_app_notifications",
  "lesson_progress",
  "media_assets",
  "member_admin_notes",
  "member_ask_me_about",
  "member_awards",
  "member_books",
  "member_interactions",
  "member_join_date_overrides",
  "member_notes",
  "member_onboarding",
  "member_profile_overrides",
  "member_reminder_log",
  "member_roster_opt_outs",
  "member_slack_connections",
  "notification_log",
  "notification_preferences",
  "outreach_leads",
  "outreach_touches",
  "prickle_checkin_dismissals",
  "prickle_checkin_dm_log",
  "prickle_checkins",
  "prickle_checkout_dismissals",
  "prickle_commitments",
  "prickle_host_vibes",
  "push_subscriptions",
  "segment_members",
  "staff",
  "unmatched_calendar_events",
  "video_watch_segments",
  "wheel_of_wonder_matches",
  "writing_goals",
  "writing_progress_entries",
  "writing_project_starting_balances",
  "writing_projects",
] as const;

/** What the merge does with a table's rows. */
export type MergeFate = "moved" | "derived" | "lost";

/** Short names for the dialog; a table without one shows its own name. */
export const MERGE_TABLE_LABELS: Record<string, string> = {
  admin_work_queue_completions: "Admin work queue completions",
  ambiguous_zoom_names: "Ambiguous Zoom names",
  big_sister_volunteers: "Big Sister volunteer record",
  calendar_feed_items: "Calendar feed items",
  calendar_feed_tokens: "Calendar feed link",
  chat_channel_members: "Chat conversations",
  chat_drafts: "Chat drafts",
  chat_messages: "Chat messages",
  chat_reactions: "Chat reactions",
  chat_slack_authors: "Chat Slack author links",
  conversations: "Conversations",
  course_access: "Course access",
  course_access_grants: "Course access grants",
  event_attendees: "Event attendances",
  feedback: "Feedback",
  hub_sessions: "Hub sessions",
  in_app_notifications: "Notifications",
  lesson_progress: "Lesson progress",
  media_assets: "Media library images",
  member_activities: "Activity records",
  member_admin_notes: "Admin notes",
  member_ask_me_about: "Ask me about topics",
  member_awards: "Awards",
  member_badges: "Badges",
  member_books: "Books",
  member_email_aliases: "Email aliases",
  member_hiatus_history: "Hiatuses",
  member_interactions: "Member interactions",
  member_join_date_overrides: "Join date overrides",
  member_name_aliases: "Name aliases",
  member_notes: "Private notes",
  member_onboarding: "Getting started progress",
  member_profile_overrides: "Profile overrides",
  member_program_enrollments: "Program enrollments",
  member_reminder_log: "Reminders sent",
  member_roster_opt_outs: "Roster opt-outs",
  member_slack_connections: "Slack connection",
  member_status_overrides: "Status overrides",
  mentorships: "Big Sister matches",
  notification_log: "Notification log",
  notification_preferences: "Notification settings",
  outreach_leads: "Outreach leads",
  outreach_touches: "Outreach touches",
  prickle_attendance: "Prickle attendance",
  prickle_checkin_dismissals: "Dismissed check-ins",
  prickle_checkin_dm_log: "Check-in messages sent",
  prickle_checkins: "Prickle check-ins",
  prickle_checkout_dismissals: "Dismissed check-outs",
  prickle_commitments: "Prickle commitments",
  prickle_host_vibes: "Host vibe tags",
  prickle_schedules: "Hosted weekly prickles",
  prickle_types: "Prickle types hosted by default",
  prickles: "Hosted prickles",
  push_subscriptions: "Browser notification subscriptions",
  segment_members: "Segment memberships",
  staff: "Staff record",
  unmatched_calendar_events: "Unmatched calendar events",
  video_watch_segments: "Video watch history",
  wheel_of_wonder_matches: "Wheel of Wonder matches",
  writing_goals: "Writing goals",
  writing_progress_entries: "Writing progress entries",
  writing_project_starting_balances: "Writing starting balances",
  writing_projects: "Writing projects",
};

/** What the merge does with a table's rows; a table nobody classified is reported as lost, the safe reading. */
export function mergeFate(table: string): MergeFate {
  if ((MOVED as readonly string[]).includes(table)) return "moved";
  if ((DERIVED as readonly string[]).includes(table)) return "derived";
  return "lost";
}

export function mergeTableLabel(table: string): string {
  return MERGE_TABLE_LABELS[table] ?? table;
}

/** One line of the dialog: a table's rows for the duplicate and what the merge does with them. */
export type OwnedDataEntry = { table: string; label: string; count: number; fate: MergeFate };

/**
 * The duplicate's rows as the dialog lists them: the derived stats dropped (they are rebuilt), several columns of
 * one table added together, lost rows first, then by label.
 */
export function describeOwnedRows(counts: { table: string; count: number }[]): OwnedDataEntry[] {
  const byTable = new Map<string, number>();
  for (const c of counts) byTable.set(c.table, (byTable.get(c.table) ?? 0) + c.count);
  const rank: Record<MergeFate, number> = { lost: 0, moved: 1, derived: 2 };
  return [...byTable]
    .map(([table, count]) => ({ table, label: mergeTableLabel(table), count, fate: mergeFate(table) }))
    .filter((e) => e.count > 0 && e.fate !== "derived")
    .sort((a, b) => rank[a.fate] - rank[b.fate] || a.label.localeCompare(b.label));
}
