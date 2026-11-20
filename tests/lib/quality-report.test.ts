import { describe, expect, it } from "vitest";
import { renderReport, summarizeJscpd, summarizeKnip } from "../../scripts/quality-report";

describe("summarizeKnip", () => {
  it("counts findings by kind and by file", () => {
    const s = summarizeKnip({
      issues: [
        { file: "a.ts", exports: [{ name: "x" }, { name: "y" }], types: [{ name: "T" }], files: [] },
        { file: "b.ts", exports: [{ name: "z" }], binaries: [{ name: "ignored kind" }] },
      ],
    });
    expect(s.total).toBe(4);
    expect(s.byKind).toEqual([
      ["exports", 3],
      ["types", 1],
    ]);
    expect(s.topFiles).toEqual([
      ["a.ts", 3],
      ["b.ts", 1],
    ]);
  });

  it("limits the top files", () => {
    const issues = ["a", "b", "c"].map((file) => ({ file, exports: [{ name: "x" }] }));
    expect(summarizeKnip({ issues }, 2).topFiles).toHaveLength(2);
  });
});

describe("summarizeJscpd", () => {
  it("reads the totals and counts each file once per clone", () => {
    const s = summarizeJscpd({
      statistics: { total: { clones: 2, duplicatedLines: 30, percentage: 1.5 } },
      duplicates: [
        { firstFile: { name: "a.ts" }, secondFile: { name: "b.ts" } },
        { firstFile: { name: "a.ts" }, secondFile: { name: "a.ts" } },
      ],
    });
    expect(s).toMatchObject({ total: 2, duplicatedLines: 30, percentage: 1.5 });
    expect(s.topFiles).toEqual([
      ["a.ts", 2],
      ["b.ts", 1],
    ]);
  });

  it("copes with an empty report", () => {
    expect(summarizeJscpd({})).toMatchObject({ total: 0, percentage: 0, topFiles: [] });
  });
});

describe("renderReport", () => {
  it("names a missing report instead of failing", () => {
    const md = renderReport({});
    expect(md).toContain("pnpm knip:report");
    expect(md).toContain("pnpm dup:report");
    expect(md).toContain("pnpm lint:quality");
    expect(md).not.toContain("On new code");
  });

  it("renders every section when all the parts are there", () => {
    const md = renderReport({
      knip: summarizeKnip({ issues: [{ file: "a.ts", exports: [{ name: "x" }] }] }),
      jscpd: summarizeJscpd({ statistics: { total: { clones: 1, duplicatedLines: 9, percentage: 0.5 } } }),
      eslint: { total: 2, rules: [["complexity", 2]], topFiles: [["a.ts", 2]] },
      newCode: "nothing\n",
    });
    expect(md).toContain("1 finding(s).");
    expect(md).toContain("1 clone(s), 9 duplicated line(s) (0.50%).");
    expect(md).toContain("2 warning(s).");
    expect(md).toContain("### On new code");
  });
});
