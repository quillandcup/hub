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
  // Aliases: every name and email alias query is on AliasRepository.
  member_name_aliases: [],
  member_email_aliases: [],
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
