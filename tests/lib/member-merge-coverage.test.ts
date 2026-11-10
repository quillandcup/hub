import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A member merge (`app/api/admin/members/merge/route.ts`) deletes the duplicate, and nearly every
 * table that points at `members` cascades on delete: whatever the merge does not move goes with it.
 * A retreat attendance, its badge and three Big Sister matches were lost that way. So every table
 * that references `members` must be classified here, and a new one fails until someone decides.
 *
 * NOT_MOVED is the known gap, an allowlist that only shrinks: move the table in the merge, then
 * delete its line (docs/TODO.md, "Member merge drops most of a member's data").
 */

/** Moved to the member that is kept (skipping what the kept member already has). */
const MOVED = [
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
];

/** Rebuilt by processing, or keyed by the member's own id: nothing to move. */
const DERIVED = ["member_directory", "member_engagement", "member_metrics"];

/** Not moved today: the duplicate's rows go with it. */
const NOT_MOVED = [
  "admin_work_queue_completions",
  "calendar_feed_items",
  "calendar_feed_tokens",
  "chat_channel_members",
  "chat_drafts",
  "chat_messages",
  "chat_reactions",
  "chat_slack_authors",
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
];

/** The public tables whose generated type lists a foreign key to `members`. */
function tablesReferencingMembers(): string[] {
  const lines = readFileSync("lib/data/database.types.ts", "utf8").split("\n");
  const publicAt = lines.indexOf("  public: {");
  const start = lines.findIndex((l, i) => i > publicAt && l === "    Tables: {");
  const end = lines.findIndex((l, i) => i > start && l === "    Views: {");
  const found = new Set<string>();
  let table: string | null = null;
  for (const line of lines.slice(start + 1, end)) {
    const open = /^ {6}(\w+): \{$/.exec(line);
    if (open) table = open[1];
    if (table && line.includes('referencedRelation: "members"')) found.add(table);
  }
  return [...found].sort();
}

describe("member merge coverage", () => {
  it("classifies every table that references members", () => {
    const classified = [...MOVED, ...DERIVED, ...NOT_MOVED].sort();
    const referencing = tablesReferencingMembers();
    expect(referencing.filter((t) => !classified.includes(t)), "a new table references members: move it in the merge, or add it to NOT_MOVED with a TODO").toEqual([]);
    expect(classified.filter((t) => !referencing.includes(t)), "listed here but no longer references members: remove it").toEqual([]);
  });

  it("lists each table once", () => {
    const all = [...MOVED, ...DERIVED, ...NOT_MOVED];
    expect(all.filter((t, i) => all.indexOf(t) !== i)).toEqual([]);
  });
});
