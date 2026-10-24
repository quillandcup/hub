/**
 * Writes demo/baseline.json from the findings of the last capture run: the page problems that are known today
 * (and listed in docs/TODO.md to fix), so a run fails only on a NEW one. Run it after a capture with
 * `DEMO_CHECKS=report` (so nothing fails first), review the diff, and commit it:
 *
 *   DEMO_CHECKS=report pnpm demo:capture --grep-invert @published && pnpm demo:baseline
 *
 * Fixing a problem and re-running this shrinks the file; it should only ever grow with a reason.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Baseline, Finding } from "./checks";

export function buildBaseline(outDir: string): Baseline {
  const baseline: Baseline = {};
  const dirs = (dir: string) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  for (const scene of dirs(outDir)) {
    for (const project of dirs(path.join(outDir, scene))) {
      for (const file of readdirSync(path.join(outDir, scene, project)).filter((f) => f.endsWith(".findings.json"))) {
        const findings = JSON.parse(readFileSync(path.join(outDir, scene, project, file), "utf8")) as Finding[];
        if (findings.length === 0) continue;
        const step = file.replace(/\.findings\.json$/, "");
        (baseline[project] ??= {})[`${scene}/${step}`] = [...new Set(findings.map((f) => f.key))].sort();
      }
    }
  }
  // Sorted at every level, so the file's diff shows what changed and nothing else.
  return Object.fromEntries(
    Object.keys(baseline)
      .sort()
      .map((project) => [project, Object.fromEntries(Object.keys(baseline[project]).sort().map((step) => [step, baseline[project][step]]))]),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = buildBaseline(path.join("demo", "out"));
  writeFileSync(path.join("demo", "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  const keys = Object.values(baseline).flatMap((steps) => Object.values(steps)).reduce((n, k) => n + k.length, 0);
  console.log(`demo/baseline.json: ${keys} known findings across ${Object.keys(baseline).length} sizes and themes`);
}
