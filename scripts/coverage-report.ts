#!/usr/bin/env npx tsx
// Merges the unit and db coverage runs into one PR coverage report and a gate on new code.
//
//   tsx scripts/coverage-report.ts --suite unit=coverage/unit --suite db=coverage/db \
//     [--patch-base origin/main]
//
// Reads <dir>/coverage-final.json for each suite (istanbul format). Four measures are tracked:
// lines (executable when a statement starts on it), statements, functions and branches. Suites
// are merged by identity, not by summing counts: an item is covered if any suite ran it. Items
// are keyed by source location instead of istanbul's per-run numeric ids; both suites transform
// each file the same way, so the maps match (>99.9% of locations, checked on the unit and db
// runs).
//
// A coverage "score" is the mean of the percentages of statements, functions and branches
// (whichever have something to cover). Lines are shown but not scored: they are derived from
// statements (corr 0.999 per file), so counting both would double-weight one signal. Writes it per area (per suite and combined) to the job summary and to one sticky PR
// comment (updated in place; needs GH_TOKEN, GITHUB_REPOSITORY and PR_NUMBER, and a failure to
// comment only warns, e.g. read-only fork tokens). With --patch-base it also scores the new
// code: the lines `git diff <base>...HEAD` added, and the statements, functions and branches
// that start on them, covered by either suite. It exits 1 when that score is below
// MIN_PATCH_SCORE.
//
// The per-directory floors stay in vitest.config.mts (coverage.thresholds) and fail the unit
// job early. app/api/** is excluded from the new-code gate: its routes are exercised by db
// tests that call a separate Next server process, which v8 can't instrument. Set
// PATCH_COVERAGE_SKIP=1 to report without gating (CI does when the PR has the
// skip-patch-coverage label).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_PATCH_SCORE = 80;
const SOURCE = /^((app|lib|components|emails)\/.+\.(ts|tsx)|(proxy|instrumentation|instrumentation-client)\.ts)$/;
const EXCLUDED = [/^app\/api\//, /\.d\.ts$/, /\.test\.tsx?$/];
const COMMENT_MARKER = "<!-- coverage-report -->";

type Loc = { line: number; column: number };
export type FileCoverage = {
  statementMap: Record<string, { start: Loc; end?: Loc }>;
  s: Record<string, number>;
  fnMap?: Record<string, { loc: { start: Loc } }>;
  f: Record<string, number>;
  branchMap?: Record<string, { type: string; loc: { start: Loc } }>;
  b: Record<string, number[]>;
};

export type Area = { covered: number; total: number };
export type Metrics = { lines: Area; statements: Area; functions: Area; branches: Area };
export const MEASURES = ["lines", "statements", "functions", "branches"] as const;
type Measure = (typeof MEASURES)[number];
/** The measures a score averages: lines are left out, they duplicate statements. */
export const SCORED = ["statements", "functions", "branches"] as const;

/** Per file, each measure's items (keyed by source location) -> whether they ran. */
export type FileHits = Record<Measure, Map<string, boolean>>;
export type SuiteHits = Map<string, FileHits>;

export function isGated(file: string): boolean {
  return SOURCE.test(file) && !EXCLUDED.some((re) => re.test(file));
}

const at = (l: Loc | undefined) => (l ? `${l.line}:${l.column}` : "?");
const emptyHits = (): FileHits => ({
  lines: new Map(),
  statements: new Map(),
  functions: new Map(),
  branches: new Map(),
});

export function suiteHits(coverage: Record<string, FileCoverage>, root: string): SuiteHits {
  const out: SuiteHits = new Map();
  for (const [abs, fc] of Object.entries(coverage)) {
    const hits = emptyHits();
    for (const [id, stmt] of Object.entries(fc.statementMap)) {
      const hit = fc.s[id] > 0;
      hits.statements.set(`${at(stmt.start)}-${at(stmt.end)}`, hit);
      // A line is executable when a statement starts on it, covered when one of those ran.
      const line = String(stmt.start.line);
      hits.lines.set(line, (hits.lines.get(line) ?? false) || hit);
    }
    for (const [id, fn] of Object.entries(fc.fnMap ?? {})) {
      hits.functions.set(at(fn.loc.start), fc.f[id] > 0);
    }
    for (const [id, br] of Object.entries(fc.branchMap ?? {})) {
      (fc.b[id] ?? []).forEach((n, i) => hits.branches.set(`${br.type}@${at(br.loc.start)}#${i}`, n > 0));
    }
    out.set(path.relative(root, abs), hits);
  }
  return out;
}

export function mergeSuites(suites: SuiteHits[]): SuiteHits {
  const merged: SuiteHits = new Map();
  for (const suite of suites) {
    for (const [file, hits] of suite) {
      const into = merged.get(file) ?? emptyHits();
      for (const m of MEASURES) {
        for (const [key, hit] of hits[m]) into[m].set(key, (into[m].get(key) ?? false) || hit);
      }
      merged.set(file, into);
    }
  }
  return merged;
}

/** First path segment, the route group under app/, or "(root files)" for top-level files. */
export function areaKey(file: string): string {
  const parts = file.split("/");
  if (parts.length === 1) return "(root files)";
  return parts[0] === "app" && parts.length > 2 ? `app/${parts[1]}` : parts[0];
}

const emptyMetrics = (): Metrics => ({
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
});

function addTo(into: Area, items: Map<string, boolean>): void {
  into.total += items.size;
  into.covered += [...items.values()].filter(Boolean).length;
}

/** All four measures per area. Every file in the data counts, covered or not. */
export function areaMetrics(files: SuiteHits): Map<string, Metrics> {
  const areas = new Map<string, Metrics>();
  for (const [file, hits] of files) {
    const key = areaKey(file);
    const m = areas.get(key) ?? emptyMetrics();
    for (const measure of MEASURES) addTo(m[measure], hits[measure]);
    areas.set(key, m);
  }
  return areas;
}

export function sumMetrics(metrics: Iterable<Metrics>): Metrics {
  const sum = emptyMetrics();
  for (const m of metrics) {
    for (const k of MEASURES) {
      sum[k].covered += m[k].covered;
      sum[k].total += m[k].total;
    }
  }
  return sum;
}

const pct = (a: Area) => (a.total === 0 ? 100 : (100 * a.covered) / a.total);

/** Mean percentage of the scored measures that have something to cover; null if none do. */
export function aggregateScore(m: Metrics): number | null {
  const present = SCORED.filter((k) => m[k].total > 0);
  return present.length === 0 ? null : present.reduce((sum, k) => sum + pct(m[k]), 0) / present.length;
}

/**
 * Gaps a score can hide: an area where nothing ran, or where one measure is entirely uncovered
 * while the others pull the mean up (e.g. functions 0/12 inside a 60% area).
 */
export function flags(m: Metrics): string[] {
  const present = SCORED.filter((k) => m[k].total > 0);
  if (present.length === 0) return [];
  if (present.every((k) => m[k].covered === 0)) return ["🚫 untested"];
  const zero = present.filter((k) => m[k].covered === 0);
  return zero.length ? [`⚠️ no ${zero.join("/")} covered`] : [];
}

/** Added line numbers per file from `git diff -U0` output. */
export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
    } else if (file && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      const lines = added.get(file) ?? new Set<number>();
      for (let i = 0; i < count; i++) lines.add(start + i);
      added.set(file, lines);
    }
  }
  return added;
}

export type PatchResult = { metrics: Metrics; uncovered: Map<string, number[]> };

const startLine = (key: string) => Number(/(\d+):\d+/.exec(key)?.[1]);

/**
 * The new code's coverage: added lines, plus the statements, functions and branches that start
 * on one. A new file no suite imported has no entry: every added line counts as uncovered, and
 * its statements are unknown without a map, so each added line also counts as an uncovered
 * statement (otherwise the score would have nothing to average and the file would pass).
 */
export function patchCoverage(added: Map<string, Set<number>>, files: SuiteHits): PatchResult {
  const metrics = emptyMetrics();
  const uncovered = new Map<string, number[]>();
  for (const [file, lines] of added) {
    if (!isGated(file)) continue;
    const sorted = [...lines].sort((a, b) => a - b);
    const hits = files.get(file);
    const missed: number[] = [];
    if (!hits) {
      metrics.lines.total += sorted.length;
      metrics.statements.total += sorted.length;
      missed.push(...sorted);
    } else {
      for (const line of sorted) {
        const hit = hits.lines.get(String(line));
        if (hit === undefined) continue; // blank, comment, type-only: not executable
        metrics.lines.total++;
        if (hit) metrics.lines.covered++;
        else missed.push(line);
      }
      for (const measure of ["statements", "functions", "branches"] as const) {
        for (const [key, hit] of hits[measure]) {
          if (!lines.has(startLine(key))) continue;
          metrics[measure].total++;
          if (hit) metrics[measure].covered++;
        }
      }
    }
    if (missed.length) uncovered.set(file, missed);
  }
  return { metrics, uncovered };
}

export type Patch = { result: PatchResult; passed: boolean; skipped: boolean };

const cell = (a: Area | undefined) => (a && a.total > 0 ? `${a.covered}/${a.total} (${pct(a).toFixed(1)}%)` : "n/a");
const scoreCell = (m: Metrics | undefined) => {
  const score = m ? aggregateScore(m) : null;
  return score === null ? "n/a" : `${score.toFixed(1)}%`;
};

export function renderReport(
  suites: { name: string; metrics: Map<string, Metrics> }[],
  combined: Map<string, Metrics>,
  patch: Patch | null,
): string {
  const out = ["### Coverage (unit + db tests)", ""];
  if (patch) {
    const { result, passed, skipped } = patch;
    const icon = skipped ? "⏭️" : passed ? "✅" : "❌";
    out.push(
      `**New code: ${icon} ${scoreCell(result.metrics)}** (${MIN_PATCH_SCORE}% required${skipped ? ", check skipped by label" : ""}; covered by either suite; \`app/api/**\` is not counted)`,
      "",
      `| lines | statements | functions | branches |`,
      `|--:|--:|--:|--:|`,
      `| ${MEASURES.map((k) => cell(result.metrics[k])).join(" | ")} |`,
    );
    if (result.uncovered.size) {
      out.push("", "| File | Uncovered new lines |", "|---|---|");
      for (const [file, lines] of result.uncovered) out.push(`| \`${file}\` | ${lines.join(", ")} |`);
    }
    out.push("");
  }

  const names = suites.map((s) => s.name);
  out.push(
    `| Area | ${names.map((n) => `${n} lines`).join(" | ")} | combined lines | combined score | flags |`,
    `|---|${names.map(() => "--:|").join("")}--:|--:|---|`,
  );
  const row = (label: string, pick: (m: Map<string, Metrics>) => Metrics | undefined, c: Metrics | undefined) =>
    `| ${label} | ${suites.map((s) => cell(pick(s.metrics)?.lines)).join(" | ")} | ${cell(c?.lines)} | ${scoreCell(c)} | ${c ? flags(c).join("; ") : ""} |`;
  for (const [key, m] of [...combined].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(row(`\`${key}\``, (all) => all.get(key), m));
  }
  const total = sumMetrics(combined.values());
  out.push(
    `| **all** | ${suites.map((s) => `**${cell(sumMetrics(s.metrics.values()).lines)}**`).join(" | ")} | **${cell(total.lines)}** | **${scoreCell(total)}** | ${flags(total).join("; ")} |`,
  );

  out.push("", "<details open><summary>All measures: each suite, then combined</summary>");
  for (const table of [...suites, { name: "combined", metrics: combined }]) {
    out.push(
      "",
      `**${table.name}**`,
      "",
      "| Area | score | lines | statements | functions | branches |",
      "|---|--:|--:|--:|--:|--:|",
    );
    const line = (label: string, m: Metrics) =>
      `| ${label} | ${scoreCell(m)} | ${MEASURES.map((k) => cell(m[k])).join(" | ")} |`;
    for (const [key, m] of [...table.metrics].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(line(`\`${key}\``, m));
    }
    out.push(line("**all**", sumMetrics(table.metrics.values())));
  }
  out.push(
    "",
    "Score is the mean of statements, functions and branches (lines duplicate statements, so they are shown but not scored; n/a if none has anything to cover). An item counts as covered if either suite ran it. 🚫 untested: nothing in the area ran. ⚠️: a whole measure is uncovered, which the score averages away.",
    "</details>",
  );
  return out.join("\n");
}

function postStickyComment(body: string): void {
  const { GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return;
  const gh = (args: string[]) => spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  const endpoint = `repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`;
  const list = gh([endpoint, "--paginate", "--jq", `.[] | select(.body | contains("${COMMENT_MARKER}")) | .id`]);
  const existing = list.stdout.split("\n").find(Boolean);
  const full = `${COMMENT_MARKER}\n${body}`;
  const res = existing
    ? gh(["-X", "PATCH", `repos/${GITHUB_REPOSITORY}/issues/comments/${existing}`, "-f", `body=${full}`])
    : gh([endpoint, "-f", `body=${full}`]);
  if (res.status !== 0) console.warn(`Could not post the coverage comment: ${res.stderr}`);
}

function suiteArgs(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  process.argv.forEach((a, i) => {
    if (a !== "--suite") return;
    const [name, dir] = (process.argv[i + 1] ?? "").split("=");
    if (name && dir) out.push({ name, dir });
  });
  return out;
}

function main(): void {
  const suites = suiteArgs();
  const baseIdx = process.argv.indexOf("--patch-base");
  const base = baseIdx === -1 ? undefined : process.argv[baseIdx + 1];
  if (suites.length === 0) {
    throw new Error("usage: coverage-report.ts --suite <name>=<coverage dir> [--suite ...] [--patch-base <ref>]");
  }

  const root = process.cwd();
  const loaded = suites.map(({ name, dir }) => {
    const raw = JSON.parse(readFileSync(path.join(dir, "coverage-final.json"), "utf8")) as Record<string, FileCoverage>;
    return { name, hits: suiteHits(raw, root) };
  });
  const merged = mergeSuites(loaded.map((s) => s.hits));

  let patch: Patch | null = null;
  if (base) {
    const diff = spawnSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
    const result = patchCoverage(parseAddedLines(diff.stdout), merged);
    const score = aggregateScore(result.metrics);
    const skipped = process.env.PATCH_COVERAGE_SKIP === "1";
    // No executable new code (docs, config, types, app/api only) has nothing to test.
    patch = { result, skipped, passed: skipped || score === null || score >= MIN_PATCH_SCORE };
  }

  const text = renderReport(
    loaded.map((s) => ({ name: s.name, metrics: areaMetrics(s.hits) })),
    areaMetrics(merged),
    patch,
  );
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  postStickyComment(text);
  if (patch && !patch.passed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
