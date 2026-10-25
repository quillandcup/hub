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
    "app/(admin)/admin/prickles/[id]/actions.ts",
    "app/(admin)/admin/prickles/[id]/page.tsx",
    "app/(member)/my-prickles/calendar-feed-actions.ts",
    "app/(member)/prickles/[id]/page.tsx",
    "app/(member)/prickles/checkin-actions.ts",
    "app/api/admin/members/merge/route.ts",
    "app/api/internal/prickle-checkins/route.ts",
    "app/api/prickle-types/resolve-batch/route.ts",
    "app/api/prickle-types/resolve/route.ts",
    "app/api/process/attendance/route.ts",
    "app/api/zoom/prickles/route.ts",
    "lib/calendar-feed.ts",
    "lib/prickle-schedules.ts",
    "lib/search/universal.ts",
  ],
  members: [
    "app/api/health/route.ts",
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
