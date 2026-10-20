import { describe, expect, it } from "vitest";
import { findMigrationProblems } from "@/scripts/check-migration-order";

const base = ["20261101000000_a.sql", "20261120000000_b.sql"];

describe("findMigrationProblems", () => {
  it("accepts a new migration newer than the base's latest", () => {
    expect(findMigrationProblems(base, [...base, "20261122000000_c.sql"])).toEqual([]);
  });

  it("accepts no new migrations", () => {
    expect(findMigrationProblems(base, base)).toEqual([]);
  });

  it("rejects a new migration older than the base's latest", () => {
    const problems = findMigrationProblems(base, [...base, "20261110000000_late.sql"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("20261110000000_late.sql");
  });

  it("rejects a new migration with the same version as the base's latest", () => {
    expect(findMigrationProblems(base, [...base, "20261120000000_other.sql"]).length).toBeGreaterThan(0);
  });

  it("rejects duplicate versions", () => {
    const problems = findMigrationProblems(base, [...base, "20261122000000_c.sql", "20261122000000_d.sql"]);
    expect(problems.some((p) => p.includes("20261122000000"))).toBe(true);
  });

  it("rejects badly named new files", () => {
    expect(findMigrationProblems(base, [...base, "2026112_short.sql"])).toHaveLength(1);
  });

  it("ignores old files already on the base, even oddly named", () => {
    const legacy = ["001_old.sql", ...base];
    expect(findMigrationProblems(legacy, [...legacy, "20261122000000_c.sql"])).toEqual([]);
  });
});
