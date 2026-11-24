// Compares the results of OpenSSF's `pvtr-github-repo-scanner` with config/pvtr-baseline.json.
//
//   pnpm check:pvtr <path to the scanner's results json>   exits 1 when a control is worse than its baseline
//
// Run by .github/workflows/pvtr-scan.yml (informational, never a required check). The scanner has no way to accept a
// known result, so the comparison is ours. Per control, the baseline holds the result we expect; a control with no entry
// is expected to Pass. It is a finding when:
//   - a control is worse than its baseline (Passed < Not Applicable < Needs Review < Failed),
//   - a baseline entry that is not Passed has expired (or has no reason or expiry date),
//   - the results file is missing, unreadable or empty (the scan itself failed).
// A control that got better is only listed, with a reminder to update the baseline.
import { appendFileSync, readFileSync } from "node:fs";
import { orgToday } from "./docs-overdue";

export type BaselineEntry = { result: string | string[]; reason?: string; expires?: string };
export type Baseline = { controls: Record<string, BaselineEntry> };
export type ControlResult = { result: string; message: string };
export type Change = { id: string; expected: string[]; actual: string; message: string };
export type Comparison = {
  worse: Change[];
  improved: Change[];
  expired: Array<{ id: string; expires?: string; problem: string }>;
  /** Baseline entries for controls the scan did not report (a new scanner version may drop or rename one). */
  missing: string[];
  total: number;
};

const PASSED = "Passed";
const RANK: Record<string, number> = { Passed: 0, "Not Applicable": 1, "Not Run": 1, "Needs Review": 2, Unknown: 2, Failed: 3 };
/** A result this script does not know is treated as the worst, so a renamed result word is noticed. */
const rank = (result: string): number => RANK[result] ?? 3;

export const expectedResults = (entry: BaselineEntry | undefined): string[] =>
  entry === undefined ? [PASSED] : Array.isArray(entry.result) ? entry.result : [entry.result];

/** Pulls control id -> result out of the scanner's json; a control seen twice keeps its worse result. */
export function parseResults(json: unknown): Map<string, ControlResult> {
  const found = new Map<string, ControlResult>();
  const suites = (json as { "evaluation-suites"?: unknown })["evaluation-suites"];
  if (!Array.isArray(suites)) throw new Error('The results have no "evaluation-suites" list.');
  for (const suite of suites) {
    const evaluations = suite?.["control-evaluations"]?.evaluations;
    if (!Array.isArray(evaluations)) continue;
    for (const evaluation of evaluations) {
      for (const log of evaluation?.["assessment-logs"] ?? []) {
        const id: unknown = log?.requirement?.["entry-id"];
        if (typeof id !== "string" || typeof log.result !== "string") continue;
        const message = typeof log.message === "string" ? log.message.replace(/\s+/g, " ").trim() : "";
        const previous = found.get(id);
        if (!previous || rank(log.result) > rank(previous.result)) found.set(id, { result: log.result, message });
      }
    }
  }
  if (found.size === 0) throw new Error("The results hold no controls.");
  return found;
}

export function compare(baseline: Baseline, actual: Map<string, ControlResult>, today: string): Comparison {
  const worse: Change[] = [];
  const improved: Change[] = [];
  for (const [id, { result, message }] of [...actual].sort(([a], [b]) => a.localeCompare(b))) {
    const expected = expectedResults(baseline.controls[id]);
    if (expected.includes(result)) continue;
    const change = { id, expected, actual: result, message };
    if (rank(result) > Math.max(...expected.map(rank))) worse.push(change);
    else if (rank(result) < Math.min(...expected.map(rank))) improved.push(change);
  }
  const expired: Comparison["expired"] = [];
  for (const [id, entry] of Object.entries(baseline.controls)) {
    if (expectedResults(entry).every((r) => r === PASSED)) continue;
    if (!entry.reason?.trim()) expired.push({ id, expires: entry.expires, problem: "has no reason" });
    if (!entry.expires || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) expired.push({ id, expires: entry.expires, problem: "has no expiry date" });
    else if (entry.expires < today) expired.push({ id, expires: entry.expires, problem: `expired ${entry.expires}` });
  }
  const missing = Object.keys(baseline.controls).filter((id) => !actual.has(id)).sort();
  return { worse, improved, expired, missing, total: actual.size };
}

export function summarize(c: Comparison): string {
  const lines = [`## OpenSSF baseline scan`, "", `${c.total} controls compared with config/pvtr-baseline.json.`, ""];
  const table = (title: string, rows: Change[]) => {
    if (rows.length === 0) return;
    lines.push(`### ${title}`, "", "| Control | Baseline | Now | Scanner message |", "|---|---|---|---|");
    for (const r of rows) lines.push(`| ${r.id} | ${r.expected.join(" or ")} | ${r.actual} | ${r.message.slice(0, 200).replace(/\|/g, "/")} |`);
    lines.push("");
  };
  table("Worse than the baseline", c.worse);
  if (c.expired.length > 0) {
    lines.push("### Baseline entries to renew or fix", "");
    for (const e of c.expired) lines.push(`- ${e.id}: ${e.problem}`);
    lines.push("");
  }
  table("Better than the baseline (update config/pvtr-baseline.json, nothing failed)", c.improved);
  if (c.missing.length > 0) lines.push(`Baseline entries the scan did not report: ${c.missing.join(", ")}.`, "");
  if (c.worse.length + c.expired.length + c.improved.length === 0) lines.push("Every control is as the baseline expects.", "");
  return lines.join("\n");
}

function main(): void {
  const resultsPath = process.argv[2];
  if (!resultsPath) throw new Error("Usage: pnpm check:pvtr <results json>");
  const actual = parseResults(JSON.parse(readFileSync(resultsPath, "utf8")));
  // Every control and its result: ids and result words only, so a baseline can be written from the log.
  for (const [id, { result }] of [...actual].sort(([a], [b]) => a.localeCompare(b))) console.log(`pvtr-result ${id} ${result}`);
  const baseline = JSON.parse(readFileSync("config/pvtr-baseline.json", "utf8")) as Baseline;
  const comparison = compare(baseline, actual, orgToday());
  const text = summarize(comparison);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exitCode = comparison.worse.length + comparison.expired.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith("pvtr-scan.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`pvtr-scan: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
