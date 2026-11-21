import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addedLinesDiffArgs, parseAddedLines } from "../../scripts/added-lines";

const DIFF = [
  "diff --git a/src/lib/a.ts b/src/lib/a.ts",
  "--- a/src/lib/a.ts",
  "+++ b/src/lib/a.ts",
  "@@ -3,0 +4,2 @@ ctx",
  "+x",
  "+y",
  "@@ -10 +12 @@",
  "+z",
  "diff --git a/src/lib/gone.ts b/src/lib/gone.ts",
  "--- a/src/lib/gone.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
].join("\n");

describe("parseAddedLines", () => {
  it("expands hunk ranges, defaults a missing count to 1, ignores deleted files", () => {
    const added = parseAddedLines(DIFF);
    expect([...added.keys()]).toEqual(["src/lib/a.ts"]);
    expect([...added.get("src/lib/a.ts")!]).toEqual([4, 5, 12]);
  });

  it("adds nothing for a pure deletion hunk (count 0) and for an empty diff", () => {
    expect(parseAddedLines("").size).toBe(0);
    const onlyDeleted = ["--- a/src/lib/a.ts", "+++ b/src/lib/a.ts", "@@ -5,2 +4,0 @@"].join("\n");
    expect([...(parseAddedLines(onlyDeleted).get("src/lib/a.ts") ?? [])]).toEqual([]);
  });

  it("ignores a hunk header it cannot read", () => {
    expect(parseAddedLines(["+++ b/src/lib/a.ts", "@@ nonsense @@"].join("\n")).size).toBe(0);
  });
});

describe("addedLinesDiffArgs", () => {
  // The move into src/ renamed ~1500 files: they must add nothing, and an edited one only its edited lines.
  it("follows renames, so a moved file adds no lines and a moved and edited one adds only its edits", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "added-lines-"));
    const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    try {
      run("init", "-q", "-b", "main");
      run("config", "user.email", "test@example.com");
      run("config", "user.name", "Test");
      run("config", "commit.gpgsign", "false");
      mkdirSync(path.join(dir, "lib"));
      const body = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
      writeFileSync(path.join(dir, "lib/moved.ts"), body);
      writeFileSync(path.join(dir, "lib/edited.ts"), body);
      run("add", ".");
      run("commit", "-q", "-m", "base");
      mkdirSync(path.join(dir, "src"));
      run("mv", "lib", "src/lib");
      writeFileSync(path.join(dir, "src/lib/edited.ts"), body.replace("v10 = 10", "v10 = 11"));
      run("add", ".");
      run("commit", "-q", "-m", "move");
      const added = parseAddedLines(run(...addedLinesDiffArgs("main~1")));
      expect([...added.keys()]).toEqual(["src/lib/edited.ts"]);
      expect([...added.get("src/lib/edited.ts")!]).toEqual([11]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
