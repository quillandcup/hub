#!/usr/bin/env npx tsx
// Lists every route handler under src/app/api with its path, HTTP methods and who may call it, and keeps that
// table in docs/architecture/API_ROUTES.md.
//
//   tsx scripts/api-route-inventory.ts           rewrite the table   (pnpm docs:api-routes)
//   tsx scripts/api-route-inventory.ts --check   exit 1 if the table is out of date
//
// This file is the single source of truth for how a route is classified: tests/lib/api-route-auth.test.ts
// imports the same kinds and lists to fail on a route with no credential, and tests/lib/api-route-inventory.test.ts
// fails when the committed table differs from what this renders. The table sits between two marker comments;
// the rest of the doc is hand-written.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const DOC_PATH = "docs/architecture/API_ROUTES.md";
export const START_MARKER = "<!-- START api-routes generated: run `pnpm docs:api-routes` to update, don't edit by hand -->";
export const END_MARKER = "<!-- END api-routes -->";

/** The recognised credential kinds, each the helper names that are the check. */
export const CREDENTIAL_KINDS: Record<string, RegExp> = {
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

/** What each credential kind means to a caller, for the doc. */
export const CREDENTIAL_DESCRIPTIONS: Record<string, string> = {
  admin: "Staff: a signed-in account holding the route's permission (`requireApiPermission`); the scheduled-job secret also passes.",
  session: "Member: a signed-in session.",
  "internal-secret": "Scheduled jobs: the shared secret of our own jobs, refused when unset.",
  "webhook-signature": "Provider webhook: the provider's signature or shared token over the request.",
  "signed-token": "A token we signed that names the member and the action (unsubscribe links).",
  "url-secret": "A secret in the URL, looked up on the server (calendar feeds).",
  "oauth-state": "The state cookie of an OAuth round trip, consumed once.",
  public: "Public: no credential, on purpose (see the reason in the list below).",
};

/** Routes with no recognised credential step. Shrink-only: each needs a reason it is safe. */
export const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "Uptime check; returns only up/down and timings, no data (src/lib/supabase/middleware.ts isPublic).",
  "src/app/api/landing/opt-in/route.ts": "Public sign-up form on a published landing page: honeypot, two rate-limit buckets, and the target is looked up in the published page.",
};

/**
 * A route that only calls a handler elsewhere: the credential step is looked for in that file too (comments ignored, same recognised steps).
 * The route must import it, so the entry cannot point at an unrelated file. Each is a thin route whose handling lives in a module
 * (docs/architecture/CHAT_MODULE.md).
 */
export const DELEGATES: Record<string, string> = {
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

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

export function handlersOf(code: string): string[] {
  return HTTP_METHODS.filter((m) => new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b`).test(code));
}

export interface RouteRow {
  file: string;
  /** The URL path, e.g. `/api/members/[id]`. */
  path: string;
  methods: string[];
  kinds: string[];
}

export function urlPathOf(file: string): string {
  return "/" + file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
}

export function classify(root = process.cwd()): RouteRow[] {
  return routeFiles(join(root, "src/app/api"))
    .map((abs) => {
      const file = relative(root, abs);
      const own = stripComments(readFileSync(abs, "utf8"));
      const delegate = DELEGATES[file];
      const code = delegate ? `${own}\n${stripComments(readFileSync(join(root, delegate), "utf8"))}` : own;
      return {
        file,
        path: urlPathOf(file),
        methods: handlersOf(code),
        kinds: Object.entries(CREDENTIAL_KINDS).filter(([, re]) => re.test(code)).map(([kind]) => kind),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The generated block (markers included): one table row per route. */
export function renderTable(rows: RouteRow[]): string {
  const lines = [
    START_MARKER,
    "",
    `${rows.length} routes.`,
    "",
    "| Path | Methods | Who may call it |",
    "|---|---|---|",
    ...rows.map((r) => {
      const who = r.kinds.length ? r.kinds.map((k) => `\`${k}\``).join(" + ") : r.file in PUBLIC_ROUTES ? "`public`" : "**none**";
      return `| \`${r.path}\` | ${r.methods.join(", ") || "none"} | ${who} |`;
    }),
    "",
    END_MARKER,
  ];
  return lines.join("\n");
}

/** The doc with its generated block replaced. */
export function applyTable(doc: string, rows: RouteRow[]): string {
  const start = doc.indexOf(START_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start < 0 || end < start) throw new Error(`${DOC_PATH} has no ${START_MARKER} ... ${END_MARKER} block`);
  return doc.slice(0, start) + renderTable(rows) + doc.slice(end + END_MARKER.length);
}

function main() {
  const check = process.argv.includes("--check");
  const current = readFileSync(join(process.cwd(), DOC_PATH), "utf8");
  const next = applyTable(current, classify());
  if (next === current) return;
  if (check) {
    console.error(`${DOC_PATH} is out of date: run pnpm docs:api-routes`);
    process.exit(1);
  }
  writeFileSync(join(process.cwd(), DOC_PATH), next);
  console.log(`updated ${DOC_PATH}`);
}

if (process.argv[1]?.endsWith("api-route-inventory.ts")) main();
