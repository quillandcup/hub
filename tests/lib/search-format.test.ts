import { describe, it, expect } from "vitest";
import { highlightSegments, formatHitDate } from "@/lib/search/format";

describe("highlightSegments", () => {
  it("marks every occurrence, case-insensitively, keeping the original text", () => {
    expect(highlightSegments("Cody codyaray", ["cody"])).toEqual([
      { text: "Cody", match: true },
      { text: " ", match: false },
      { text: "cody", match: true },
      { text: "aray", match: false },
    ]);
  });

  it("treats regex characters in a word literally", () => {
    expect(highlightSegments("a.b axb", ["a.b"]).filter((s) => s.match).map((s) => s.text)).toEqual(["a.b"]);
  });

  it("returns the text whole when there is nothing to mark", () => {
    expect(highlightSegments("hello", [])).toEqual([{ text: "hello", match: false }]);
  });
});

describe("formatHitDate", () => {
  it("shows a date-only value as that same day", () => {
    expect(formatHitDate("2026-10-01")).toBe("Oct 1, 2026");
  });
});
