import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify, DELEGATES, PUBLIC_ROUTES, type RouteRow } from "@/scripts/api-route-inventory";

/**
 * Guard: every route handler under src/app (the API, the sign-in endpoints, the downloads) authenticates itself.
 *
 * The proxy treats all of /api/ as public (src/lib/supabase/middleware.ts), so a route that forgets
 * to check its caller is open to the internet, and nothing else fails when one does. This test
 * lists each src/app route file with the credential step it contains and fails when a route has
 * none, unless the route is in PUBLIC_ROUTES with the reason. A new route must either contain one
 * of the recognised steps below or be added there on purpose, in review.
 *
 * Static text only: it proves a recognised credential step is in the file (comments ignored), not
 * that every code path reaches it. The route's own test covers the refusal (tests/api/).
 * The kinds, PUBLIC_ROUTES and DELEGATES live in scripts/api-route-inventory.ts, which also renders
 * docs/architecture/API_ROUTES.md from the same data. See docs/trust/THREAT_MODEL.md, A01.
 */

function table(rows: RouteRow[]): string {
  return rows.map((r) => `${r.file}  [${r.methods.join(",") || "no handler"}]  ${r.kinds.join("+") || "NONE"}`).join("\n");
}

describe("api route authentication", () => {
  const rows = classify();

  it("finds the routes, each with an HTTP handler", () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => r.methods.length === 0).map((r) => r.file)).toEqual([]);
  });

  it("every route has a recognised credential step or is a listed public route", () => {
    const unclassified = rows.filter((r) => r.kinds.length === 0 && !(r.file in PUBLIC_ROUTES));
    expect(
      unclassified.map((r) => r.file),
      `Routes under /api are public to the proxy, so each must authenticate itself. Add a recognised step (CREDENTIAL_KINDS) or, for a route that is public on purpose, an entry with a reason in PUBLIC_ROUTES.\n\nCredential per route:\n${table(rows)}`,
    ).toEqual([]);
  });

  it("DELEGATES names a handler the route really imports", () => {
    for (const [route, delegate] of Object.entries(DELEGATES)) {
      const code = readFileSync(join(process.cwd(), route), "utf8");
      const alias = `@/${delegate.replace(/^src\//, "").replace(/\.ts$/, "")}`;
      expect(code, route).toContain(alias);
    }
  });

  it("PUBLIC_ROUTES has no stale entry and none that now has a credential", () => {
    const byFile = new Map(rows.map((r) => [r.file, r]));
    const stale = Object.keys(PUBLIC_ROUTES).filter((f) => !byFile.has(f) || byFile.get(f)!.kinds.length > 0);
    expect(stale, "Remove these from PUBLIC_ROUTES (route gone, or it now authenticates)").toEqual([]);
    for (const [file, reason] of Object.entries(PUBLIC_ROUTES)) expect(reason.length, file).toBeGreaterThan(10);
  });
});
