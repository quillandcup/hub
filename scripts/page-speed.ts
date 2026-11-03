#!/usr/bin/env npx tsx
// Per-route page speed in production, read-only: how long the functions take (server) and what real visitors
// measured (Speed Insights: FCP, LCP, TTFB), from `vercel metrics`. Run it for a window before a change ships and
// again after, and with --record to keep the numbers in docs/PAGE_SPEED.md, so a baseline builds up over time.
//
//   pnpm page-speed                                           last 24 hours, 1h buckets
//   pnpm page-speed --from 2026-11-03T03:50:00Z --granularity 5m --label "layout Suspense (#909)"
//   pnpm page-speed --routes /dashboard,/my-prickles --record
//
// `vercel metrics` snaps a window to whole buckets of --granularity, so pick 5m for a short window and give it
// times on the boundary. Compare windows with the same time of day and no deploy touching the page in between;
// a window right after a deploy includes cold starts. Aggregates only: no member data is read or written.
//
// Needs the Vercel CLI logged in (node_modules/.bin/vercel) and, in the env, VERCEL_ORG_ID and VERCEL_PROJECT_ID
// (`pnpm page-speed` loads .env.prod and .env.shared).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { formatRecord, formatTable, parsePageSpeedArgs, summaryByRoute, type PageSpeedArgs, type RouteRow } from "./page-speed-args";

const DOC = "docs/PAGE_SPEED.md";
const VERCEL = "node_modules/.bin/vercel";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set (run through \`pnpm page-speed\`)`);
    process.exit(1);
  }
  return value;
}

function query(metric: string, aggregation: string, args: PageSpeedArgs, scope: string, project: string): Map<string, number> {
  const output = execFileSync(
    VERCEL,
    ["metrics", metric, "-a", aggregation, "--group-by", "route", "--prod", "-s", args.from, "-u", args.to, "-l", "100", "-g", args.granularity, "--project", project, "--scope", scope, "--json"],
    { encoding: "utf8" },
  );
  return summaryByRoute(output);
}

function main() {
  const args = parsePageSpeedArgs(process.argv.slice(2), new Date());
  const scope = requireEnv("VERCEL_ORG_ID");
  const project = requireEnv("VERCEL_PROJECT_ID");
  const q = (metric: string, aggregation: string) => query(metric, aggregation, args, scope, project);

  const fn = "vercel.function_invocation.function_duration_ms";
  const si = (name: string) => `vercel.speed_insights.${name}`;
  const requests = q(fn, "count");
  const p50 = q(fn, "p50");
  const p75 = q(fn, "p75");
  const visits = q(si("fcp_ms"), "count");
  const fcp = q(si("fcp_ms"), "p75");
  const lcp = q(si("lcp_ms"), "p75");
  const ttfb = q(si("ttfb_ms"), "p75");

  const rows: RouteRow[] = args.routes
    .filter((route) => requests.has(route) || visits.has(route))
    .map((route) => ({
      route,
      requests: requests.get(route) ?? 0,
      serverP50: p50.get(route),
      serverP75: p75.get(route),
      visits: visits.get(route),
      fcpP75: fcp.get(route),
      lcpP75: lcp.get(route),
      ttfbP75: ttfb.get(route),
    }));
  const table = formatTable(rows);
  console.log(`${args.from} to ${args.to} (${args.granularity} buckets)\n\n${table}`);

  if (args.record) {
    let commit: string | null = null;
    try {
      commit = execFileSync("git", ["rev-parse", "--short", "production"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // No local `production` tag; the record just leaves the commit out.
    }
    if (!existsSync(DOC)) writeFileSync(DOC, "# Page speed baseline\n\nRecorded by `pnpm page-speed --record`; see scripts/page-speed.ts.\n\n");
    appendFileSync(DOC, `${formatRecord(args, table, commit)}\n`);
    console.log(`\nRecorded in ${DOC}`);
  }
}

main();
