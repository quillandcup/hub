import { describe, expect, it } from "vitest";
import {
  areaCoverage,
  isGated,
  mergeSuites,
  parseAddedLines,
  patchCoverage,
  renderReport,
  suiteLines,
  type FileCoverage,
  type SuiteLines,
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

function coverage(lines: Record<number, number>): FileCoverage {
  const statementMap: FileCoverage["statementMap"] = {};
  const s: FileCoverage["s"] = {};
  for (const [line, hits] of Object.entries(lines)) {
    statementMap[line] = { start: { line: Number(line) } };
    s[line] = hits;
  }
  return { statementMap, s };
}

function suite(files: Record<string, Record<number, boolean>>): SuiteLines {
  return new Map(Object.entries(files).map(([f, l]) => [f, new Map(Object.entries(l).map(([n, h]) => [Number(n), h]))]));
}

describe("parseAddedLines", () => {
  it("expands hunk ranges, defaults a missing count to 1, ignores deleted files", () => {
    const added = parseAddedLines(DIFF);
    expect([...added.keys()]).toEqual(["lib/a.ts"]);
    expect([...added.get("lib/a.ts")!]).toEqual([4, 5, 12]);
  });
});

describe("isGated", () => {
  it("gates app/lib/components sources, not API routes, tests or declarations", () => {
    expect(isGated("lib/x.ts")).toBe(true);
    expect(isGated("components/Y.tsx")).toBe(true);
    expect(isGated("app/api/process/route.ts")).toBe(false);
    expect(isGated("lib/x.test.ts")).toBe(false);
    expect(isGated("lib/x.d.ts")).toBe(false);
    expect(isGated("scripts/x.ts")).toBe(false);
  });
});

describe("suiteLines / mergeSuites", () => {
  it("reduces statements to lines, relative to the repo root", () => {
    const lines = suiteLines({ "/repo/lib/a.ts": coverage({ 1: 2, 2: 0 }) }, "/repo");
    expect(lines.get("lib/a.ts")).toEqual(new Map([[1, true], [2, false]]));
  });

  it("covers a line when any suite ran it, and unions the executable lines", () => {
    const merged = mergeSuites([
      suite({ "lib/a.ts": { 1: true, 2: false } }),
      suite({ "lib/a.ts": { 2: true, 3: false }, "lib/b.ts": { 1: false } }),
    ]);
    expect(merged.get("lib/a.ts")).toEqual(new Map([[1, true], [2, true], [3, false]]));
    expect(merged.get("lib/b.ts")).toEqual(new Map([[1, false]]));
  });
});

describe("patchCoverage", () => {
  it("counts only executable added lines and reports the missed ones", () => {
    const added = new Map([["lib/a.ts", new Set([4, 5, 6, 12])]]);
    // 4 covered, 5 not covered, 6 not executable (comment), 12 covered
    const result = patchCoverage(added, suite({ "lib/a.ts": { 4: true, 5: false, 12: true } }));
    expect(result.total).toBe(3);
    expect(result.covered).toBe(2);
    expect(result.uncovered.get("lib/a.ts")).toEqual([5]);
  });

  it("treats a new file no suite loaded as fully uncovered", () => {
    const added = new Map([["lib/new.ts", new Set([1, 2])]]);
    expect(patchCoverage(added, new Map())).toMatchObject({ total: 2, covered: 0 });
  });

  it("skips files outside the gate", () => {
    const added = new Map([["app/api/x/route.ts", new Set([1, 2, 3])]]);
    expect(patchCoverage(added, new Map())).toMatchObject({ total: 0, covered: 0 });
  });

  it("counts a line only the db suite ran as covered", () => {
    const unit = suite({ "lib/a.ts": { 1: false } });
    const db = suite({ "lib/a.ts": { 1: true } });
    const added = new Map([["lib/a.ts", new Set([1])]]);
    expect(patchCoverage(added, mergeSuites([unit, db]))).toMatchObject({ total: 1, covered: 1 });
    expect(patchCoverage(added, unit)).toMatchObject({ total: 1, covered: 0 });
  });
});

describe("areaCoverage / renderReport", () => {
  const unit = suite({ "lib/a.ts": { 1: true, 2: false }, "app/(admin)/admin/p.tsx": { 1: false } });
  const db = suite({ "lib/a.ts": { 1: true, 2: true } });

  it("groups by top-level dir, or by route group under app/", () => {
    const areas = areaCoverage(unit);
    expect(areas.get("lib")).toEqual({ covered: 1, total: 2 });
    expect(areas.get("app/(admin)")).toEqual({ covered: 0, total: 1 });
  });

  it("renders the patch result, uncovered lines and per-suite plus combined columns", () => {
    const text = renderReport(
      [
        { name: "unit", areas: areaCoverage(unit) },
        { name: "db", areas: areaCoverage(db) },
      ],
      areaCoverage(mergeSuites([unit, db])),
      {
        result: { covered: 1, total: 4, uncovered: new Map([["lib/a.ts", [2, 3, 4]]]) },
        passed: false,
        skipped: false,
      },
    );
    expect(text).toContain("❌ 25.0%");
    expect(text).toContain("| `lib/a.ts` | 2, 3, 4 |");
    expect(text).toContain("| Area | unit | db | combined |");
    expect(text).toContain("| `lib` | 50.0% (1/2) | 100.0% (2/2) | 100.0% (2/2) |");
    expect(text).toContain("| `app/(admin)` | 0.0% (0/1) | n/a | 0.0% (0/1) |");
  });
});
