#!/usr/bin/env npx tsx
// Diffs or pushes vercel-project-config.yml against the live Vercel project, so Vercel
// project settings that vercel.json can't express are reviewed in git instead of clicked in
// the dashboard. CI runs `push` after every production deploy that changed the file or this
// script (ci.yml, push-vercel-config job); `npm run vercel:config:diff` is the read-only
// preview.
//
//   tsx scripts/vercel-config.ts diff   show what a push would change (read-only)
//   tsx scripts/vercel-config.ts push   apply the file to the live project
//
// Only the sections the file declares are managed. Today that is tracing.sampling, which a
// push REPLACES wholesale: rules added in the dashboard but missing from the file are removed.
//
// The tracing endpoint (/v1/drains/tracing/config) is the one the `vercel traces config` CLI
// uses; it isn't in the public REST reference, but unlike the CLI it accepts a 0% rate.
//
// Env: VERCEL_TOKEN (a team-scoped token), VERCEL_ORG_ID (team_...), VERCEL_PROJECT_ID (prj_...).

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const CONFIG_FILE = "vercel-project-config.yml";
const API = "https://api.vercel.com";
const RULE_LIMIT = 10;
const ENVIRONMENTS = ["production", "preview", "any"] as const;

interface Rule {
  environment: (typeof ENVIRONMENTS)[number];
  path: string | null;
  /** Percent, 0-100. */
  rate: number;
}

/** A rule as the API stores it. `rate` is a fraction; no `env`/`requestPath` means any/all. */
interface ApiRule {
  type: "head_sampling";
  rate: number;
  env?: string;
  requestPath?: string;
}

interface TracingConfig {
  enabled: boolean;
  sampling: ApiRule[];
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

function parseRules(raw: unknown): Rule[] {
  const sampling = (raw as { tracing?: { sampling?: unknown } } | null)?.tracing?.sampling;
  if (!Array.isArray(sampling)) fail(`${CONFIG_FILE}: tracing.sampling must be a list`);
  if (sampling.length > RULE_LIMIT) {
    fail(`${CONFIG_FILE}: ${sampling.length} sampling rules, Vercel allows at most ${RULE_LIMIT}`);
  }
  const seen = new Set<string>();
  return sampling.map((entry, i) => {
    const { environment, path = null, rate } = (entry ?? {}) as Record<string, unknown>;
    const where = `${CONFIG_FILE}: tracing.sampling[${i}]`;
    if (!ENVIRONMENTS.includes(environment as Rule["environment"])) {
      fail(`${where}.environment must be one of ${ENVIRONMENTS.join(", ")}`);
    }
    if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 0 || rate > 100) {
      fail(`${where}.rate must be a whole number from 0 to 100`);
    }
    if (path !== null && (typeof path !== "string" || !path.startsWith("/"))) {
      fail(`${where}.path must be a path prefix starting with /`);
    }
    const key = `${environment} ${path}`;
    // A duplicate key can never match: the first rule wins.
    if (seen.has(key)) fail(`${where} repeats ${environment} ${path ?? "(all paths)"}`);
    seen.add(key);
    return { environment: environment as Rule["environment"], path: path as string | null, rate };
  });
}

const toApiRule = (r: Rule): ApiRule => ({
  type: "head_sampling",
  rate: r.rate / 100,
  ...(r.environment === "any" ? {} : { env: r.environment }),
  ...(r.path === null ? {} : { requestPath: r.path }),
});

const fromApiRule = (r: ApiRule): Rule => ({
  environment: (r.env ?? "any") as Rule["environment"],
  path: r.requestPath ?? null,
  rate: Math.round(r.rate * 100),
});

const describe = (r: Rule) => `${r.environment} ${r.path ?? "(all paths)"} ${r.rate}%`;

async function tracingConfig(method: "GET" | "PUT", body?: unknown): Promise<TracingConfig> {
  const query = new URLSearchParams({
    projectId: requireEnv("VERCEL_PROJECT_ID"),
    teamId: requireEnv("VERCEL_ORG_ID"),
  });
  const res = await fetch(`${API}/v1/drains/tracing/config?${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("VERCEL_TOKEN")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) fail(`${method} tracing config: HTTP ${res.status} ${await res.text()}`);
  return (res.status === 204 ? { enabled: false, sampling: [] } : await res.json()) as TracingConfig;
}

/** The API reports "enabled with no rules" for a project that has tracing on but no rules. */
function liveRules(live: TracingConfig): Rule[] {
  if (!live.enabled) return [];
  return (live.sampling.length === 0 ? [{ type: "head_sampling" as const, rate: 1 }] : live.sampling).map(fromApiRule);
}

/** Order matters (first match wins), so rules compare by position as well as content. */
function printDiff(live: Rule[], local: Rule[]): number {
  let changes = 0;
  for (let i = 0; i < Math.max(live.length, local.length); i++) {
    const a = live[i];
    const b = local[i];
    if (a && b && describe(a) === describe(b)) continue;
    changes++;
    if (!a) console.log(`+ #${i + 1} ${describe(b)}`);
    else if (!b) console.log(`- #${i + 1} ${describe(a)}   (live only: a push removes it)`);
    else console.log(`~ #${i + 1} ${describe(a)} -> ${describe(b)}`);
  }
  if (changes === 0) console.log("No differences.");
  return changes;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "diff" && mode !== "push") fail("usage: vercel-config.ts diff|push");

  const local = parseRules(parseYaml(readFileSync(CONFIG_FILE, "utf8")));
  const live = liveRules(await tracingConfig("GET"));

  console.log(`${CONFIG_FILE} tracing.sampling vs the live Vercel project:`);
  const changes = printDiff(live, local);
  if (mode === "diff" || changes === 0) return;

  await tracingConfig("PUT", {
    enabled: local.length > 0,
    ...(local.length > 0 ? { sampling: local.map(toApiRule) } : {}),
  });

  // Read back: a rule the API silently normalised or dropped must not look like a success.
  const after = liveRules(await tracingConfig("GET"));
  if (printDiff(after, local) > 0) fail("The live rules still differ from the file after the push");
  console.log("✓ Vercel tracing sampling rules updated");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
