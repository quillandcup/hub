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
    "app/(admin)/admin/calendar/page.tsx",
    "app/(admin)/admin/data-health/missing-hosts/MissingHostsClient.tsx",
    "app/(admin)/admin/hygiene/page.tsx",
    "app/(admin)/admin/insights/prickles/[kind]/page.tsx",
    "app/(admin)/admin/insights/prickles/page.tsx",
    "app/(admin)/admin/page.tsx",
    "app/(admin)/admin/prickles/[id]/actions.ts",
    "app/(admin)/admin/prickles/[id]/page.tsx",
    "app/(admin)/admin/stats/page.tsx",
    "app/(member)/hosting/actions.ts",
    "app/(member)/my-prickles/calendar-feed-actions.ts",
    "app/(member)/my-prickles/commitment-actions.ts",
    "app/(member)/prickle-picker/actions.ts",
    "app/(member)/prickles/[id]/page.tsx",
    "app/(member)/prickles/checkin-actions.ts",
    "app/api/admin/members/merge/route.ts",
    "app/api/internal/prickle-checkins/route.ts",
    "app/api/prickle-types/resolve-batch/route.ts",
    "app/api/prickle-types/resolve/route.ts",
    "app/api/process/attendance/route.ts",
    "app/api/zoom/prickles/route.ts",
    "lib/badges.ts",
    "lib/calendar-feed.ts",
    "lib/educational-prickles.ts",
    "lib/hosted-prickles.ts",
    "lib/live-room.ts",
    "lib/notification-test.ts",
    "lib/prickle-schedules.ts",
    "lib/search/universal.ts",
    "lib/upcoming-prickles.ts",
  ],
  members: [
    "app/(admin)/admin/activity/page.tsx",
    "app/(admin)/admin/at-risk/page.tsx",
    "app/(admin)/admin/data-health/missing-hosts/MissingHostsClient.tsx",
    "app/(admin)/admin/hygiene/ambiguous-names/page.tsx",
    "app/(admin)/admin/hygiene/external-conflicts/page.tsx",
    "app/(admin)/admin/hygiene/members-without-slack/page.tsx",
    "app/(admin)/admin/hygiene/merge-fix/page.tsx",
    "app/(admin)/admin/hygiene/missing-member-data/page.tsx",
    "app/(admin)/admin/hygiene/name-matching/page.tsx",
    "app/(admin)/admin/hygiene/page.tsx",
    "app/(admin)/admin/hygiene/unmatched-slack/page.tsx",
    "app/(admin)/admin/hygiene/unmatched-zoom/page.tsx",
    "app/(admin)/admin/insights/prickles/[kind]/page.tsx",
    "app/(admin)/admin/members/[id]/MemberDetailPage.tsx",
    "app/(admin)/admin/members/network/page.tsx",
    "app/(admin)/admin/mentorship/MentorshipPage.tsx",
    "app/(admin)/admin/page.tsx",
    "app/(admin)/admin/prickles/[id]/page.tsx",
    "app/(admin)/admin/segments/page.tsx",
    "app/(member)/big-sisters/actions.ts",
    "app/(member)/big-sisters/page.tsx",
    "app/(member)/chat/membership-actions.ts",
    "app/(member)/prickles/[id]/page.tsx",
    "app/(member)/settings/identityActions.ts",
    "app/(member)/settings/notificationActions.ts",
    "app/(member)/settings/profileActions.ts",
    "app/(member)/wheel-of-wonder/actions.ts",
    "app/actions/sudo.ts",
    "app/api/admin/aliases/[id]/route.ts",
    "app/api/admin/apply-aliases/route.ts",
    "app/api/admin/members/[id]/route.ts",
    "app/api/admin/members/external-status/route.ts",
    "app/api/admin/members/merge/route.ts",
    "app/api/admin/members/move-aliases/route.ts",
    "app/api/admin/members/split/route.ts",
    "app/api/admin/segments/[id]/invite/route.ts",
    "app/api/admin/segments/[id]/members/route.ts",
    "app/api/admin/segments/[id]/route.ts",
    "app/api/admin/users/[id]/route.ts",
    "app/api/admin/users/route.ts",
    "app/api/aliases/slack/route.ts",
    "app/api/analyze/kajabi-grants/route.ts",
    "app/api/analyze/slack-reconciliation/route.ts",
    "app/api/analyze/stripe-orphans/route.ts",
    "app/api/analyze/subscription-reconciliation/route.ts",
    "app/api/analyze/zoom-access/route.ts",
    "app/api/health/route.ts",
    "app/api/members/network/route.ts",
    "app/api/members/route.ts",
    "app/api/prickle-types/resolve-batch/route.ts",
    "app/api/process/chat/route.ts",
    "app/api/process/members/route.ts",
    "app/api/reports/name-matching/route.ts",
    "lib/arrivals.ts",
    "lib/badges.ts",
    "lib/channels/email.ts",
    "lib/courses/process.ts",
    "lib/host-eligibility.ts",
    "lib/kajabi-cohort-matching.ts",
    "lib/live-room.ts",
    "lib/member-reminders.ts",
    "lib/member-slack-links.ts",
    "lib/member-status.ts",
    "lib/mentorship-intro.ts",
    "lib/onboarding.server.ts",
    "lib/prickle-roster.ts",
    "lib/processing/login-events.ts",
    "lib/resubscription-data.ts",
    "lib/search/universal.ts",
    "lib/slack-sign-in.ts",
  ],
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
