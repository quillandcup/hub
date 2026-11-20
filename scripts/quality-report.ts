#!/usr/bin/env npx tsx
// Markdown summary of the report-only code-quality tools, for the job summary and for the
// backlog count. Reads what `pnpm knip:report`, `pnpm dup:report` and `pnpm lint:quality` wrote
// to reports/, and (with --base) adds the findings on lines a change added. Always exits 0.
//
//   tsx scripts/quality-report.ts [--base origin/main] [--top 10]

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  countByFile,
  countByRule,
  newCodeFindings,
  qualityFindings,
  renderNewCode,
  type EslintFileResult,
} from "./quality-new-code";

type KnipIssue = { file: string } & Record<string, unknown>;
export type KnipReport = { issues: KnipIssue[] };
export type JscpdReport = {
  statistics?: { total?: { clones?: number; duplicatedLines?: number; lines?: number; percentage?: number } };
  duplicates?: { firstFile: { name: string }; secondFile: { name: string }; lines?: number }[];
};

/** Knip issue types that are lists of findings on a file. */
const KNIP_TYPES = ["files", "dependencies", "devDependencies", "unlisted", "unresolved", "exports", "types", "duplicates"];

export type Summary = { total: number; byKind: [string, number][]; topFiles: [string, number][] };

const sortCounts = (m: Map<string, number>, top: number): [string, number][] =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top);

/** Knip findings by kind (unused files, exports, types, dependencies...) and the files with the most. */
export function summarizeKnip(report: KnipReport, top = 10): Summary {
  const byKind = new Map<string, number>();
  const byFile = new Map<string, number>();
  let total = 0;
  for (const issue of report.issues) {
    for (const kind of KNIP_TYPES) {
      const list = issue[kind];
      if (!Array.isArray(list) || list.length === 0) continue;
      byKind.set(kind, (byKind.get(kind) ?? 0) + list.length);
      byFile.set(issue.file, (byFile.get(issue.file) ?? 0) + list.length);
      total += list.length;
    }
  }
  return { total, byKind: sortCounts(byKind, KNIP_TYPES.length), topFiles: sortCounts(byFile, top) };
}

/** jscpd clones, the share of duplicated lines, and the files that appear in the most clones. */
export function summarizeJscpd(report: JscpdReport, top = 10): Summary & { percentage: number; duplicatedLines: number } {
  const total = report.statistics?.total ?? {};
  const byFile = new Map<string, number>();
  for (const d of report.duplicates ?? []) {
    for (const name of new Set([d.firstFile.name, d.secondFile.name])) byFile.set(name, (byFile.get(name) ?? 0) + 1);
  }
  return {
    total: total.clones ?? 0,
    percentage: total.percentage ?? 0,
    duplicatedLines: total.duplicatedLines ?? 0,
    byKind: [],
    topFiles: sortCounts(byFile, top),
  };
}

const table = (rows: [string, number][], head: string): string[] =>
  rows.length === 0 ? ["_none_"] : [`| ${head} | count |`, "|---|---|", ...rows.map(([k, n]) => `| \`${k}\` | ${n} |`)];

export function renderReport(parts: {
  knip?: Summary;
  jscpd?: ReturnType<typeof summarizeJscpd>;
  eslint?: { total: number; rules: [string, number][]; topFiles: [string, number][] };
  newCode?: string;
}): string {
  const out = ["## Code quality report (report only, nothing here blocks a merge)", ""];
  out.push("### Unused code and dependencies (knip)", "");
  if (parts.knip) {
    out.push(`${parts.knip.total} finding(s).`, "", ...table(parts.knip.byKind, "kind"), "");
    out.push("Files with the most:", "", ...table(parts.knip.topFiles, "file"), "");
  } else out.push("_No knip report found; run `pnpm knip:report`._", "");
  out.push("### Duplicated code (jscpd)", "");
  if (parts.jscpd) {
    out.push(
      `${parts.jscpd.total} clone(s), ${parts.jscpd.duplicatedLines} duplicated line(s) (${parts.jscpd.percentage.toFixed(2)}%).`,
      "",
      "Files in the most clones:",
      "",
      ...table(parts.jscpd.topFiles, "file"),
      "",
    );
  } else out.push("_No jscpd report found; run `pnpm dup:report`._", "");
  out.push("### Complexity and smells (ESLint quality rules)", "");
  if (parts.eslint) {
    out.push(`${parts.eslint.total} warning(s).`, "", ...table(parts.eslint.rules, "rule"), "");
    out.push("Files with the most:", "", ...table(parts.eslint.topFiles, "file"), "");
  } else out.push("_No ESLint report found; run `pnpm lint:quality`._", "");
  if (parts.newCode) out.push("### On new code", "", parts.newCode);
  return out.join("\n");
}

function readJson<T>(file: string): T | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main(): void {
  const top = Number(arg("--top") ?? 10);
  const base = arg("--base");
  const dir = arg("--dir") ?? "reports";
  try {
    const knip = readJson<KnipReport>(path.join(dir, "knip.json"));
    const jscpd = readJson<JscpdReport>(path.join(dir, "jscpd", "jscpd-report.json"));
    const eslintPath = path.join(dir, "eslint-quality.json");
    const eslintRaw = readJson<EslintFileResult[]>(eslintPath);
    const findings = eslintRaw ? qualityFindings(eslintRaw, process.cwd()) : undefined;
    process.stdout.write(
      renderReport({
        knip: knip && summarizeKnip(knip, top),
        jscpd: jscpd && summarizeJscpd(jscpd, top),
        eslint: findings && {
          total: findings.length,
          rules: countByRule(findings),
          topFiles: countByFile(findings).slice(0, top),
        },
        newCode: base && eslintRaw ? renderNewCode(newCodeFindings(eslintPath, base), base) : undefined,
      }),
    );
  } catch (err) {
    console.error(`quality-report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
