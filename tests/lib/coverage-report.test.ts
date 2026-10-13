import { describe, expect, it } from "vitest";
import {
  aggregateScore,
  areaKey,
  areaMetrics,
  flags,
  isGated,
  mergeSuites,
  parseAddedLines,
  patchCoverage,
  renderReport,
  suiteHits,
  sumMetrics,
  type FileCoverage,
  type Metrics,
} from "../../scripts/coverage-report";

const DIFF = [
  "diff --git a/lib/a.ts b/lib/a.ts",
  "--- a/lib/a.ts",
  "+++ b/lib/a.ts",
  "@@ -3,0 +4,2 @@ ctx",
  "+x",
  "+y",
  "@@ -10 +12 @@",
  "+z",
  "diff --git a/lib/gone.ts b/lib/gone.ts",
  "--- a/lib/gone.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
].join("\n");

/** One statement per line, one function and branch group per `f`/`b` entry, placed by id. */
function file(
  lines: Record<number, number>,
  extra: { f?: Record<string, number>; b?: Record<string, number[]> } = {},
): FileCoverage {
  const statementMap: FileCoverage["statementMap"] = {};
  const s: FileCoverage["s"] = {};
  for (const [line, hits] of Object.entries(lines)) {
    statementMap[line] = { start: { line: Number(line), column: 0 }, end: { line: Number(line), column: 9 } };
    s[line] = hits;
  }
  const fnMap: NonNullable<FileCoverage["fnMap"]> = {};
  for (const id of Object.keys(extra.f ?? {})) fnMap[id] = { loc: { start: { line: Number(id) + 100, column: 0 } } };
  const branchMap: NonNullable<FileCoverage["branchMap"]> = {};
  for (const id of Object.keys(extra.b ?? {})) {
    branchMap[id] = { type: "if", loc: { start: { line: Number(id) + 200, column: 0 } } };
  }
  return { statementMap, s, fnMap, f: extra.f ?? {}, branchMap, b: extra.b ?? {} };
}

const suite = (files: Record<string, FileCoverage>) =>
  suiteHits(Object.fromEntries(Object.entries(files).map(([f, c]) => [`/repo/${f}`, c])), "/repo");

const m = (covered: number, total: number) => ({ covered, total });
const metrics = (lines: [number, number], statements = lines, functions = lines, branches = lines): Metrics => ({
  lines: m(...lines),
  statements: m(...statements),
  functions: m(...functions),
  branches: m(...branches),
});

describe("parseAddedLines", () => {
  it("expands hunk ranges, defaults a missing count to 1, ignores deleted files", () => {
    const added = parseAddedLines(DIFF);
    expect([...added.keys()]).toEqual(["lib/a.ts"]);
    expect([...added.get("lib/a.ts")!]).toEqual([4, 5, 12]);
  });
});

describe("isGated / areaKey", () => {
  it("gates app/lib/components/emails and the root runtime files, not API routes, tests or scripts", () => {
    expect(isGated("lib/x.ts")).toBe(true);
    expect(isGated("components/Y.tsx")).toBe(true);
    expect(isGated("emails/notifications/a.tsx")).toBe(true);
    expect(isGated("proxy.ts")).toBe(true);
    expect(isGated("app/api/process/route.ts")).toBe(false);
    expect(isGated("lib/x.test.ts")).toBe(false);
    expect(isGated("lib/x.d.ts")).toBe(false);
    expect(isGated("scripts/x.ts")).toBe(false);
    expect(isGated("next.config.ts")).toBe(false);
  });

  it("groups by top-level dir, route group under app/, and root files together", () => {
    expect(areaKey("lib/a/b.ts")).toBe("lib");
    expect(areaKey("app/(admin)/admin/p.tsx")).toBe("app/(admin)");
    expect(areaKey("proxy.ts")).toBe("(root files)");
  });
});

describe("suiteHits / mergeSuites / areaMetrics", () => {
  const unit = suite({
    "lib/a.ts": file({ 1: 1, 2: 0 }, { f: { 0: 1, 1: 0 }, b: { 0: [1, 0], 1: [0, 0] } }),
    "app/(admin)/admin/p.tsx": file({ 1: 0 }),
  });
  const db = suite({ "lib/a.ts": file({ 1: 0, 2: 1 }, { f: { 0: 0, 1: 1 }, b: { 0: [0, 1], 1: [0, 0] } }) });

  it("counts all four measures per area", () => {
    const lib = areaMetrics(unit).get("lib")!;
    expect(lib).toEqual(metrics([1, 2], [1, 2], [1, 2], [1, 4]));
    expect(areaMetrics(unit).get("app/(admin)")!.lines).toEqual(m(0, 1));
  });

  it("merges every measure by location: covered if either suite ran it, totals not doubled", () => {
    expect(areaMetrics(mergeSuites([unit, db])).get("lib")).toEqual(metrics([2, 2], [2, 2], [2, 2], [2, 4]));
  });

  it("sums areas", () => {
    expect(sumMetrics(areaMetrics(unit).values()).lines).toEqual(m(1, 3));
  });
});

describe("aggregateScore / flags", () => {
  it("is the mean of statements, functions and branches; lines are not scored", () => {
    expect(aggregateScore(metrics([2, 2], [1, 2], [1, 2], [1, 4]))).toBeCloseTo((50 + 50 + 25) / 3);
    expect(aggregateScore({ ...metrics([2, 2]), statements: m(1, 2), functions: m(0, 0), branches: m(0, 0) })).toBe(50);
  });

  it("is null, not 100, when there is nothing to score", () => {
    expect(aggregateScore(metrics([0, 0]))).toBeNull();
    expect(aggregateScore({ ...metrics([0, 0]), lines: m(3, 3) })).toBeNull();
    expect(flags(metrics([0, 0]))).toEqual([]);
  });

  it("flags an area where nothing ran", () => {
    expect(flags(metrics([0, 10]))).toEqual(["🚫 untested"]);
  });

  it("flags a fully uncovered measure that the score averages away", () => {
    expect(flags(metrics([8, 10], [8, 10], [0, 4], [8, 10]))).toEqual(["⚠️ no functions covered"]);
    expect(flags(metrics([8, 10]))).toEqual([]);
  });
});

describe("patchCoverage", () => {
  it("scores added lines plus the statements, functions and branches that start on them", () => {
    const files = mergeSuites([
      suite({
        "lib/a.ts": file({ 4: 1, 5: 0, 12: 1, 30: 0 }, { f: { 0: 0 }, b: { 0: [1, 0] } }),
      }),
    ]);
    // function 0 starts on line 100, branch 0 on 200: move the diff there
    const added = new Map([["lib/a.ts", new Set([4, 5, 6, 12, 100, 200])]]);
    const { metrics: got, uncovered } = patchCoverage(added, files);
    expect(got.lines).toEqual(m(2, 3)); // 4 covered, 5 not, 12 covered; 6/100/200 not executable
    expect(got.statements).toEqual(m(2, 3));
    expect(got.functions).toEqual(m(0, 1));
    expect(got.branches).toEqual(m(1, 2));
    expect(uncovered.get("lib/a.ts")).toEqual([5]);
  });

  it("counts a line only the db suite ran as covered", () => {
    const unit = suite({ "lib/a.ts": file({ 1: 0 }) });
    const db = suite({ "lib/a.ts": file({ 1: 1 }) });
    const added = new Map([["lib/a.ts", new Set([1])]]);
    expect(patchCoverage(added, mergeSuites([unit, db])).metrics.lines).toEqual(m(1, 1));
    expect(patchCoverage(added, unit).metrics.lines).toEqual(m(0, 1));
  });

  it("treats a new file no suite loaded as fully uncovered, and skips ungated files", () => {
    const added = new Map([
      ["lib/new.ts", new Set([1, 2])],
      ["app/api/x/route.ts", new Set([1, 2, 3])],
    ]);
    const { metrics: got } = patchCoverage(added, new Map());
    expect(got.lines).toEqual(m(0, 2));
    expect(aggregateScore(got)).toBe(0); // an unimported new file fails, it can't pass as "nothing to score"
  });
});

describe("renderReport", () => {
  const unit = suite({ "lib/a.ts": file({ 1: 1, 2: 0 }), "emails/e.tsx": file({ 1: 0 }) });
  const db = suite({ "lib/a.ts": file({ 1: 0, 2: 1 }) });
  const text = renderReport(
    [
      { name: "unit", metrics: areaMetrics(unit) },
      { name: "db", metrics: areaMetrics(db) },
    ],
    areaMetrics(mergeSuites([unit, db])),
    {
      result: { metrics: metrics([1, 4]), uncovered: new Map([["lib/a.ts", [2, 3, 4]]]) },
      passed: false,
      skipped: false,
    },
  );

  it("shows the new-code score with a percent sign, the counts and the uncovered lines", () => {
    expect(text).toContain("New code: ❌ 25.0%");
    expect(text).toContain("| 1/4 (25.0%) | 1/4 (25.0%) | 1/4 (25.0%) | 1/4 (25.0%) |");
    expect(text).toContain("| `lib/a.ts` | 2, 3, 4 |");
  });

  it("lists areas nothing tests, with a flag, instead of leaving them out", () => {
    expect(text).toContain("| `emails` | 0/1 (0.0%) | n/a | 0/1 (0.0%) | 0.0% | 🚫 untested |");
  });

  it("shows X/Y (N%) per measure in per-suite and combined tables, with a percent score", () => {
    expect(text).toContain("| Area | score | lines | statements | functions | branches |");
    expect(text).toContain("| `lib` | 100.0% | 2/2 (100.0%) | 2/2 (100.0%) | n/a | n/a |");
    expect(text).toContain("**combined**");
  });
});
