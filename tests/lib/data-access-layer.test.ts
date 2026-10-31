import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
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
  // Instagram prospects (ProspectRepository).
  outreach_prospects: [],
  // Writing (WritingRepository): the dashboard, onboarding, check-in, Slack quick log and CSV export are
  // moved, and so are project, goal and entry editing and the Trackbear import.
  writing_projects: [],
  writing_project_starting_balances: [],
  writing_goals: [],
  writing_progress_entries: [],
  // Events (EventRepository): every query on the three event tables is moved.
  community_events: [],
  event_attendees: [],
  event_photos: [],
  // The event schedule view and the Hub-made events' schedules (EventRepository, HubSessionRepository).
  community_event_details: [],
  hub_sessions: [],
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
  // The Bronze Slack workspace and messages (SlackWorkspaceRepository, SlackMessageRepository): every query is moved.
  slack_channels: [],
  slack_messages: [],
  slack_messages_meta: [],
  slack_reactions: [],
  slack_files: [],
  slack_custom_emoji: [],
  slack_channel_members: [],
  slack_channel_member_events: [],
  ignored_slack_users: [],
  restricted_slack_channels: [],
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
  // Billing (BillingRepository, lib/data/billing.ts): the Bronze Kajabi and Stripe data, reads and the imports' writes. Every query is moved.
  kajabi_contacts: [],
  kajabi_customers: [],
  kajabi_purchases: [],
  kajabi_offers: [],
  kajabi_members: [],
  stripe_customers: [],
  stripe_products: [],
  stripe_subscriptions: [],
  subscription_history: [],
  // Hiatus, status overrides, join-date corrections and the member-edited profile fields (MemberStatusRepository): every query is moved.
  member_hiatus_history: [],
  member_status_overrides: [],
  member_join_date_overrides: [],
  member_profile_overrides: [],
  // Members' bookshelves (BookRepository, lib/data/books.ts): every query is moved (lib/data/media.ts reads it for the library's usage list, inside lib/data/).
  member_books: [],
  // Commitments, check-ins and the dismissed check-in/check-out offers (PrickleActivityRepository, lib/data/prickle-activity.ts): every query is moved.
  // CalendarFeedRepository and CalendarSyncStateRepository: every query is moved.
  calendar_feed_tokens: [],
  calendar_feed_items: [],
  calendar_sync_state: [],
  prickle_commitments: [],
  prickle_commitment_slots: [],
  prickle_checkins: [],
  prickle_checkin_dismissals: [],
  prickle_checkout_dismissals: [],
  // Courses (CourseRepository, lib/data/courses.ts: the Silver curriculum and the Mux videos; CourseProgressRepository,
  // lib/data/course-progress.ts: lesson progress, access, staff grants and watch segments): every query is moved.
  courses: [],
  course_modules: [],
  course_lessons: [],
  course_lesson_files: [],
  videos: [],
  lesson_progress: [],
  course_access: [],
  course_access_grants: [],
  video_watch_segments: [],
  // Segments (SegmentRepository), feature flags and user previews (FeatureFlagRepository), Slack sign-in
  // bindings and credentials (SlackSignInRepository), usage events (AnalyticsEventRepository) and the
  // Google Calendar push channels (CalendarSyncStateRepository): every query is moved.
  segments: [],
  segment_members: [],
  feature_flags: [],
  feature_flag_segments: [],
  user_feature_previews: [],
  slack_identities: [],
  slack_sign_in_tokens: [],
  analytics_events: [],
  calendar_watch_channels: [],
};

/**
 * Tables still queried directly outside lib/data/ (no repository yet). The census below fails on a direct
 * query of a table that is neither registered above nor listed here, so a new table can't slip in without
 * a repository, and fails on a stale entry here, so the list only shrinks. When a table gets a repository,
 * move it from here to REPOSITORY_TABLES.
 */
const UNMIGRATED_TABLES = new Set([
  "access_events",
  "admin_work_queue_completions",
  "ambiguous_zoom_names",
  "analytics_events",
  "big_sister_volunteers",
  "calendar_watch_channels",
  "dismissed_duplicate_groups",
  "feature_flag_segments",
  "feature_flags",
  "feedback",
  "ignored_zoom_appearances",
  "member_ask_me_about",
  "member_awards",
  "member_engagement",
  "member_metrics",
  "member_notes",
  "member_onboarding",
  "member_roster_opt_outs",
  "member_slack_connections",
  "mentorships",
  "outreach_leads",
  "outreach_touches",
  "prickle_checkin_dm_log",
  "prickle_host_vibes",
  "prickle_join_settings",
  "prickle_schedule_locks",
  "segment_members",
  "segments",
  "slack_identities",
  "slack_sign_in_tokens",
  "staff",
  "user_feature_previews",
  "wheel_of_wonder_matches",
  "zoom_participant_events",
]);

/**
 * Files that build a query on a table named by a variable (`.from(table)`), which no text search of table
 * names can see. Each needs a reason; the census fails on a new one and on a stale entry.
 */
const VARIABLE_TABLE_FILES: Record<string, string> = {
  "lib/supabase/bronze-pagination.ts": "the generic Bronze pager; callers are caught by the helper-call check below",
  "app/(admin)/admin/hedgieversaries/page.tsx": "local paging helper; moves with the leftovers repository",
  "app/(admin)/admin/outreach/page.tsx": "local paging helper; moves with the outreach repository",
  "app/(admin)/admin/work-queue/page.tsx": "local paging helper; moves with the work-queue repository",
  "lib/host-vibes.ts": "reads one of two tables chosen by a variable; moves with the leftovers repository",
  "lib/slack-sign-in.ts": "looks up in one of two tables chosen by a variable; moves with the Slack sign-in repository",
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
  // The table name handed to a paginating helper that runs .from(table) inside it.
  const viaHelper = new RegExp(`\\b(?:fetchAllBronzeRows|fetchAllPublicRows|fetchAll|upsertInBatches)\\(\\s*[^,()]+,\\s*["'\`]${table}["'\`]`);
  return files
    .filter((file) => {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      return direct.test(source) || viaHelper.test(source);
    })
    .sort();
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

/**
 * Every `.from(x)` call outside lib/data/, found by parsing the source (a text search misses a table named by a
 * variable). File storage (`.storage.from(bucket)`, a bucket constant or a hyphenated name) and `Array.from` /
 * `Buffer.from` are not queries.
 */
function directFromCalls() {
  const tables = new Map<string, Set<string>>();
  const variable = new Set<string>();
  const notQueries = new Set(["Array", "Buffer", "Uint8Array", "Int8Array", "Object", "Promise", "String", "Map", "Set"]);
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "from" && node.arguments.length === 1) {
        const receiver = node.expression.expression;
        const storage = ts.isPropertyAccessExpression(receiver) && receiver.name.text === "storage";
        const builtin = ts.isIdentifier(receiver) && notQueries.has(receiver.text);
        const arg = node.arguments[0];
        if (!storage && !builtin) {
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            if (/^[a-z][a-z0-9_]*$/.test(arg.text)) tables.set(arg.text, (tables.get(arg.text) ?? new Set()).add(file));
          } else if (!/BUCKET/.test(arg.getText())) {
            variable.add(file);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { tables, variable };
}

describe("data access layer census", () => {
  const { tables, variable } = directFromCalls();
  const registered = new Set(Object.keys(REPOSITORY_TABLES));

  it("no table is queried directly unless it is registered or listed as not yet migrated", () => {
    const unknown = [...tables.keys()].filter((t) => !registered.has(t) && !UNMIGRATED_TABLES.has(t)).sort();
    expect(unknown, "add a repository in lib/data/ for these tables (and register them in REPOSITORY_TABLES)").toEqual([]);
  });

  it("UNMIGRATED_TABLES lists only tables that are still queried directly", () => {
    const stale = [...UNMIGRATED_TABLES].filter((t) => !tables.has(t)).sort();
    expect(stale, "no longer queried directly: remove from UNMIGRATED_TABLES").toEqual([]);
    expect([...UNMIGRATED_TABLES].filter((t) => registered.has(t)), "registered tables don't belong in UNMIGRATED_TABLES").toEqual([]);
  });

  it("a query on a table named by a variable is only in a listed file", () => {
    expect([...variable].filter((f) => !(f in VARIABLE_TABLE_FILES)).sort(), "name the table with a literal inside a repository").toEqual([]);
    expect(Object.keys(VARIABLE_TABLE_FILES).filter((f) => !variable.has(f)), "no longer builds a variable-table query: remove from VARIABLE_TABLE_FILES").toEqual([]);
  });
});
