import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guard: every route handler under src/app/api authenticates itself.
 *
 * The proxy treats all of /api/ as public (src/lib/supabase/middleware.ts), so a route that forgets
 * to check its caller is open to the internet, and nothing else fails when one does. This test
 * lists each src/app/api route file with the credential step it contains and fails when a route has
 * none, unless the route is in PUBLIC_ROUTES with the reason. A new route must either contain one
 * of the recognised steps below or be added there on purpose, in review.
 *
 * Static text only: it proves a recognised credential step is in the file (comments ignored), not
 * that every code path reaches it. The route's own test covers the refusal (tests/api/).
 * See docs/trust/THREAT_MODEL.md, A01.
 */

const API_DIR = join(process.cwd(), "src/app/api");

/** The recognised credential kinds, each the helper names that are the check. */
const CREDENTIAL_KINDS: Record<string, RegExp> = {
  // A signed-in staff account: refused for anyone else (the cron and service keys also pass, see src/lib/supabase/api-auth.ts).
  admin: /\b(requireApiPermission|requireActionPermission|requirePermission|requireActionPermission)\(/,
  // A signed-in member session.
  session: /\b(getCurrentUser|getCoursesCaller|getEffectiveIdentity|chatCaller|postingCaller|dmCaller|createApiAuth)\(/,
  // The shared secret of our own scheduled jobs, refused when unset.
  "internal-secret": /\bCRON_INTERNAL_SECRET\b/,
  // A provider's signature or shared token over the request.
  "webhook-signature": /\b(verifySlackSignature|verifyResendSignature|unwrapWebhook|zoomWebhookSecret|secretsMatch)\(/,
  // A token we signed, naming the member and the action.
  "signed-token": /\bparseUnsubscribeToken\(/,
  // A secret in the URL, looked up server-side.
  "url-secret": /\bparseFeedToken\(/,
  // The state cookie of an OAuth round trip, consumed once.
  "oauth-state": /\bverifyAndConsumeOAuthState\(/,
};

/** Routes with no recognised credential step. Shrink-only: each needs a reason it is safe. */
const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "Uptime check; returns only up/down and timings, no data (src/lib/supabase/middleware.ts isPublic).",
  "src/app/api/landing/opt-in/route.ts": "Public sign-up form on a published landing page: honeypot, two rate-limit buckets, and the target is looked up in the published page.",
};

/**
 * A route that only calls a handler elsewhere: the credential step is looked for in that file too (comments ignored, same recognised steps).
 * The route must import it, so the entry cannot point at an unrelated file. Each is a thin route whose handling lives in a module
 * (docs/architecture/CHAT_MODULE.md).
 */
const DELEGATES: Record<string, string> = {
  "src/app/api/webhooks/slack/route.ts": "src/modules/chat/slack/webhook.ts",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function handlersOf(code: string): string[] {
  return HTTP_METHODS.filter((m) => new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b`).test(code));
}

interface Row { file: string; methods: string[]; kinds: string[] }

function classify(): Row[] {
  return routeFiles(API_DIR)
    .map((path) => {
      const file = relative(process.cwd(), path);
      const own = stripComments(readFileSync(path, "utf8"));
      const delegate = DELEGATES[file];
      const code = delegate ? `${own}\n${stripComments(readFileSync(join(process.cwd(), delegate), "utf8"))}` : own;
      return {
        file,
        methods: handlersOf(code),
        kinds: Object.entries(CREDENTIAL_KINDS).filter(([, re]) => re.test(code)).map(([kind]) => kind),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function table(rows: Row[]): string {
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
