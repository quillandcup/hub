import { describe, expect, it } from "vitest";
import { fullDate, linkifyText, relativeAgo } from "@/lib/courses/comment-text";
import { COMMENT_EDIT_WINDOW_MS, cleanCommentBody, commentCountBucket, withinEditWindow } from "@/lib/courses/comments";

describe("linkifyText", () => {
  it("links only http(s) addresses and leaves everything else as text", () => {
    expect(linkifyText("Read https://example.com/a?b=1&c=2 now, or javascript:alert(1) <b>x</b>")).toEqual([
      { type: "text", value: "Read " },
      { type: "link", value: "https://example.com/a?b=1&c=2" },
      { type: "text", value: " now, or javascript:alert(1) <b>x</b>" },
    ]);
  });

  it("leaves a sentence's closing punctuation out of the link, but keeps a bracket the address opened", () => {
    expect(linkifyText("(see https://example.com/x), then https://en.wikipedia.org/wiki/Foo_(bar). Done!")).toEqual([
      { type: "text", value: "(see " },
      { type: "link", value: "https://example.com/x" },
      { type: "text", value: "), then " },
      { type: "link", value: "https://en.wikipedia.org/wiki/Foo_(bar)" },
      { type: "text", value: ". Done!" },
    ]);
  });

  it("returns plain text as one part, and nothing for nothing", () => {
    expect(linkifyText("no links")).toEqual([{ type: "text", value: "no links" }]);
    expect(linkifyText("")).toEqual([]);
    expect(linkifyText("https://")).toEqual([{ type: "text", value: "https://" }]);
  });
});

describe("dates", () => {
  const now = Date.parse("2027-03-01T15:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("says how long ago, then a date in the viewer's zone", () => {
    expect(relativeAgo(ago(20_000), now, "UTC")).toBe("just now");
    expect(relativeAgo(ago(60_000), now, "UTC")).toBe("1 minute ago");
    expect(relativeAgo(ago(5 * 60_000), now, "UTC")).toBe("5 minutes ago");
    expect(relativeAgo(ago(3600_000), now, "UTC")).toBe("1 hour ago");
    expect(relativeAgo(ago(2 * 86_400_000), now, "UTC")).toBe("2 days ago");
    expect(relativeAgo("2026-01-01T03:00:00Z", now, "America/New_York")).toBe("Dec 31, 2025");
  });

  it("gives the full date and time in the viewer's zone", () => {
    expect(fullDate("2027-03-01T03:30:00Z", "America/New_York")).toBe("February 28, 2027 at 10:30 PM");
  });
});

describe("comment rules", () => {
  it("cleans the text without changing characters", () => {
    expect(cleanCommentBody("  a & b <c>\r\nline  ")).toEqual({ body: "a & b <c>\nline" });
    expect(cleanCommentBody("   ")).toEqual({ error: "Write something first" });
    expect(cleanCommentBody(42)).toEqual({ error: "Write something first" });
    expect(cleanCommentBody("x".repeat(4001))).toHaveProperty("error");
    expect(cleanCommentBody("x".repeat(4000))).toHaveProperty("body");
  });

  it("allows edits for 15 minutes, at both sides of the line", () => {
    const created = "2027-03-01T15:00:00.000Z";
    const at = Date.parse(created);
    expect(withinEditWindow(created, at + COMMENT_EDIT_WINDOW_MS)).toBe(true);
    expect(withinEditWindow(created, at + COMMENT_EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it("buckets the count of comments seen", () => {
    expect([0, 1, 5, 6, 20, 21].map(commentCountBucket)).toEqual(["0", "1-5", "1-5", "6-20", "6-20", "21+"]);
  });
});
