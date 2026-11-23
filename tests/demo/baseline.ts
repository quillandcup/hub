/**
 * The page-problem baseline, tests/demo/baseline.json: the findings that are known today (and listed in docs/TODO.md to fix),
 * per size and theme (Playwright project), page and rule, with how many of each. A run fails on a finding beyond that. It is
 * shrink-only: a listed finding that a run no longer finds on a page it opened fails too, so a fix has to lower or delete its entry.
 *
 *   pnpm demo:baseline          write it from the findings of the last capture (run with DEMO_CHECKS=report first, so nothing
 *                               fails before the files are written). It replaces what the capture saw (the sizes it ran, the pages
 *                               it opened) and keeps the rest.
 *   pnpm demo:baseline --check  compare the last capture to it, both ways (what the scheduled page-checks workflow runs after its capture: see
 *                               docs/product/DEMO_AND_HELP.md, "Page checks").
 *
 * Fixing a problem and re-running this shrinks the file; it should only ever grow with a reason, in a reviewed diff.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBaseline, tally, type Baseline, type FindingsFile, type Tally } from "./checks";

const dirs = (dir: string) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);

/** The projects (size and theme) the last capture ran, whether or not they found anything. */
function ranProjects(outDir: string): string[] {
  return dirs(outDir).flatMap((scene) => dirs(path.join(outDir, scene)));
}

/** What the last capture found: project -> page -> rule -> the distinct finding keys, across every scene and step; and the pages it opened. */
export function readFindings(outDir: string): { seen: Record<string, Tally>; visited: Record<string, Set<string>> } {
  const seen: Record<string, Tally> = {};
  const visited: Record<string, Set<string>> = {};
  for (const scene of dirs(outDir)) {
    for (const project of dirs(path.join(outDir, scene))) {
      for (const file of readdirSync(path.join(outDir, scene, project)).filter((f) => f.endsWith(".findings.json"))) {
        const content = JSON.parse(readFileSync(path.join(outDir, scene, project, file), "utf8")) as FindingsFile;
        tally(content.findings, (seen[project] ??= {}));
        for (const route of content.routes) (visited[project] ??= new Set()).add(route);
      }
    }
  }
  return { seen, visited };
}

export function buildBaseline(outDir: string, existing: Baseline = {}): Baseline {
  const baseline: Baseline = { ...existing };
  const { seen, visited } = readFindings(outDir);
  // A project the capture ran gets what it found for the pages it opened; pages it did not open, and projects it did not run, keep what they had.
  for (const project of new Set([...Object.keys(seen), ...ranProjects(outDir)])) {
    const kept = Object.fromEntries(Object.entries(existing[project] ?? {}).filter(([route]) => !visited[project]?.has(route)));
    const found = Object.fromEntries(Object.entries(seen[project] ?? {}).map(([route, rules]) => [route, Object.fromEntries(Object.entries(rules).map(([rule, keys]) => [rule, keys.size]))]));
    baseline[project] = { ...kept, ...found };
  }
  // Sorted at every level, so the file's diff shows what changed and nothing else. A project with nothing left has no entry.
  const sorted = (o: Record<string, unknown>) => Object.keys(o).sort();
  const out: Baseline = {};
  for (const project of sorted(baseline)) {
    const pages: Record<string, Record<string, number>> = {};
    for (const route of sorted(baseline[project])) pages[route] = Object.fromEntries(sorted(baseline[project][route]).map((rule) => [rule, baseline[project][route][rule]]));
    if (Object.keys(pages).length) out[project] = pages;
  }
  return out;
}

/** Problems in a full capture against the baseline, for the projects the capture ran. */
export function checkBaseline(outDir: string, baseline: Baseline): string[] {
  const problems: string[] = [];
  const { seen, visited } = readFindings(outDir);
  // A project the capture ran with no findings at all has no entry in `seen`, but may still be in the baseline.
  for (const project of new Set([...Object.keys(seen), ...ranProjects(outDir)])) {
    for (const p of compareToBaseline(seen[project] ?? {}, baseline[project], visited[project] ?? new Set())) problems.push(`${project} ${p}`);
  }
  return problems;
}

const total = (b: Baseline) => Object.values(b).flatMap((pages) => Object.values(pages)).flatMap((rules) => Object.values(rules)).reduce((n, c) => n + c, 0);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join("tests", "demo", "baseline.json");
  const outDir = path.join("tests", "demo", "out");
  const existing = JSON.parse(readFileSync(file, "utf8")) as Baseline;
  if (process.argv.includes("--check")) {
    const problems = checkBaseline(outDir, existing);
    if (problems.length) {
      console.error(`demo page checks differ from tests/demo/baseline.json (${problems.length}):\n${problems.map((p) => `  ${p}`).join("\n")}`);
      console.error("Fix a new problem, or after a fix run `DEMO_CHECKS=report pnpm demo:capture --grep-invert \"@published|@changelog\" && pnpm demo:baseline` and commit the smaller file.");
      process.exit(1);
    }
    console.log(`demo page checks match tests/demo/baseline.json (${total(existing)} known findings)`);
  } else {
    const baseline = buildBaseline(outDir, existing);
    writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`demo/baseline.json: ${total(baseline)} known findings in ${Object.keys(baseline).length} sizes and themes`);
  }
}
