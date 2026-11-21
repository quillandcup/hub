/**
 * Drift guards for the permission model (src/lib/permissions.ts): every admin page, server action and staff
 * route is guarded by a permission that exists, a page's guard agrees with the table the proxy and the sidebar
 * read (src/lib/admin-paths.ts), and every permission is used by something or deliberately reserved. These are
 * source scans, because the point is "every file", not one flow. Behaviour is in tests/lib/permissions.test.ts
 * and tests/components/pages/admin-auth.test.tsx.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, RESERVED_PERMISSIONS } from "@/lib/permissions";
import { permissionForAdminPath } from "@/lib/admin-paths";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const walk = (dir: string): string[] =>
  (fs.readdirSync(path.join(repoRoot, dir), { recursive: true }) as string[]).map((f) => path.join(dir, f)).filter((f) => fs.statSync(path.join(repoRoot, f)).isFile());

const srcFiles = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const adminFiles = walk("src/app/(admin)");

// The route a page file serves: "src/app/(admin)/admin/members/[id]/slack/page.tsx" → "/admin/members/x/slack".
// Route groups, parallel slots and intercepting markers are not part of the URL.
const routeOf = (file: string) => {
  const segments = file
    .replace(/^src\/app\//, "")
    .replace(/\/?page\.tsx$/, "")
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"))
    .map((s) => s.replace(/^\(\.+\)/, "").replace(/^\[.*\]$/, "x"));
  return "/" + segments.join("/");
};

const PAGE_GUARD = /await requirePermission\("([a-z_.]+)"\)/;
const permissions = new Set<string>(ALL_PERMISSIONS);

describe("no old guard is left", () => {
  it("has no requireAdminPage, requireAdminAction, requireStaffPage, requireStaffAction or requireAdmin in src (the history in the changelog excepted)", () => {
    const offenders = srcFiles.filter((f) => !f.startsWith("src/content/") && /\brequire(AdminPage|AdminAction|StaffPage|StaffAction|Admin)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("every admin page checks the permission its path needs", () => {
  const pages = adminFiles.filter((f) => f.endsWith("/page.tsx"));

  it("finds the admin pages", () => {
    expect(pages.length).toBeGreaterThan(80);
  });

  it("guards the admin layout with the staff area", () => {
    expect(read("src/app/(admin)/layout.tsx")).toMatch(/await requirePermission\("staff\.access"\)/);
  });

  it.each(pages)("%s", (file) => {
    const guard = read(file).match(PAGE_GUARD)?.[1];
    expect(guard, `${file} must start with await requirePermission("<permission>")`).toBeDefined();
    expect(permissions.has(guard!), `${guard} is not in PERMISSIONS`).toBe(true);
    // The proxy and the sidebar read the table in src/lib/admin-paths.ts: a page can't need one permission to open
    // and be offered under another.
    expect(guard).toBe(permissionForAdminPath(routeOf(file)));
  });
});

describe("every admin server action checks a permission", () => {
  // Server actions are directly callable POST endpoints: the page's guard doesn't cover them.
  const ACTION_FILES_ELSEWHERE = ["src/app/actions/sudo.ts", "src/app/actions/record-history.ts"];
  // Exported actions that are deliberately not guarded, with the reason.
  const NOT_GUARDED: Record<string, string> = {
    "src/app/actions/sudo.ts#exitSudo": "only clears the caller's own sudo cookies; must keep working even if the role was revoked",
    "src/app/actions/sudo.ts#exitSudoToAdmin": "clears own cookies, then opens /admin (which checks the role itself)",
  };
  const actionFiles = [
    ...adminFiles.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use server["']/m.test(read(f))),
    ...ACTION_FILES_ELSEWHERE,
  ];
  const actions = actionFiles.flatMap((file) => {
    const src = read(file);
    const starts = [...src.matchAll(/^export (?:async )?function (\w+)/gm)];
    return starts.map((m, i) => [`${file}#${m[1]}`, src.slice(m.index, starts[i + 1]?.index ?? src.length)] as const);
  });

  it("finds the admin actions", () => {
    expect(actions.length).toBeGreaterThan(100);
    expect(actions.map(([id]) => id)).toEqual(
      expect.arrayContaining([
        "src/app/(admin)/admin/hygiene/merge-fix/actions.ts#dismissGroup",
        "src/app/(admin)/admin/pages/actions.ts#publishLandingPage",
        "src/app/actions/sudo.ts#startSudo",
      ])
    );
  });

  it.each(actions.filter(([id]) => !(id in NOT_GUARDED)))("%s", (_id, body) => {
    const guard = body.match(/await requireActionPermission\("([a-z_.]+)"\)/)?.[1];
    expect(guard, "must call await requireActionPermission(\"<permission>\")").toBeDefined();
    expect(permissions.has(guard!), `${guard} is not in PERMISSIONS`).toBe(true);
  });

  it("keeps landing page publishing, deleting and editing on their own permissions", () => {
    const body = (name: string) => actions.find(([id]) => id.endsWith(`pages/actions.ts#${name}`))![1];
    expect(body("publishLandingPage")).toContain('requireActionPermission("pages.publish")');
    expect(body("unpublishLandingPage")).toContain('requireActionPermission("pages.publish")');
    expect(body("deleteLandingPage")).toContain('requireActionPermission("pages.delete")');
    expect(body("saveLandingDraft")).toContain('requireActionPermission("pages.edit")');
  });
});

describe("every staff route checks a permission", () => {
  // API folders that hold only staff routes (the others mix in webhooks, cron and member routes with their own checks).
  const STAFF_API_DIRS = [
    "admin", "import", "process", "reconcile", "analyze", "reports", "badge-types", "member-badges", "member-hiatus",
    "member-overrides", "prickle-types", "prickle-schedules", "prickle-schedule-locks", "zoom", "aliases", "data-hygiene",
  ];
  const routes = walk("src/app/api").filter((f) => f.endsWith("/route.ts") && STAFF_API_DIRS.includes(f.split("/")[3]));

  it("finds the staff routes", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it.each(routes)("%s", (file) => {
    const body = read(file);
    const guards = [...body.matchAll(/require(?:Api|Action)Permission\((?:\w+, )?"([a-z_.]+)"\)/g)].map((m) => m[1]);
    expect(guards.length, "must call requireApiPermission(request, \"<permission>\")").toBeGreaterThan(0);
    for (const guard of guards) expect(permissions.has(guard), `${guard} is not in PERMISSIONS`).toBe(true);
  });
});

describe("every permission is used, or reserved", () => {
  // A permission is "used" when its name appears as a literal in a guard, a `can()`/`staffCan()` check or the admin
  // page table; the registry and the feature list themselves don't count.
  const usedIn = (permission: string) =>
    srcFiles.filter((f) => f !== "src/lib/permissions.ts" && f !== "src/lib/staff-access.ts" && read(f).includes(`"${permission}"`));

  it("has a guard or a check for every permission that is not reserved", () => {
    const unused = ALL_PERMISSIONS.filter((p) => !RESERVED_PERMISSIONS.includes(p) && usedIn(p).length === 0);
    expect(unused).toEqual([]);
  });

  it("takes a permission off the reserved list once something checks it", () => {
    const stale = RESERVED_PERMISSIONS.filter((p) => usedIn(p).length > 0);
    expect(stale).toEqual([]);
  });
});
