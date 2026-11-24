import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import appConfig from "@/config/app";
import {
  OSV_SCANNER_PATH,
  VEX_CONTEXT,
  VEX_PATH,
  buildVex,
  parseAcceptedFindings,
  productPurl,
  readPrevious,
  renderVex,
  statementFor,
  type VexDocument,
} from "@/scripts/vex";

const ROOT = path.resolve(__dirname, "../..");
const toml = readFileSync(path.join(ROOT, OSV_SCANNER_PATH), "utf8");
const committed = JSON.parse(readFileSync(path.join(ROOT, VEX_PATH), "utf8")) as VexDocument;
const NOW = new Date("2030-01-02T03:04:05.000Z");
const STATUSES = ["not_affected", "affected", "under_investigation", "fixed"];
const JUSTIFICATIONS = [
  "component_not_present",
  "vulnerable_code_not_present",
  "vulnerable_code_not_in_execute_path",
  "vulnerable_code_cannot_be_controlled_by_adversary",
  "inline_mitigations_already_exist",
];

describe("OpenVEX document", () => {
  it("is current with config/osv-scanner.toml (run pnpm vex)", () => {
    const rebuilt = buildVex(parseAcceptedFindings(toml), readPrevious(ROOT), NOW);
    expect(renderVex(rebuilt), `${VEX_PATH} is out of date: run pnpm vex`).toBe(readFileSync(path.join(ROOT, VEX_PATH), "utf8"));
  });

  it("has one valid statement for every accepted finding", () => {
    const findings = parseAcceptedFindings(toml);
    expect(findings.length).toBeGreaterThan(0);
    expect(committed["@context"]).toBe(VEX_CONTEXT);
    expect(committed.statements.map((s) => s.vulnerability.name)).toEqual(findings.map((f) => f.id));
    for (const s of committed.statements) {
      expect(STATUSES).toContain(s.status);
      expect(s.products[0].identifiers.purl).toBe(productPurl());
      expect(Number.isNaN(Date.parse(s.timestamp))).toBe(false);
      if (s.status === "not_affected") {
        expect(JUSTIFICATIONS).toContain(s.justification);
        expect(s.impact_statement).toBeTruthy();
      }
      if (s.status === "affected") expect(s.action_statement).toBeTruthy();
    }
  });

  it("names the product from the configured repository", () => {
    expect(productPurl()).toBe(`pkg:github/${appConfig.repository.owner}/${appConfig.repository.name}`);
  });
});

describe("statementFor", () => {
  const base = { id: "GHSA-test", ignoreUntil: "2030-06-01" };

  it("maps a dev-only reason to not_affected with a justification", () => {
    const s = statementFor({ ...base, reason: "Dev-only dependency, not in the production build." });
    expect(s.status).toBe("not_affected");
    expect(s.justification).toBe("component_not_present");
  });

  it("maps a no-fix reason to affected with an action statement", () => {
    const s = statementFor({ ...base, reason: "No fix published; reachable from the app." });
    expect(s.status).toBe("affected");
    expect(s.action_statement).toContain("No fixed version");
  });

  it("refuses a reason that supports no status", () => {
    expect(() => statementFor({ ...base, reason: "Looks harmless." })).toThrow(/supports no VEX status/);
  });
});

describe("parseAcceptedFindings", () => {
  it("reads entries and rejects ones that miss a field or a line it cannot read", () => {
    const ok = '[[IgnoredVulns]]\nid = "A"\nignoreUntil = 2027-01-01\nreason = "r \\"q\\""\n';
    expect(parseAcceptedFindings(`# c\n${ok}`)).toEqual([{ id: "A", ignoreUntil: "2027-01-01", reason: 'r "q"' }]);
    expect(() => parseAcceptedFindings('[[IgnoredVulns]]\nid = "A"\n')).toThrow(/no ignoreUntil/);
    expect(() => parseAcceptedFindings("[[PackageOverrides]]\nname = [1]\n")).toThrow(/cannot read/);
  });
});

describe("buildVex", () => {
  const findings = [{ id: "A", ignoreUntil: "2027-01-01", reason: "Not in the production build." }];

  it("keeps the previous document when nothing changed", () => {
    const first = buildVex(findings, null, new Date("2029-01-01T00:00:00Z"));
    expect(first.version).toBe(1);
    expect(buildVex(findings, first, NOW)).toBe(first);
  });

  it("bumps the version and the changed statement's timestamp only", () => {
    const first = buildVex([...findings, { id: "B", ignoreUntil: "2027-01-01", reason: "No fix published." }], null, new Date("2029-01-01T00:00:00Z"));
    const next = buildVex([findings[0], { id: "B", ignoreUntil: "2027-02-02", reason: "No fix published." }], first, NOW);
    expect(next.version).toBe(2);
    expect(next.timestamp).toBe(first.timestamp);
    expect(next.statements[0].timestamp).toBe(first.statements[0].timestamp);
    expect(next.statements[1].timestamp).toBe(NOW.toISOString());
  });
});
