#!/usr/bin/env npx tsx
// Fails when too few of a PR's new executable lines are covered by the unit suite.
//
//   tsx scripts/check-patch-coverage.ts <base-ref>
//
// Reads the lines `git diff <base-ref>...HEAD` added, intersects them with the executable
// lines in coverage/unit/coverage-final.json (istanbul format; a line is executable when a
// statement starts on it, covered when one of those statements ran), and exits 1 below
// MIN_PATCH_COVERAGE. CI runs it in the test-unit job after `npm run test:unit:coverage`.
//
// app/api/** is excluded: its routes are exercised by db tests that call a separate Next
// server process, which v8 can't instrument, so the unit suite would always report 0%.
// Set PATCH_COVERAGE_SKIP=1 to skip (CI does when the PR has the skip-patch-coverage label).

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_PATCH_COVERAGE = 80;
const COVERAGE_FILE = "coverage/unit/coverage-final.json";
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

function summary(result: PatchResult, passed: boolean): string {
  const pct = result.total === 0 ? 100 : (100 * result.covered) / result.total;
  const out = [
    `### Patch coverage (unit tests): ${passed ? "✅" : "❌"} ${pct.toFixed(1)}%`,
    "",
    `${result.covered} of ${result.total} new executable lines covered; required ${MIN_PATCH_COVERAGE}%. \`app/api/**\` is excluded (covered by db tests the unit run can't see).`,
  ];
  if (result.uncovered.size) {
    out.push("", "| File | Uncovered new lines |", "|---|---|");
    for (const [file, lines] of result.uncovered) out.push(`| \`${file}\` | ${lines.join(", ")} |`);
  }
  return out.join("\n");
}

function main(): void {
  if (process.env.PATCH_COVERAGE_SKIP === "1") {
    console.log("Patch coverage check skipped (skip-patch-coverage label).");
    return;
  }
  const base = process.argv[2];
  if (!base) throw new Error("usage: check-patch-coverage.ts <base-ref>");

  const diff = spawnSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);

  const coverage = JSON.parse(readFileSync(COVERAGE_FILE, "utf8")) as Record<string, FileCoverage>;
  const result = patchCoverage(parseAddedLines(diff.stdout), coverage, process.cwd());
  const pct = result.total === 0 ? 100 : (100 * result.covered) / result.total;
  const passed = pct >= MIN_PATCH_COVERAGE;

  const text = summary(result, passed);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  if (!passed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
