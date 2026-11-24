import { describe, expect, it } from "vitest";
import { fullDate, linkifyText, mentionIds, namesToTokens, relativeAgo, richParts, spokenTimestamp, timestampSeconds, tokensToNames } from "@/lib/courses/comment-text";
import { COMMENT_EDIT_WINDOW_MS, COMMENT_MAX_LINKS, cleanCommentBody, cleanReportReason, commentCountBucket, countCommentLinks, involvesInstructor, shouldHoldComment, withinEditWindow } from "@/lib/courses/comments";
import type { ThreadComment } from "@/lib/data/course-comments";

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

describe("the held-link rule", () => {
  const link = (n: number) => `https://example.com/${n}`;

  it("counts links the way the thread auto-links them", () => {
    expect(COMMENT_MAX_LINKS).toBe(2);
    expect(countCommentLinks("no links, only example.com and javascript:alert(1)")).toBe(0);
    expect(countCommentLinks(`${link(1)}, then (${link(2)}). ftp://x.example/a and https://`)).toBe(2);
    expect(countCommentLinks(`${link(1)}\n${link(2)}\n${link(3)}`)).toBe(3);
  });

  it("holds a comment with more than two links, and nothing else", () => {
    expect(shouldHoldComment("")).toBe(false);
    expect(shouldHoldComment(`${link(1)} ${link(2)}`)).toBe(false);
    expect(shouldHoldComment(`${link(1)} ${link(2)} ${link(3)}`)).toBe(true);
    // No word filter: strong words and writing talk are not held.
    expect(shouldHoldComment("How do I kill my darlings? This is damn hard.")).toBe(false);
  });
});

describe("cleanReportReason", () => {
  it("trims, keeps what was typed, and bounds the length", () => {
    expect(cleanReportReason("  Spam & <b>ads</b>\r\nagain  ")).toEqual({ reason: "Spam & <b>ads</b>\nagain" });
    expect(cleanReportReason("   ")).toEqual({ error: "Tell us briefly what's wrong" });
    expect(cleanReportReason(undefined)).toEqual({ error: "Tell us briefly what's wrong" });
    expect(cleanReportReason("x".repeat(500))).toEqual({ reason: "x".repeat(500) });
    expect(cleanReportReason("x".repeat(501))).toEqual({ error: "Keep it under 500 characters" });
  });
});

describe("involvesInstructor", () => {
  const c = (over: Partial<ThreadComment> = {}): ThreadComment => ({
    id: "cmnt_AAAAAAAAAAA1", lessonId: "les_AAAAAAAAAAA1", memberId: "m1", parentId: null, authorName: "Ada Example", isStaffReply: false,
    createdAt: "2027-03-01T00:00:00Z", editedAt: null, removed: false, body: "x", hidden: false, held: false, ...over,
  });
  it("is true when staff asked or a live instructor reply is under the question", () => {
    expect(involvesInstructor({ comment: c({ isStaffReply: true }), replies: [] })).toBe(true);
    expect(involvesInstructor({ comment: c(), replies: [c({ isStaffReply: true })] })).toBe(true);
  });
  it("is false for members only, and for an instructor reply members can't read", () => {
    expect(involvesInstructor({ comment: c(), replies: [c()] })).toBe(false);
    expect(involvesInstructor({ comment: c(), replies: [c({ isStaffReply: true, removed: true })] })).toBe(false);
    expect(involvesInstructor({ comment: c(), replies: [c({ isStaffReply: true, held: true })] })).toBe(false);
    expect(involvesInstructor({ comment: c(), replies: [c({ isStaffReply: true, hidden: true })] })).toBe(false);
  });
});

describe("timestamps", () => {
  it("reads m:ss and h:mm:ss, and refuses minutes or seconds past 59", () => {
    expect(timestampSeconds("2:35")).toBe(155);
    expect(timestampSeconds("0:05")).toBe(5);
    expect(timestampSeconds("1:02:03")).toBe(3723);
    expect(timestampSeconds("2:75")).toBeNull();
    expect(timestampSeconds("1:75:00")).toBeNull();
    expect(timestampSeconds("1:02:75")).toBeNull();
    expect(timestampSeconds("2:3")).toBeNull();
    expect(timestampSeconds("nope")).toBeNull();
  });

  it("says a timestamp the way it is read aloud", () => {
    expect(spokenTimestamp(155)).toBe("2 minutes 35 seconds");
    expect(spokenTimestamp(61)).toBe("1 minute 1 second");
    expect(spokenTimestamp(5)).toBe("5 seconds");
    expect(spokenTimestamp(3600)).toBe("1 hour 0 minutes 0 seconds");
  });
});

describe("richParts", () => {
  it("turns a typed timestamp into a time part and leaves the text around it", () => {
    expect(richParts("At 2:35 she explains it, and again at 1:02:03.")).toEqual([
      { type: "text", value: "At " },
      { type: "time", value: "2:35", seconds: 155 },
      { type: "text", value: " she explains it, and again at " },
      { type: "time", value: "1:02:03", seconds: 3723 },
      { type: "text", value: "." },
    ]);
  });

  it("keeps a time inside an address, a clock time with am or pm, a longer number and an impossible time as plain text", () => {
    expect(richParts("See https://example.com/watch?t=2:35 now")).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://example.com/watch?t=2:35" },
      { type: "text", value: " now" },
    ]);
    for (const text of ["Meet at 10:30pm", "Meet at 10:30 PM", "v2:35:10:22", "ratio 12:345", "at 2:75 sharp"]) {
      expect(richParts(text)).toEqual([{ type: "text", value: text }]);
    }
  });

  it("returns what linkifyText returns when there is no time, and nothing for nothing", () => {
    expect(richParts("no times, https://example.com here")).toEqual(linkifyText("no times, https://example.com here"));
    expect(richParts("")).toEqual([]);
  });
});

describe("mentions in the text", () => {
  const ADA = "mbr_AAAAAAAAAAA1";
  const BEA = "mbr_AAAAAAAAAAA2";

  it("finds each mentioned member once, in order, and only real ids", () => {
    expect(mentionIds(`Hi @[${BEA}] and @[${ADA}], again @[${BEA}], not @[mbr_short] or @[${ADA.replace("mbr_", "xyz_")}]`)).toEqual([BEA, ADA]);
    expect(mentionIds("no one")).toEqual([]);
  });

  it("makes a mention part between text and a timestamp, and keeps one inside an address out of it", () => {
    expect(richParts(`Ask @[${ADA}] at 2:35.`)).toEqual([
      { type: "text", value: "Ask " },
      { type: "mention", memberId: ADA },
      { type: "text", value: " at " },
      { type: "time", value: "2:35", seconds: 155 },
      { type: "text", value: "." },
    ]);
  });

  it("shows a stored comment to its editor by name, and forgets someone who can't be named", () => {
    expect(tokensToNames(`Hi @[${ADA}] & @[${BEA}]`, { [ADA]: "Ada <Quill> & Co" })).toEqual({
      text: "Hi @Ada <Quill> & Co & @someone",
      picked: [{ memberId: ADA, name: "Ada <Quill> & Co" }],
    });
  });

  it("turns the names the writer picked back into tokens, left to right, and leaves the rest as typed", () => {
    const picked = [
      { memberId: ADA, name: "Ada" },
      { memberId: BEA, name: "Ada Example" },
    ];
    // The longer name wins where both fit; a hand-typed name and an email address are not mentions.
    expect(namesToTokens("@Ada Example, @Ada, ada@Ada and @Ada", picked)).toBe(`@[${BEA}], @[${ADA}], ada@Ada and @Ada`);
    expect(namesToTokens("@Adam is not @Ada", [{ memberId: ADA, name: "Ada" }])).toBe(`@Adam is not @[${ADA}]`);
    expect(namesToTokens("Nothing picked @Ada", [])).toBe("Nothing picked @Ada");
  });
});
