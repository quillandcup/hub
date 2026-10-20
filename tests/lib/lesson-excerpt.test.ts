import { describe, expect, it } from "vitest";
import { lessonExcerpt } from "@/lib/courses/excerpt";

describe("lessonExcerpt", () => {
  it("flattens HTML to one line of text and decodes entities", () => {
    expect(lessonExcerpt("<p>Hey Hedgies&nbsp;&mdash;</p><p>Tropes &amp; <em>expectations</em></p>")).toBe("Hey Hedgies &mdash; Tropes & expectations");
  });
  it("cuts long text at a word boundary with an ellipsis", () => {
    const out = lessonExcerpt(`<p>${"word ".repeat(100)}</p>`, 20)!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
  it("is null when there is no text", () => {
    expect(lessonExcerpt(null)).toBeNull();
    expect(lessonExcerpt("<p> </p>")).toBeNull();
  });
});
