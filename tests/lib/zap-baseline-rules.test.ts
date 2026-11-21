import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rules = readFileSync("config/zap-baseline.tsv", "utf8").split("\n").filter(Boolean);

describe("config/zap-baseline.tsv", () => {
  it("has tab-separated lines: a numeric rule id, a known action and a pattern or reason", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const line of rules) {
      const [id, action, rest] = line.split("\t");
      expect(id, line).toMatch(/^\d+$/);
      expect(["IGNORE", "INFO", "WARN", "FAIL", "OUTOFSCOPE"], line).toContain(action);
      expect(rest, line).toBeTruthy();
    }
  });

  it("keeps the built static files out of the cross-domain check, whatever the host is", () => {
    const scope = rules.filter((l) => l.startsWith("10098\tOUTOFSCOPE\t")).map((l) => new RegExp(l.split("\t")[2]));
    expect(scope.some((re) => re.test("https://example.test/_next/static/chunks/a.js?dpl=x"))).toBe(true);
    expect(scope.some((re) => re.test("https://example.test/manifest.webmanifest"))).toBe(true);
    expect(scope.some((re) => re.test("https://example.test/dashboard"))).toBe(false);
  });

  it("is the file the ZAP workflow reads", () => {
    expect(readFileSync(".github/workflows/zap-baseline.yml", "utf8")).toContain("rules_file_name: config/zap-baseline.tsv");
  });
});
