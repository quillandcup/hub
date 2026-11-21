import { describe, expect, it } from "vitest";
import {
  BASELINE_FILE,
  compareToBaseline,
  eslintGateFindings,
  gateProblems,
  knipGateFindings,
  knipKey,
  lintableFiles,
  runGate,
  type Baseline,
  type GateDeps,
  type KnipReport,
} from "../../scripts/quality-gate";
import type { EslintFileResult } from "../../scripts/quality-new-code";

const ROOT = "/repo";
const added = new Map([
  ["lib/new.ts", new Set([10, 11])],
  ["README.md", new Set([1])],
]);

const eslint = (ruleId: string, line: number, file = "/repo/lib/new.ts"): EslintFileResult[] => [
  { filePath: file, messages: [{ ruleId, line, message: "duplicated" }] },
];

const knip: KnipReport = {
  issues: [
    { file: "components/Old.tsx", files: [{ name: "components/Old.tsx" }] },
    { file: "package.json", dependencies: [{ name: "left-pad", line: 7 }], exports: [{ name: "ignored" }] },
    { file: "lib/x.ts", unlisted: [{ name: "ghost" }], types: [{ name: "T" }] },
  ],
};
const baseline: Baseline = {
  entries: ["files:components/Old.tsx", "dependencies:package.json:left-pad", "unlisted:lib/x.ts:ghost"],
};

describe("eslintGateFindings", () => {
  it("fails on a gated rule on an added line", () => {
    const f = eslintGateFindings(eslint("sonarjs/no-identical-functions", 10), ROOT, added);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ file: "lib/new.ts", line: 10 });
    expect(eslintGateFindings(eslint("sonarjs/no-all-duplicated-branches", 11), ROOT, added)).toHaveLength(1);
  });

  it("passes the same finding on an untouched line", () => {
    expect(eslintGateFindings(eslint("sonarjs/no-identical-functions", 99), ROOT, added)).toEqual([]);
  });

  it("ignores report-only rules even on added lines", () => {
    expect(eslintGateFindings(eslint("complexity", 10), ROOT, added)).toEqual([]);
    expect(eslintGateFindings(eslint("sonarjs/cognitive-complexity", 10), ROOT, added)).toEqual([]);
  });
});

describe("knip baseline", () => {
  it("collects only the gated kinds", () => {
    const keys = knipGateFindings(knip).map((f) => f.key);
    expect(keys).toEqual(baseline.entries);
    expect(knipKey("files", "a", "a.ts")).toBe("files:a.ts");
  });

  it("flags a finding that is not in the baseline", () => {
    const more: KnipReport = {
      issues: [...knip.issues, { file: "components/New.tsx", files: [{ name: "components/New.tsx" }] }],
    };
    const { added: a, stale } = compareToBaseline(knipGateFindings(more), baseline);
    expect(a.map((f) => f.key)).toEqual(["files:components/New.tsx"]);
    expect(stale).toEqual([]);
  });

  it("flags a baseline entry that is no longer a finding", () => {
    const fewer: KnipReport = { issues: knip.issues.slice(0, 2) };
    expect(compareToBaseline(knipGateFindings(fewer), baseline).stale).toEqual(["unlisted:lib/x.ts:ghost"]);
  });
});

describe("gateProblems", () => {
  const clean = { eslint: [], added, knip, baseline, root: ROOT };

  it("is empty when nothing is new", () => {
    expect(gateProblems(clean)).toEqual([]);
  });

  it("explains an ESLint failure with the suppression comment", () => {
    const [p] = gateProblems({ ...clean, eslint: eslint("sonarjs/no-identical-functions", 10) });
    expect(p).toContain("lib/new.ts:10");
    expect(p).toContain("eslint-disable-next-line sonarjs/no-identical-functions");
  });

  it("explains a new knip finding, with its line when it has one", () => {
    const more: KnipReport = {
      issues: [...knip.issues, { file: "package.json", dependencies: [{ name: "extra", line: 9 }] }],
    };
    const [p] = gateProblems({ ...clean, knip: more });
    expect(p).toContain("package.json:9");
    expect(p).toContain("knip.json");
  });

  it("explains a stale baseline entry", () => {
    const [p] = gateProblems({ ...clean, baseline: { entries: [...baseline.entries, "files:gone.ts"] } });
    expect(p).toContain(BASELINE_FILE);
    expect(p).toContain("stale entry: files:gone.ts");
  });
});

describe("lintableFiles", () => {
  it("keeps source files only", () => {
    expect(lintableFiles(added)).toEqual(["lib/new.ts"]);
  });
});

describe("runGate", () => {
  const deps = (over: Partial<GateDeps> = {}): GateDeps => ({
    addedLines: () => added,
    eslintOn: () => [],
    knipReport: () => knip,
    readBaseline: () => baseline,
    root: ROOT,
    ...over,
  });

  it("exits 0 when nothing new is wrong", () => {
    const r = runGate(deps(), "origin/main");
    expect(r.code).toBe(0);
    expect(r.out).toContain("passed");
  });

  it("exits non-zero on a gated finding on an added line", () => {
    const r = runGate(deps({ eslintOn: () => eslint("sonarjs/no-identical-functions", 10) }), "origin/main");
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAILED");
  });

  it("exits 0 for the same finding on an untouched line", () => {
    const r = runGate(deps({ eslintOn: () => eslint("sonarjs/no-identical-functions", 99) }), "origin/main");
    expect(r.code).toBe(0);
  });

  it("exits non-zero on a knip finding missing from the baseline", () => {
    const r = runGate(deps({ readBaseline: () => ({ entries: baseline.entries.slice(1) }) }), "origin/main");
    expect(r.code).toBe(1);
    expect(r.out).toContain("knip");
  });

  it("exits non-zero on a stale baseline entry", () => {
    const r = runGate(deps({ readBaseline: () => ({ entries: [...baseline.entries, "files:gone.ts"] }) }), "origin/main");
    expect(r.code).toBe(1);
    expect(r.out).toContain("stale");
  });

  it("fails closed when a tool breaks", () => {
    const r = runGate(
      deps({
        knipReport: () => {
          throw new Error("knip produced no JSON");
        },
      }),
      "origin/main",
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("knip produced no JSON");
  });
});
