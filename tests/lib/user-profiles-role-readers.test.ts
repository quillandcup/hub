import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing in the app reads a role from `user_profiles`: a person's roles are in `user_roles` (`profiles.rolesOf`), and the old
 * `user_profiles.role` column is dropped. The SQL half of this guard is supabase/tests/database/user_roles_readers.test.sql; this is the
 * code half (and the generated types, which no longer have the column, are the type half).
 */

const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Code lines only: comment lines and the generated types are not reads.
function codeLines(path: string): Array<[number, string]> {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line, i): [number, string] => [i + 1, line])
    .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

const sources = files(SRC).filter((p) => !p.endsWith("database.types.ts"));

describe("nothing in the app reads a role from user_profiles", () => {
  it("never selects, filters or orders user_profiles by a role column", () => {
    const offenders: string[] = [];
    for (const path of sources) {
      for (const [n, line] of codeLines(path)) {
        // `.from("user_profiles")` followed on the same line by a use of a role column
        if (/from\(\s*["'`]user_profiles["'`]\s*\)/.test(line) && /\brole\b/.test(line)) offenders.push(`${path.replace(SRC, "src")}:${n}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a profile through the repository, which asks for no role column", () => {
    const profiles = readFileSync(join(SRC, "lib", "data", "profiles.ts"), "utf8");
    const selected = [...profiles.matchAll(/from\("user_profiles"\)\s*\.select\(([^)]*)\)/g)].map((m) => m[1]);
    expect(selected.length).toBeGreaterThan(0);
    for (const columns of selected) expect(columns, columns).not.toMatch(/\brole\b/);
  });

  it("has no role column in the generated types for a profile", () => {
    const types = readFileSync(join(SRC, "lib", "data", "database.types.ts"), "utf8");
    const row = /user_profiles: \{\s*Row: \{([^}]*)\}/.exec(types);
    expect(row).not.toBeNull();
    expect(row![1]).not.toMatch(/\brole\b/);
  });

  it("keeps no single-role reader of the old token claim", () => {
    const claims = readFileSync(join(SRC, "lib", "supabase", "session-claims.ts"), "utf8");
    expect(claims).not.toMatch(/export function getAppRoleFromAccessToken/);
  });
});
