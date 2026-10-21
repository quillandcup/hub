import { describe, expect, it } from "vitest";
import { findMigrationProblems, findProductionProblems, parseAppliedVersions } from "@/scripts/check-migration-order";

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

describe("findProductionProblems", () => {
  const applied = ["20261101000000", "20261123000200"];

  it("accepts migrations production has applied, and newer ones", () => {
    const local = ["20261101000000_a.sql", "20261123000200_b.sql", "20261125000000_c.sql"];
    expect(findProductionProblems(applied, local)).toEqual([]);
  });

  it("rejects an unapplied migration numbered below the latest applied one", () => {
    const problems = findProductionProblems(applied, ["20261101000000_a.sql", "20261122000200_late.sql", "20261123000200_b.sql"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("20261122000200_late.sql");
    expect(problems[0]).toContain("20261123000200");
  });

  it("ignores versions that only exist on production and legacy file names", () => {
    expect(findProductionProblems(["20261101000000", "20261201000000"], ["001_old.sql", "20261101000000_a.sql"])).toEqual([]);
  });

  it("accepts anything when production has applied nothing", () => {
    expect(findProductionProblems([], ["20261101000000_a.sql"])).toEqual([]);
  });
});

describe("parseAppliedVersions", () => {
  it("reads the Remote column of the CLI's table", () => {
    const table = [
      "",
      "   Local          | Remote         | Time (UTC)          ",
      "  ----------------|----------------|---------------------",
      "   20261101000000 | 20261101000000 | 2026-11-01 00:00:00 ",
      "   20261122000200 |                | 2026-11-22 00:02:00 ",
      "                  | 20261123000200 | 2026-11-23 00:02:00 ",
    ].join("\n");
    expect(parseAppliedVersions(table)).toEqual(["20261101000000", "20261123000200"]);
  });

  it("reads a table whose cells are wrapped in backticks", () => {
    const table = [" Local | Remote | Time (UTC) ", "-------|--------|-----------", " `20261101000000` | `20261101000000` | `2026-11-01 00:00:00` ", " ` ` | `20261123000200` | `2026-11-23 00:02:00` "].join("\n");
    expect(parseAppliedVersions(table)).toEqual(["20261101000000", "20261123000200"]);
  });

  it("reads the CLI's JSON form", () => {
    const json = JSON.stringify({ migrations: [{ local: "a", remote: "20261101000000" }, { local: "b", remote: "" }] });
    expect(parseAppliedVersions(json)).toEqual(["20261101000000"]);
  });
});
