#!/usr/bin/env npx tsx
// Merges the unit and db coverage runs into one PR coverage report and a gate on new lines.
//
//   tsx scripts/coverage-report.ts --suite unit=coverage/unit --suite db=coverage/db \
//     [--patch-base origin/main]
//
// Reads <dir>/coverage-final.json for each suite (istanbul format) and reduces every file to
// its executable lines: a line is executable when a statement starts on it, covered when one of
// those statements ran. Suites are merged at line level (covered if any suite ran it), not by
// summing istanbul statement maps, because two v8 runs of one file can produce different maps.
//
// Writes lines covered per area (per suite and combined) to the job summary and to one sticky
// PR comment (updated in place; needs GH_TOKEN, GITHUB_REPOSITORY and PR_NUMBER, and a failure
// to comment only warns, e.g. read-only fork tokens). With --patch-base it also checks the
// lines `git diff <base>...HEAD` added and exits 1 when less than MIN_PATCH_COVERAGE of the
// executable ones are covered by any suite.
//
// The per-directory floors stay in vitest.config.mts (coverage.thresholds) and fail the unit
// job early. app/api/** is excluded from the patch gate: its routes are exercised by db tests
// that call a separate Next server process, which v8 can't instrument. Set
// PATCH_COVERAGE_SKIP=1 to report without gating (CI does when the PR has the
// skip-patch-coverage label).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_PATCH_COVERAGE = 80;
const SOURCE = /^(app|lib|components)\/.+\.(ts|tsx)$/;
const EXCLUDED = [/^app\/api\//, /\.d\.ts$/, /\.test\.tsx?$/];
const COMMENT_MARKER = "<!-- coverage-report -->";

export type FileCoverage = {
  statementMap: Record<string, { start: { line: number } }>;
  s: Record<string, number>;
};

/** Executable line -> whether it ran. */
export type LineMap = Map<number, boolean>;
/** Repo-relative path -> its lines. */
export type SuiteLines = Map<string, LineMap>;
export type Area = { covered: number; total: number };

export function isGated(file: string): boolean {
  return SOURCE.test(file) && !EXCLUDED.some((re) => re.test(file));
}

export function suiteLines(coverage: Record<string, FileCoverage>, root: string): SuiteLines {
  const files: SuiteLines = new Map();
  for (const [abs, fc] of Object.entries(coverage)) {
    const lines: LineMap = new Map();
    for (const [id, stmt] of Object.entries(fc.statementMap)) {
      const line = stmt.start.line;
      lines.set(line, (lines.get(line) ?? false) || fc.s[id] > 0);
    }
    files.set(path.relative(root, abs), lines);
  }
  return files;
}

/** A line is covered when any suite ran it; executable when it is in any suite's map. */
export function mergeSuites(suites: SuiteLines[]): SuiteLines {
  const merged: SuiteLines = new Map();
  for (const suite of suites) {
    for (const [file, lines] of suite) {
      const into = merged.get(file) ?? new Map<number, boolean>();
      for (const [line, hit] of lines) into.set(line, (into.get(line) ?? false) || hit);
      merged.set(file, into);
    }
  }
  return merged;
}

/** Lines covered per area: first path segment, or the route group under app/. */
export function areaCoverage(files: SuiteLines): Map<string, Area> {
  const areas = new Map<string, Area>();
  for (const [file, lines] of files) {
    const parts = file.split("/");
    const key = parts[0] === "app" && parts.length > 2 ? `app/${parts[1]}` : parts[0];
    const area = areas.get(key) ?? { covered: 0, total: 0 };
    area.total += lines.size;
    area.covered += [...lines.values()].filter(Boolean).length;
    areas.set(key, area);
  }
  return areas;
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

export type PatchResult = {
  covered: number;
  total: number;
  uncovered: Map<string, number[]>;
};

export function patchCoverage(added: Map<string, Set<number>>, files: SuiteLines): PatchResult {
  let covered = 0;
  let total = 0;
  const uncovered = new Map<string, number[]>();
  for (const [file, lines] of added) {
    if (!isGated(file)) continue;
    const sorted = [...lines].sort((a, b) => a - b);
    const executable = files.get(file);
    const missed: number[] = [];
    if (!executable) {
      // A new file no suite imported has no entry at all: every added line counts as missed.
      total += sorted.length;
      missed.push(...sorted);
    } else {
      for (const line of sorted) {
        const hit = executable.get(line);
        if (hit === undefined) continue; // blank, comment, type-only: not executable
        total++;
        if (hit) covered++;
        else missed.push(line);
      }
    }
    if (missed.length) uncovered.set(file, missed);
  }
  return { covered, total, uncovered };
}

const pct = (a: Area) => (a.total === 0 ? 100 : (100 * a.covered) / a.total);
const cell = (a: Area | undefined) => (a ? `${pct(a).toFixed(1)}% (${a.covered}/${a.total})` : "n/a");

export type Patch = { result: PatchResult; passed: boolean; skipped: boolean };

export function renderReport(
  suites: { name: string; areas: Map<string, Area> }[],
  combined: Map<string, Area>,
  patch: Patch | null,
): string {
  const out = ["### Coverage (unit + db tests)", ""];
  if (patch) {
    const { result, passed, skipped } = patch;
    const icon = skipped ? "⏭️" : passed ? "✅" : "❌";
    out.push(
      `**New lines: ${icon} ${pct(result).toFixed(1)}%** (${result.covered} of ${result.total} new executable lines covered by either suite; ${MIN_PATCH_COVERAGE}% required${skipped ? ", check skipped by label" : ""}). \`app/api/**\` is not counted.`,
    );
    if (result.uncovered.size) {
      out.push("", "| File | Uncovered new lines |", "|---|---|");
      for (const [file, lines] of result.uncovered) out.push(`| \`${file}\` | ${lines.join(", ")} |`);
    }
    out.push("");
  }
  const total = (areas: Map<string, Area>): Area =>
    [...areas.values()].reduce(
      (sum, a) => ({ covered: sum.covered + a.covered, total: sum.total + a.total }),
      { covered: 0, total: 0 },
    );
  out.push(
    `| Area | ${suites.map((s) => s.name).join(" | ")} | combined |`,
    `|---|${suites.map(() => "--:|").join("")}--:|`,
  );
  for (const [key, area] of [...combined].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`| \`${key}\` | ${suites.map((s) => cell(s.areas.get(key))).join(" | ")} | ${cell(area)} |`);
  }
  out.push(
    `| **all** | ${suites.map((s) => `**${cell(total(s.areas))}**`).join(" | ")} | **${cell(total(combined))}** |`,
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
  const loaded = suites.map(({ name, dir }) => ({
    name,
    files: suiteLines(JSON.parse(readFileSync(path.join(dir, "coverage-final.json"), "utf8")), root),
  }));
  const merged = mergeSuites(loaded.map((s) => s.files));

  let patch: Patch | null = null;
  if (base) {
    const diff = spawnSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
    const result = patchCoverage(parseAddedLines(diff.stdout), merged);
    const skipped = process.env.PATCH_COVERAGE_SKIP === "1";
    patch = { result, skipped, passed: skipped || pct(result) >= MIN_PATCH_COVERAGE };
  }

  const text = renderReport(
    loaded.map((s) => ({ name: s.name, areas: areaCoverage(s.files) })),
    areaCoverage(merged),
    patch,
  );
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  postStickyComment(text);
  if (patch && !patch.passed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
