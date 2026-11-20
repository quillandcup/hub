import { describe, expect, it } from "vitest";
import { parseAddedLines } from "../../scripts/added-lines";

const DIFF = [
  "diff --git a/lib/a.ts b/lib/a.ts",
  "--- a/lib/a.ts",
  "+++ b/lib/a.ts",
  "@@ -3,0 +4,2 @@ ctx",
  "+x",
  "+y",
  "@@ -10 +12 @@",
  "+z",
  "diff --git a/lib/gone.ts b/lib/gone.ts",
  "--- a/lib/gone.ts",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
].join("\n");

describe("parseAddedLines", () => {
  it("expands hunk ranges, defaults a missing count to 1, ignores deleted files", () => {
    const added = parseAddedLines(DIFF);
    expect([...added.keys()]).toEqual(["lib/a.ts"]);
    expect([...added.get("lib/a.ts")!]).toEqual([4, 5, 12]);
  });

  it("adds nothing for a pure deletion hunk (count 0) and for an empty diff", () => {
    expect(parseAddedLines("").size).toBe(0);
    const onlyDeleted = ["--- a/lib/a.ts", "+++ b/lib/a.ts", "@@ -5,2 +4,0 @@"].join("\n");
    expect([...(parseAddedLines(onlyDeleted).get("lib/a.ts") ?? [])]).toEqual([]);
  });

  it("ignores a hunk header it cannot read", () => {
    expect(parseAddedLines(["+++ b/lib/a.ts", "@@ nonsense @@"].join("\n")).size).toBe(0);
  });
});
