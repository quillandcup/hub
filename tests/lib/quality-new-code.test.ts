import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countByFile,
  countByRule,
  findingsOnAddedLines,
  newCodeFindings,
  qualityFindings,
  renderNewCode,
  type EslintFileResult,
  type Finding,
} from "../../scripts/quality-new-code";

const ROOT = "/repo";
const results: EslintFileResult[] = [
  {
    filePath: "/repo/src/lib/a.ts",
    messages: [
      { ruleId: "complexity", line: 4, message: "too complex" },
      { ruleId: "sonarjs/cognitive-complexity", line: 40, message: "too hard to read" },
      { ruleId: "@next/next/no-img-element", line: 5, message: "not a quality rule" },
      { ruleId: null, line: 6, message: "parse problem" },
      { ruleId: "max-depth", message: "no line" },
    ],
  },
  { filePath: "/repo/src/app/b.tsx", messages: [{ ruleId: "complexity", line: 1, message: "too complex" }] },
];

describe("qualityFindings", () => {
  it("keeps only the quality rules with a line, with repo-relative paths", () => {
    expect(qualityFindings(results, ROOT)).toEqual([
      { file: "src/lib/a.ts", line: 4, ruleId: "complexity", message: "too complex" },
      { file: "src/lib/a.ts", line: 40, ruleId: "sonarjs/cognitive-complexity", message: "too hard to read" },
      { file: "src/app/b.tsx", line: 1, ruleId: "complexity", message: "too complex" },
    ]);
  });
});

describe("findingsOnAddedLines", () => {
  it("keeps the findings that start on an added line and drops the rest", () => {
    const added = new Map([["src/lib/a.ts", new Set([4, 5])]]);
    const kept = findingsOnAddedLines(qualityFindings(results, ROOT), added);
    expect(kept.map((f) => `${f.file}:${f.line}`)).toEqual(["src/lib/a.ts:4"]);
  });

  it("keeps nothing for a file the change did not touch", () => {
    expect(findingsOnAddedLines(qualityFindings(results, ROOT), new Map())).toEqual([]);
  });
});

describe("counts and rendering", () => {
  const findings: Finding[] = qualityFindings(results, ROOT);

  it("counts by rule and by file, most frequent first", () => {
    expect(countByRule(findings)).toEqual([
      ["complexity", 2],
      ["sonarjs/cognitive-complexity", 1],
    ]);
    expect(countByFile(findings)).toEqual([
      ["src/lib/a.ts", 2],
      ["src/app/b.tsx", 1],
    ]);
  });

  it("renders the counts and each finding, sorted by file and line", () => {
    const md = renderNewCode(findings, "origin/main");
    expect(md).toContain("3 quality finding(s) on lines added since `origin/main`");
    expect(md).toContain("- `complexity`: 2");
    expect(md.indexOf("`src/app/b.tsx:1`")).toBeLessThan(md.indexOf("`src/lib/a.ts:4`"));
  });

  it("says so when there is nothing on new code", () => {
    expect(renderNewCode([], "origin/main")).toContain("No quality findings");
  });
});

describe("newCodeFindings", () => {
  it("reads the ESLint JSON and diffs against the base", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-"));
    const file = path.join(dir, "eslint.json");
    // HEAD...HEAD is an empty diff, so no line counts as added.
    writeFileSync(file, JSON.stringify([{ filePath: path.join(process.cwd(), "src/lib/a.ts"), messages: results[0].messages }]));
    expect(newCodeFindings(file, "HEAD")).toEqual([]);
  });

  it("throws when git cannot diff against the base", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-"));
    const file = path.join(dir, "eslint.json");
    writeFileSync(file, "[]");
    expect(() => newCodeFindings(file, "no-such-ref-anywhere")).toThrow(/git diff failed/);
  });
});
