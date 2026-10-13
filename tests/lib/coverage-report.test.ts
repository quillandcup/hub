import { describe, expect, it } from "vitest";
import {
  areaCoverage,
  isGated,
  parseAddedLines,
  patchCoverage,
  renderReport,
  type FileCoverage,
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

describe("patchCoverage", () => {
  const root = "/repo";

  it("counts only executable added lines and reports the missed ones", () => {
    const added = new Map([["lib/a.ts", new Set([4, 5, 6, 12])]]);
    // 4 covered, 5 not covered, 6 not executable (comment), 12 covered
    const result = patchCoverage(added, { "/repo/lib/a.ts": coverage({ 4: 1, 5: 0, 12: 3 }) }, root);
    expect(result.total).toBe(3);
    expect(result.covered).toBe(2);
    expect(result.uncovered.get("lib/a.ts")).toEqual([5]);
  });

  it("treats a new file the suite never loaded as fully uncovered", () => {
    const added = new Map([["lib/new.ts", new Set([1, 2])]]);
    const result = patchCoverage(added, {}, root);
    expect(result).toMatchObject({ total: 2, covered: 0 });
  });

  it("skips files outside the gate", () => {
    const added = new Map([["app/api/x/route.ts", new Set([1, 2, 3])]]);
    expect(patchCoverage(added, {}, root)).toMatchObject({ total: 0, covered: 0 });
  });
});

describe("areaCoverage / renderReport", () => {
  const cov = {
    "/repo/lib/a.ts": coverage({ 1: 1, 2: 0 }),
    "/repo/app/(admin)/admin/p.tsx": coverage({ 1: 0 }),
  };

  it("groups by top-level dir, or by route group under app/", () => {
    const areas = areaCoverage(cov, "/repo");
    expect(areas.get("lib")).toEqual({ covered: 1, total: 2 });
    expect(areas.get("app/(admin)")).toEqual({ covered: 0, total: 1 });
  });

  it("renders the patch result, uncovered lines and the area table", () => {
    const text = renderReport("unit", areaCoverage(cov, "/repo"), {
      result: { covered: 1, total: 4, uncovered: new Map([["lib/a.ts", [2, 3, 4]]]) },
      passed: false,
      skipped: false,
    });
    expect(text).toContain("Coverage: unit tests");
    expect(text).toContain("❌ 25.0%");
    expect(text).toContain("| `lib/a.ts` | 2, 3, 4 |");
    expect(text).toContain("| `lib` | 50.0% | 1 / 2 |");
    expect(text).toContain("| **all** | **33.3%** | 1 / 3 |");
  });
});
