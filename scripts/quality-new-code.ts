#!/usr/bin/env npx tsx
// Keeps only the code-quality findings that sit on lines a change added. REPORT ONLY: it prints
// the counts and the findings and always exits 0.
//
//   tsx scripts/quality-new-code.ts --eslint reports/eslint-quality.json --base origin/main
//
// The ESLint JSON comes from `pnpm lint:quality` (config/eslint-quality.mjs). The added lines
// come from `git diff <base>...HEAD`, parsed by the same helper the coverage gate uses
// (scripts/added-lines.ts). Gating on touched code later means turning the findings this prints
// into a failing exit code; nothing here does that yet.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAddedLines } from "./added-lines";

/** The rules config/eslint-quality.mjs turns on; any other message in the JSON is not a quality finding. */
export const QUALITY_RULES = [
  "complexity",
  "max-depth",
  "max-params",
  "max-nested-callbacks",
  "sonarjs/cognitive-complexity",
  "sonarjs/no-duplicated-branches",
  "sonarjs/no-identical-functions",
  "sonarjs/no-all-duplicated-branches",
  "sonarjs/no-identical-conditions",
];

export type EslintMessage = { ruleId: string | null; line?: number; endLine?: number; message: string };
export type EslintFileResult = { filePath: string; messages: EslintMessage[] };
export type Finding = { file: string; line: number; ruleId: string; message: string };

/** Every quality finding in ESLint's JSON output, with paths relative to `root`. */
export function qualityFindings(results: EslintFileResult[], root: string): Finding[] {
  const out: Finding[] = [];
  for (const r of results) {
    const file = path.relative(root, r.filePath).split(path.sep).join("/");
    for (const m of r.messages) {
      if (!m.ruleId || !QUALITY_RULES.includes(m.ruleId) || m.line === undefined) continue;
      out.push({ file, line: m.line, ruleId: m.ruleId, message: m.message });
    }
  }
  return out;
}

/**
 * The findings whose reported start line is one the change added. ESLint reports a function-level
 * finding on the function head, so a function with a new body but an old signature is not caught
 * (a deliberate simplification: "added lines", the same notion the coverage gate uses).
 */
export function findingsOnAddedLines(findings: Finding[], added: Map<string, Set<number>>): Finding[] {
  return findings.filter((f) => added.get(f.file)?.has(f.line));
}

/** Count of findings per rule, most frequent first. */
export function countByRule(findings: Finding[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Count of findings per file, most frequent first. */
export function countByFile(findings: Finding[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.file, (counts.get(f.file) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Markdown for the findings on new code. */
export function renderNewCode(findings: Finding[], base: string): string {
  if (findings.length === 0) return `No quality findings on lines added since \`${base}\`.\n`;
  const lines = [`${findings.length} quality finding(s) on lines added since \`${base}\` (report only):`, ""];
  for (const [rule, n] of countByRule(findings)) lines.push(`- \`${rule}\`: ${n}`);
  lines.push("");
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const f of sorted) lines.push(`- \`${f.file}:${f.line}\` \`${f.ruleId}\`: ${f.message}`);
  return lines.join("\n") + "\n";
}

/** Reads the ESLint JSON and the diff against `base`, returns the findings on added lines. */
export function newCodeFindings(eslintPath: string, base: string, root = process.cwd()): Finding[] {
  const results = JSON.parse(readFileSync(eslintPath, "utf8")) as EslintFileResult[];
  const diff = spawnSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AM", `${base}...HEAD`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`);
  return findingsOnAddedLines(qualityFindings(results, root), parseAddedLines(diff.stdout));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main(): void {
  const eslintPath = arg("--eslint");
  const base = arg("--base");
  if (!eslintPath || !base) {
    console.error("usage: quality-new-code.ts --eslint <eslint json> --base <ref>");
    return;
  }
  // Report only: a tooling problem is printed, never an exit code.
  try {
    process.stdout.write(renderNewCode(newCodeFindings(eslintPath, base), base));
  } catch (err) {
    console.error(`quality-new-code: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
