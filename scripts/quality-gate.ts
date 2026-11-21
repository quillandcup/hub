#!/usr/bin/env npx tsx
// The code-quality GATE: fails (exit 1) on new problems only, never on the backlog.
//
//   tsx scripts/quality-gate.ts [--base origin/main]      (pnpm quality:gate)
//
// 1. ESLint: `sonarjs/no-identical-functions` and `sonarjs/no-all-duplicated-branches` (the rules
//    in eslint.quality.config.mjs) fail when they fire on a line the change ADDED. The same finding
//    on an untouched line is the old backlog and does not fail. Same notion of "added lines" as
//    the coverage gate (scripts/added-lines.ts).
// 2. knip: an unused file or an unused / unlisted dependency (also binaries, unresolved imports)
//    that is not in knip-baseline.json fails, and a baseline entry that is no longer a finding
//    fails too, so the list only shrinks (like LUCIDE_BASELINE in tests/lib/icons.test.ts).
//
// Everything else the report tools show (complexity, depth, params, clones, unused exports and
// types) stays report-only: see scripts/quality-report.ts.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAddedLines } from "./added-lines";
import { qualityFindings, type EslintFileResult, type Finding } from "./quality-new-code";

/** ESLint rules that fail the gate when they fire on an added line. */
export const GATE_RULES = ["sonarjs/no-identical-functions", "sonarjs/no-all-duplicated-branches"];

/** knip issue kinds that fail the gate (anything not in the baseline). Exports and types stay report-only. */
export const KNIP_GATE_KINDS = ["files", "dependencies", "devDependencies", "optionalPeerDependencies", "unlisted", "binaries", "unresolved"];

export const BASELINE_FILE = "knip-baseline.json";

export type KnipItem = { name: string; line?: number };
export type KnipReport = { issues: ({ file: string } & Record<string, unknown>)[] };
export type KnipFinding = { key: string; kind: string; file: string; name: string; line?: number };
export type Baseline = { entries: string[] };

/** The stable id of a knip finding, as written in knip-baseline.json. */
export function knipKey(kind: string, file: string, name: string): string {
  return kind === "files" ? `files:${name}` : `${kind}:${file}:${name}`;
}

/** The gated knip findings (unused files and dependency problems) in knip's JSON report. */
export function knipGateFindings(report: KnipReport): KnipFinding[] {
  const out: KnipFinding[] = [];
  for (const issue of report.issues) {
    for (const kind of KNIP_GATE_KINDS) {
      const list = issue[kind];
      if (!Array.isArray(list)) continue;
      for (const item of list as KnipItem[]) {
        out.push({ key: knipKey(kind, issue.file, item.name), kind, file: issue.file, name: item.name, line: item.line });
      }
    }
  }
  return out;
}

/** What is new (not in the baseline) and what is stale (in the baseline, no longer a finding). */
export function compareToBaseline(findings: KnipFinding[], baseline: Baseline): { added: KnipFinding[]; stale: string[] } {
  const known = new Set(baseline.entries);
  const current = new Set(findings.map((f) => f.key));
  return {
    added: findings.filter((f) => !known.has(f.key)),
    stale: baseline.entries.filter((e) => !current.has(e)),
  };
}

/** The gated ESLint findings that sit on a line the change added. */
export function eslintGateFindings(results: EslintFileResult[], root: string, added: Map<string, Set<number>>): Finding[] {
  return qualityFindings(results, root).filter((f) => GATE_RULES.includes(f.ruleId) && added.get(f.file)?.has(f.line));
}

export type GateInput = {
  /** ESLint JSON results for the changed files. */
  eslint: EslintFileResult[];
  added: Map<string, Set<number>>;
  knip: KnipReport;
  baseline: Baseline;
  root: string;
};

/** Failure lines to print (each with how to fix it); empty means the gate passes. */
export function gateProblems(input: GateInput): string[] {
  const problems: string[] = [];
  for (const f of eslintGateFindings(input.eslint, input.root, input.added)) {
    problems.push(
      `${f.file}:${f.line}  ${f.ruleId}: ${f.message}\n` +
        `    Fix: remove the duplication (share one function or branch).\n` +
        `    Intentional exception: add \`// eslint-disable-next-line ${f.ruleId} -- <reason>\` on the line above.`,
    );
  }
  const { added, stale } = compareToBaseline(knipGateFindings(input.knip), input.baseline);
  for (const f of added) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    problems.push(
      `${where}  knip ${f.kind}: ${f.name}\n` +
        `    Fix: delete the file or dependency, or declare the dependency in package.json.\n` +
        `    Intentional exception: add it to \`ignore\` / \`ignoreDependencies\` / \`ignoreBinaries\` in knip.json (not to ${BASELINE_FILE}, which only shrinks).`,
    );
  }
  for (const key of stale) {
    problems.push(`${BASELINE_FILE}  stale entry: ${key}\n    Fix: delete this line from ${BASELINE_FILE}; it is no longer a finding, so the list only shrinks.`);
  }
  return problems;
}

/** Source files a change added or modified that ESLint can lint. */
export function lintableFiles(added: Map<string, Set<number>>): string[] {
  return [...added.keys()].filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
}

function run(cmd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function addedLines(base: string): Map<string, Set<number>> {
  const diff = run("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`]);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  return parseAddedLines(diff.stdout);
}

function eslintOn(files: string[]): EslintFileResult[] {
  if (files.length === 0) return [];
  const r = run("pnpm", ["exec", "eslint", "-c", "eslint.quality.config.mjs", "--no-warn-ignored", "-f", "json", ...files]);
  // ESLint exits 1 for errors; the quality rules are warnings, so anything but JSON is a tooling failure.
  try {
    return JSON.parse(r.stdout) as EslintFileResult[];
  } catch {
    throw new Error(`eslint produced no JSON (exit ${r.status}): ${r.stderr.slice(0, 500)}`);
  }
}

function knipReport(): KnipReport {
  // knip exits 1 when it finds anything, which is the normal case here.
  const r = run("pnpm", ["exec", "knip", "--reporter", "json"]);
  try {
    return JSON.parse(r.stdout) as KnipReport;
  } catch {
    throw new Error(`knip produced no JSON (exit ${r.status}): ${r.stderr.slice(0, 500)}`);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

export type GateDeps = {
  addedLines: (base: string) => Map<string, Set<number>>;
  eslintOn: (files: string[]) => EslintFileResult[];
  knipReport: () => KnipReport;
  readBaseline: () => Baseline;
  root: string;
};

/** Runs the gate; `code` is the process exit code (1 on any problem or tooling failure). */
export function runGate(deps: GateDeps, base: string): { code: number; out: string } {
  try {
    const added = deps.addedLines(base);
    const problems = gateProblems({
      eslint: deps.eslintOn(lintableFiles(added)),
      added,
      knip: deps.knipReport(),
      baseline: deps.readBaseline(),
      root: deps.root,
    });
    if (problems.length === 0) return { code: 0, out: `Code quality gate passed (lines added since ${base}).` };
    const list = problems.map((p) => `- ${p}`).join("\n\n");
    return { code: 1, out: `Code quality gate FAILED: ${problems.length} problem(s).\n\n${list}` };
  } catch (err) {
    // A broken tool must not look like a pass.
    return { code: 1, out: `quality-gate: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function main(): number {
  const root = process.cwd();
  const { code, out } = runGate(
    {
      addedLines,
      eslintOn,
      knipReport,
      readBaseline: () => JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8")) as Baseline,
      root,
    },
    arg("--base") ?? "origin/main",
  );
  (code === 0 ? console.log : console.error)(out);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
