import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { SITE_PAGES, navGroups, ADMIN_NAV_GROUPS, MEMBER_NAV_GROUPS } from "@/lib/site-pages";

/**
 * lib/site-pages.ts feeds the sidebars and universal search. This fails when a static page route
 * is in neither the registry nor EXCLUDED below, and when a registry entry points at a page that
 * no longer exists, so adding or removing a page forces the decision. Dynamic routes ([id]) are
 * records, not destinations, and are skipped.
 */
const EXCLUDED: Record<string, string> = {
  "/search": "the search results page itself",
  "/chat/search": "chat's own search page, reached from chat",
  "/admin/search": "the search results page itself",
  "/admin/reconciliation": "redirects to /admin/hygiene#reconciliation",
  "/admin/badges/new": "a create form, reached from Badges",
  "/admin/data/prickle-types/new": "a create form, reached from Prickle Types",
  "/admin/data/import/testing": "developer test harness, reached from Import Data",
};

const ROOT = path.resolve(__dirname, "../../app");

function routes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const group = /^\(.*\)$/.test(entry.name);
      out.push(...routes(path.join(dir, entry.name), group ? prefix : `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

const staticRoutes = [...routes("(member)"), ...routes("(admin)")].filter((r) => !r.includes("["));
const pathOf = (href: string) => href.split(/[?#]/)[0];

describe("site pages registry", () => {
  it("lists every static member and admin page, or excludes it with a reason", () => {
    const listed = new Set(SITE_PAGES.map((p) => pathOf(p.href)));
    const missing = staticRoutes.filter((r) => !listed.has(r) && !(r in EXCLUDED));
    expect(missing, `add to lib/site-pages.ts (or EXCLUDED here, with a reason): ${missing.join(", ")}`).toEqual([]);
  });

  it("points only at pages that exist", () => {
    const stale = SITE_PAGES.filter((p) => !staticRoutes.includes(pathOf(p.href))).map((p) => p.href);
    expect(stale).toEqual([]);
  });

  it("keeps EXCLUDED honest", () => {
    const listed = new Set(SITE_PAGES.map((p) => pathOf(p.href)));
    const stale = Object.keys(EXCLUDED).filter((r) => !staticRoutes.includes(r) || listed.has(r));
    expect(stale).toEqual([]);
  });

  it("has no duplicate destinations", () => {
    const keys = SITE_PAGES.map((p) => `${p.audience}:${p.href}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it("puts every sidebar page in a known group", () => {
    const known = { member: new Set<string>(MEMBER_NAV_GROUPS), admin: new Set(ADMIN_NAV_GROUPS.map((g) => g.name)) };
    const orphans = SITE_PAGES.filter((p) => p.nav && !known[p.audience].has(p.section)).map((p) => p.href);
    expect(orphans).toEqual([]);
  });

  it("hides sidebar links whose feature is off", () => {
    const links = (features: Parameters<typeof navGroups>[1]) => navGroups("member", features).flatMap((g) => g.items.map((p) => p.href));
    expect(links([])).not.toContain("/chat");
    expect(links(["chat"])).toContain("/chat");
  });
});
