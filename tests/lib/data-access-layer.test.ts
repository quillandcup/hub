import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tables with a repository in lib/data/ are queried only through it, so rules like "count distinct
 * prickles, not attendance records" and pagination live in one place and callers can be tested
 * with the in-memory twin. This fails on a direct `.from("<table>")` in app, lib or components
 * outside lib/data/.
 *
 * Allowlist: files not yet moved over. Move a file's queries into the repository and delete its
 * line; a stale entry (the file no longer queries the table directly) fails too, so the list only
 * shrinks. New files can't join it. Add a table here when its repository lands.
 */
const REPOSITORY_TABLES: Record<string, string[]> = {
  prickle_attendance: [],
  prickles: [
  ],
  // Prickle types (PrickleRepository): every query is moved.
  prickle_types: [],
  members: [
    "app/api/health/route.ts",
  ],
  in_app_notifications: [],
  notification_preferences: [],
  badge_types: [],
  badge_levels: [],
  member_badges: [],
  push_subscriptions: [],
  member_reminder_log: [],
  // Writing (WritingRepository): the dashboard, onboarding, check-in, Slack quick log and CSV export are
  // moved, and so are project, goal and entry editing and the Trackbear import.
  writing_projects: [],
  writing_project_starting_balances: [],
  writing_goals: [],
  writing_progress_entries: [],
  // Events (EventRepository): every query on the three event tables is moved.
  events: [],
  event_attendees: [],
  event_photos: [],
  // Media library (MediaRepository): every query is in the repository.
  media_assets: [],
  // Member activity log (ActivityRepository): every query is moved.
  member_activities: [],
  // Member directory (MemberDirectoryRepository): every query is moved.
  member_directory: [],
  // User profiles (ProfileRepository): every query is moved.
  user_profiles: [],
  // The Bronze calendar (CalendarEventRepository): every query is moved.
  calendar_events: [],
  // The Bronze Slack users (SlackUserRepository): every query is moved.
  slack_users: [],
  // The calendar review queue and admins' decisions (UnmatchedEventRepository): every query is moved.
  unmatched_calendar_events: [],
  // Bronze Zoom attendance and the ignored Zoom names (ZoomRepository): every query is moved.
  zoom_attendees: [],
  zoom_meetings: [],
  ignored_zoom_names: [],
  // Chat (ChatRepository, lib/data/chat.ts): only a channel's bridge settings and its Slack-id lookup are
  // moved so far; each slice removes its files from the lists below (see the chat plan in docs/TODO.md).
  chat_channels: [
  ],
  chat_channel_members: [],
  chat_messages: [],
  chat_message_contents: [],
  chat_reactions: [],
  chat_slack_authors: [],
  chat_gap_fills: [],
  // Aliases: every name and email alias query is on AliasRepository.
  member_name_aliases: [],
  member_email_aliases: [],
  // Hosting schedules (PrickleScheduleRepository): every query is moved.
  prickle_schedules: [],
  // Programs, their cohorts and enrollments (ProgramRepository): every query is moved.
  programs: [],
  program_cohorts: [],
  member_program_enrollments: [],
  // Kajabi course Bronze (KajabiCourseRepository): every query is moved.
  kajabi_courses: [],
  kajabi_course_modules: [],
  kajabi_course_lessons: [],
  kajabi_lesson_files: [],
  kajabi_course_offers: [],
  kajabi_product_progress: [],
  kajabi_lesson_progress: [],
};

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = ["app", "lib", "components"]
  .flatMap((dir) => sourceFiles(path.join(root, dir)))
  .map((file) => path.relative(root, file))
  .filter((file) => !file.startsWith("lib/data/"));

function filesQuerying(table: string): string[] {
  const direct = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`);
  return files.filter((file) => direct.test(fs.readFileSync(path.join(root, file), "utf8"))).sort();
}

describe("data access layer", () => {
  for (const [table, allowed] of Object.entries(REPOSITORY_TABLES)) {
    it(`${table} is queried through its repository (allowlist: ${allowed.length} files left to move)`, () => {
      const querying = filesQuerying(table);
      expect(querying.filter((file) => !allowed.includes(file)), "use the repository in lib/data/ instead of .from()").toEqual([]);
      expect(allowed.filter((file) => !querying.includes(file)), "no longer queries it directly: remove from the allowlist").toEqual([]);
    });
  }
});
