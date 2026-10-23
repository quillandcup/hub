import { describe, expect, it } from "vitest";
import { uniqueZipNames } from "@/lib/chat/zip-names";

describe("uniqueZipNames", () => {
  it("de-duplicates, sanitizes and defaults names", () => {
    expect(uniqueZipNames(["a.png", "A.png", "a.png", null, "../x/y.txt", ".hidden", "naïve.md", "noext", "noext", "  "])).toEqual([
      "a.png", "A (2).png", "a (3).png", "file", "__x_y.txt", "_hidden", "na_ve.md", "noext", "noext (2)", "file (2)",
    ]);
  });
});
