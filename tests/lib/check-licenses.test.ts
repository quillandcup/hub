import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkLicenses,
  classify,
  expressionAllowed,
  type InstalledPackage,
  type LicensePolicy,
} from "@/scripts/check-licenses";

const policy: LicensePolicy = {
  allowedProduction: ["MIT", "ISC", "Apache-2.0"],
  allowedDevelopmentOnly: ["Python-2.0"],
  exceptions: [
    { package: "weak-lib", license: "LGPL-3.0", expires: "2027-01-01", reason: "test" },
    { package: "@img/libvips-*", license: "LGPL-3.0-or-later", expires: "2027-01-01", reason: "test" },
  ],
};
const pkg = (name: string, license: string, production = true): InstalledPackage => ({ name, version: "1.0.0", license, production });

describe("expressionAllowed", () => {
  const allowed = new Set(["MIT", "ISC", "Apache-2.0"]);
  it("handles OR, AND, parentheses and WITH", () => {
    expect(expressionAllowed("MIT", allowed)).toBe(true);
    expect(expressionAllowed("(MIT OR GPL-3.0)", allowed)).toBe(true);
    expect(expressionAllowed("MIT AND ISC", allowed)).toBe(true);
    expect(expressionAllowed("MIT AND GPL-3.0", allowed)).toBe(false);
    expect(expressionAllowed("Apache-2.0 WITH LLVM-exception", allowed)).toBe(true);
    expect(expressionAllowed("GPL-3.0", allowed)).toBe(false);
  });
});

describe("classify", () => {
  it("names the kind of finding", () => {
    expect(classify("AGPL-3.0-only")).toBe("strong copyleft");
    expect(classify("GPL-2.0")).toBe("strong copyleft");
    expect(classify("SSPL-1.0")).toBe("strong copyleft");
    expect(classify("LGPL-3.0")).toBe("weak copyleft");
    expect(classify("MPL-2.0")).toBe("weak copyleft");
    expect(classify("Unknown")).toBe("no license declared");
    expect(classify("Custom-1.0")).toBe("not on the allow-list");
  });
});

describe("checkLicenses", () => {
  it("passes allowed licenses and accepts a live exception, by name or prefix", () => {
    const result = checkLicenses(policy, [pkg("a", "MIT"), pkg("weak-lib", "LGPL-3.0"), pkg("@img/libvips-linux", "LGPL-3.0-or-later")], "2026-11-23");
    expect(result.findings).toEqual([]);
    expect(result.accepted.map((a) => a.name)).toEqual(["weak-lib", "@img/libvips-linux"]);
  });

  it("flags copyleft and unknown licenses in production", () => {
    const { findings } = checkLicenses(policy, [pkg("g", "AGPL-3.0"), pkg("u", "Unknown")], "2026-11-23");
    expect(findings.map((f) => [f.name, f.kind])).toEqual([["g", "strong copyleft"], ["u", "no license declared"]]);
  });

  it("allows a development-only license only for development packages", () => {
    expect(checkLicenses(policy, [pkg("py", "Python-2.0", false)], "2026-11-23").findings).toEqual([]);
    expect(checkLicenses(policy, [pkg("py", "Python-2.0", true)], "2026-11-23").findings).toHaveLength(1);
  });

  it("makes the package a finding again once its exception expires, and only for the licensed version it names", () => {
    const expired = checkLicenses(policy, [pkg("weak-lib", "LGPL-3.0")], "2027-01-02");
    expect(expired.findings[0]).toMatchObject({ name: "weak-lib", note: "exception expired 2027-01-01" });
    expect(checkLicenses(policy, [pkg("weak-lib", "GPL-3.0")], "2026-11-23").findings).toHaveLength(1);
  });

  it("reports an exception that matches nothing", () => {
    expect(checkLicenses(policy, [pkg("a", "MIT")], "2026-11-23").unused).toHaveLength(2);
  });
});

describe("config/license-policy.json", () => {
  const real = JSON.parse(readFileSync("config/license-policy.json", "utf8")) as LicensePolicy;

  it("never allows copyleft or undeclared licenses outright", () => {
    for (const id of [...real.allowedProduction, ...real.allowedDevelopmentOnly]) {
      expect(classify(id)).not.toBe("strong copyleft");
      expect(classify(id)).not.toBe("no license declared");
    }
  });

  it("gives every exception a reason and an expiry within a year", () => {
    const limit = new Date();
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    for (const e of real.exceptions) {
      expect(e.reason.length).toBeGreaterThan(20);
      expect(e.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.expires <= limit.toISOString().slice(0, 10)).toBe(true);
    }
  });
});
