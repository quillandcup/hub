#!/usr/bin/env npx tsx
// Turns a Vitest coverage run into the PR's coverage report and, optionally, a gate on new lines.
//
//   tsx scripts/coverage-report.ts --name unit --dir coverage/unit [--patch-base origin/main]
//
// Reads <dir>/coverage-final.json (istanbul format; a line is executable when a statement
// starts on it, covered when one of those statements ran) and writes a markdown report:
// lines covered per area of the codebase, plus, with --patch-base, how much of the lines
// `git diff <base>...HEAD` added are covered. The report goes to the job summary and, on a
// pull request, to one sticky comment per --name (updated in place; needs GH_TOKEN,
// GITHUB_REPOSITORY and PR_NUMBER, and a failure to comment only warns, e.g. read-only fork
// tokens). With --patch-base the exit code is 1 below MIN_PATCH_COVERAGE.
//
// Enforcement of the per-directory floors stays in vitest.config.mts (coverage.thresholds).
// app/api/** is excluded from the patch gate: its routes are exercised by db tests that call
// a separate Next server process, which v8 can't instrument. Set PATCH_COVERAGE_SKIP=1 to
// report without gating (CI does when the PR has the skip-patch-coverage label).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_PATCH_COVERAGE = 80;
const SOURCE = /^(app|lib|components)\/.+\.(ts|tsx)$/;
const EXCLUDED = [/^app\/api\//, /\.d\.ts$/, /\.test\.tsx?$/];

export type FileCoverage = {
  statementMap: Record<string, { start: { line: number } }>;
  s: Record<string, number>;
};

export function isGated(file: string): boolean {
  return SOURCE.test(file) && !EXCLUDED.some((re) => re.test(file));
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

export function patchCoverage(
  added: Map<string, Set<number>>,
  coverage: Record<string, FileCoverage>,
  root: string,
): PatchResult {
  const byRelPath = new Map<string, FileCoverage>();
  for (const [abs, fc] of Object.entries(coverage)) byRelPath.set(path.relative(root, abs), fc);

  let covered = 0;
  let total = 0;
  const uncovered = new Map<string, number[]>();
  for (const [file, lines] of added) {
    if (!isGated(file)) continue;
    const fc = byRelPath.get(file);
    // executable line -> was any statement starting on it run?
    const executable = new Map<number, boolean>();
    if (fc) {
      for (const [id, stmt] of Object.entries(fc.statementMap)) {
        const line = stmt.start.line;
        executable.set(line, (executable.get(line) ?? false) || fc.s[id] > 0);
      }
    }
    const missed: number[] = [];
    for (const line of [...lines].sort((a, b) => a - b)) {
      if (fc) {
        const hit = executable.get(line);
        if (hit === undefined) continue; // blank, comment, type-only: not executable
        total++;
        if (hit) covered++;
        else missed.push(line);
      }
    }
    // A new file the suite never imported has no entry at all: every line counts as missed.
    if (!fc) {
      total += lines.size;
      missed.push(...[...lines].sort((a, b) => a - b));
    }
    if (missed.length) uncovered.set(file, missed);
  }
  return { covered, total, uncovered };
}

type Area = { covered: number; total: number };

/** Executable lines covered per area: first path segment, or the route group under app/. */
export function areaCoverage(coverage: Record<string, FileCoverage>, root: string): Map<string, Area> {
  const areas = new Map<string, Area>();
  for (const [abs, fc] of Object.entries(coverage)) {
    const rel = path.relative(root, abs);
    const parts = rel.split("/");
    const key = parts[0] === "app" && parts.length > 2 ? `app/${parts[1]}` : parts[0];
    const lines = new Map<number, boolean>();
    for (const [id, stmt] of Object.entries(fc.statementMap)) {
      lines.set(stmt.start.line, (lines.get(stmt.start.line) ?? false) || fc.s[id] > 0);
    }
    const area = areas.get(key) ?? { covered: 0, total: 0 };
    area.total += lines.size;
    area.covered += [...lines.values()].filter(Boolean).length;
    areas.set(key, area);
  }
  return areas;
}

const pct = (a: { covered: number; total: number }) => (a.total === 0 ? 100 : (100 * a.covered) / a.total);

export function renderReport(
  name: string,
  areas: Map<string, Area>,
  patch: { result: PatchResult; passed: boolean; skipped: boolean } | null,
): string {
  const all = [...areas.values()].reduce(
    (sum, a) => ({ covered: sum.covered + a.covered, total: sum.total + a.total }),
    { covered: 0, total: 0 },
  );
  const out = [`### Coverage: ${name} tests`, ""];
  if (patch) {
    const { result, passed, skipped } = patch;
    const icon = skipped ? "⏭️" : passed ? "✅" : "❌";
    out.push(
      `**New lines: ${icon} ${pct(result).toFixed(1)}%** (${result.covered} of ${result.total} new executable lines covered; ${MIN_PATCH_COVERAGE}% required${skipped ? ", check skipped by label" : ""}). \`app/api/**\` is not counted.`,
    );
    if (result.uncovered.size) {
      out.push("", "| File | Uncovered new lines |", "|---|---|");
      for (const [file, lines] of result.uncovered) out.push(`| \`${file}\` | ${lines.join(", ")} |`);
    }
    out.push("");
  }
  out.push("| Area | Lines covered | |", "|---|--:|--:|");
  for (const [key, area] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`| \`${key}\` | ${pct(area).toFixed(1)}% | ${area.covered} / ${area.total} |`);
  }
  out.push(`| **all** | **${pct(all).toFixed(1)}%** | ${all.covered} / ${all.total} |`);
  return out.join("\n");
}

function postStickyComment(name: string, body: string): void {
  const { GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) return;
  const marker = `<!-- coverage-report:${name} -->`;
  const gh = (args: string[]) => spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  const endpoint = `repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments`;
  const list = gh([endpoint, "--paginate", "--jq", `.[] | select(.body | contains("${marker}")) | .id`]);
  const existing = list.stdout.split("\n").find(Boolean);
  const res = existing
    ? gh(["-X", "PATCH", `repos/${GITHUB_REPOSITORY}/issues/comments/${existing}`, "-f", `body=${marker}\n${body}`])
    : gh([endpoint, "-f", `body=${marker}\n${body}`]);
  if (res.status !== 0) console.warn(`Could not post the coverage comment: ${res.stderr}`);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main(): void {
  const name = arg("--name");
  const dir = arg("--dir");
  const base = arg("--patch-base");
  if (!name || !dir) throw new Error("usage: coverage-report.ts --name <label> --dir <coverage dir> [--patch-base <ref>]");

  const coverage = JSON.parse(readFileSync(path.join(dir, "coverage-final.json"), "utf8")) as Record<string, FileCoverage>;
  const areas = areaCoverage(coverage, process.cwd());

  let patch: { result: PatchResult; passed: boolean; skipped: boolean } | null = null;
  if (base) {
    const diff = spawnSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
    const result = patchCoverage(parseAddedLines(diff.stdout), coverage, process.cwd());
    const skipped = process.env.PATCH_COVERAGE_SKIP === "1";
    patch = { result, skipped, passed: skipped || pct(result) >= MIN_PATCH_COVERAGE };
  }

  const text = renderReport(name, areas, patch);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  postStickyComment(name, text);
  if (patch && !patch.passed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
