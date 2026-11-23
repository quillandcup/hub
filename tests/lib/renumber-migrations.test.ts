import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextVersion, planRenumber, renumber, updateReferences } from "@/scripts/renumber-migrations";

const base = ["20261101000000_a.sql", "20261120000000_b.sql"];

describe("nextVersion", () => {
  it("adds a second, carrying over minute, day and year, and skips taken versions", () => {
    expect(nextVersion("20261120000000", new Set())).toBe("20261120000001");
    expect(nextVersion("20261231235959", new Set())).toBe("20270101000000");
    expect(nextVersion("20261120000000", new Set(["20261120000001"]))).toBe("20261120000002");
  });
});

describe("planRenumber", () => {
  it("has nothing to do when every added migration is newer", () => {
    expect(planRenumber(base, [...base, "20261122000000_c.sql"])).toEqual([]);
    expect(planRenumber(base, base)).toEqual([]);
  });

  it("renames a stale migration to the next version after main's latest, keeping the name", () => {
    expect(planRenumber(base, [...base, "20261110000000_late_one.sql"])).toEqual([
      { from: "20261110000000_late_one.sql", to: "20261120000001_late_one.sql", bareVersion: true },
    ]);
  });

  it("keeps the order of several stale migrations", () => {
    const renames = planRenumber(base, [...base, "20261112000000_second.sql", "20261110000000_first.sql"]);
    expect(renames.map((r) => r.to)).toEqual(["20261120000001_first.sql", "20261120000002_second.sql"]);
  });

  it("renumbers a later migration that would otherwise end up before a renamed one", () => {
    const renames = planRenumber(base, [...base, "20261110000000_first.sql", "20261120000001_second.sql"]);
    expect(renames).toHaveLength(2);
    expect(renames[0].to < renames[1].to).toBe(true);
    expect(renames[0].to > "20261120000000").toBe(true);
  });

  it("leaves a newer one alone when only an earlier one is stale", () => {
    const renames = planRenumber(base, [...base, "20261110000000_first.sql", "20261125000000_second.sql"]);
    expect(renames.map((r) => r.from)).toEqual(["20261110000000_first.sql"]);
  });

  it("does not replace the bare version when main has another migration with it", () => {
    const [rename] = planRenumber(base, [...base, "20261120000000_clash.sql"]);
    expect(rename.bareVersion).toBe(false);
  });

  it("steps past open PRs' and other worktrees' migrations, but not its own file", () => {
    const local = [...base, "20261121000000_mine.sql"];
    expect(planRenumber(base, local, ["20261121000000_mine.sql"])).toEqual([]);
    const renames = planRenumber(base, local, ["20261121000000_theirs.sql", "20261123000000_other.sql"]);
    expect(renames.map((r) => r.to)).toEqual(["20261123000001_mine.sql"]);
  });

  it("ignores badly named files", () => {
    expect(planRenumber(base, [...base, "notes.sql"])).toEqual([]);
  });
});

describe("updateReferences", () => {
  const rename = { from: "20261110000000_late.sql", to: "20261120000001_late.sql", bareVersion: true };

  it("replaces the version and the file name, whole numbers only", () => {
    const text = "see 20261110000000_late.sql and version 20261110000000; id 120261110000000 and 202611100000009 stay";
    expect(updateReferences(text, [rename])).toBe(
      "see 20261120000001_late.sql and version 20261120000001; id 120261110000000 and 202611100000009 stay",
    );
  });

  it("replaces only the file name when the bare version belongs to another migration too", () => {
    const text = "20261110000000_late.sql and 20261110000000_other.sql, 20261110000000";
    expect(updateReferences(text, [{ ...rename, bareVersion: false }])).toBe(
      "20261120000001_late.sql and 20261110000000_other.sql, 20261110000000",
    );
  });
});

describe("renumber (temporary git repo)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const write = (root: string, file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };

  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), "renumber-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    git(root, "config", "commit.gpgsign", "false");
    write(root, "supabase/migrations/20261101000000_a.sql", "select 1;\n");
    write(root, "supabase/migrations/20261120000000_b.sql", "select 2;\n");
    write(root, ".gitignore", "node_modules\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "switch", "-q", "-c", "feature");
    return root;
  }

  it("does nothing on a branch whose migrations are newer", () => {
    const root = fixture();
    write(root, "supabase/migrations/20261125000000_c.sql", "select 3;\n");
    expect(renumber({ cwd: root, baseRef: "main", apply: true })).toEqual({ renames: [], changedFiles: [] });
    expect(existsSync(path.join(root, "supabase/migrations/20261125000000_c.sql"))).toBe(true);
  });

  it("dry run reports and writes nothing", () => {
    const root = fixture();
    write(root, "supabase/migrations/20261110000000_late.sql", "select 3;\n");
    write(root, "docs/notes.md", "uses 20261110000000_late.sql\n");
    const result = renumber({ cwd: root, baseRef: "main", apply: false });
    expect(result.renames).toHaveLength(1);
    expect(result.changedFiles).toEqual(["docs/notes.md"]);
    expect(existsSync(path.join(root, "supabase/migrations/20261110000000_late.sql"))).toBe(true);
    expect(readFileSync(path.join(root, "docs/notes.md"), "utf8")).toContain("20261110000000");
  });

  it("renames several files and updates a pgTAP test, docs, source and the migration itself", () => {
    const root = fixture();
    write(root, "supabase/migrations/20261110000000_first.sql", "-- 20261110000000\nselect 3;\n");
    write(root, "supabase/migrations/20261112000000_second.sql", "select 4;\n");
    write(root, "supabase/tests/database/first.test.sql", "select is((select max(version) from t), '20261110000000');\n");
    write(root, "src/lib/thing.ts", 'const v = "20261112000000_second.sql"; // not 202611120000001\n');
    write(root, "node_modules/pkg/index.js", "20261110000000\n");
    write(root, "image.bin", "20261110000000\0");
    const result = renumber({ cwd: root, baseRef: "main", apply: true });

    expect(result.renames.map((r) => r.to)).toEqual(["20261120000001_first.sql", "20261120000002_second.sql"]);
    expect(existsSync(path.join(root, "supabase/migrations/20261110000000_first.sql"))).toBe(false);
    expect(readFileSync(path.join(root, "supabase/migrations/20261120000001_first.sql"), "utf8")).toContain("-- 20261120000001");
    expect(readFileSync(path.join(root, "supabase/tests/database/first.test.sql"), "utf8")).toContain("'20261120000001'");
    expect(readFileSync(path.join(root, "src/lib/thing.ts"), "utf8")).toBe(
      'const v = "20261120000002_second.sql"; // not 202611120000001\n',
    );
    expect(readFileSync(path.join(root, "node_modules/pkg/index.js"), "utf8")).toBe("20261110000000\n");
    expect(readFileSync(path.join(root, "image.bin"), "utf8")).toBe("20261110000000\0");
    expect(result.changedFiles).not.toContain("node_modules/pkg/index.js");
  });

  it("is idempotent: a second run has nothing to do", () => {
    const root = fixture();
    write(root, "supabase/migrations/20261110000000_late.sql", "select 3;\n");
    renumber({ cwd: root, baseRef: "main", apply: true });
    expect(renumber({ cwd: root, baseRef: "main", apply: true }).renames).toEqual([]);
  });

  it("with a same-version clash, only the file name reference moves", () => {
    const root = fixture();
    write(root, "supabase/migrations/20261120000000_clash.sql", "select 3;\n");
    write(root, "docs/notes.md", "20261120000000_clash.sql replaces nothing; 20261120000000_b.sql is main's, version 20261120000000\n");
    renumber({ cwd: root, baseRef: "main", apply: true });
    expect(readFileSync(path.join(root, "docs/notes.md"), "utf8")).toBe(
      "20261120000001_clash.sql replaces nothing; 20261120000000_b.sql is main's, version 20261120000000\n",
    );
  });
});
