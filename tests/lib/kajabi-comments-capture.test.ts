import { describe, expect, it } from "vitest";
import { normalizeBody, parseComments, parsePostsList, type RawComment } from "@/lib/kajabi/comments-capture";

const TZ = "America/New_York";
const raw = (over: Partial<RawComment> & { index: number }): RawComment => ({
  parentIndex: null,
  name: "Ada Example",
  datetime: "2026-06-27T14:30:00Z",
  body: "Hello",
  idCandidates: [],
  ...over,
});

describe("normalizeBody", () => {
  it("collapses whitespace per line and keeps line and paragraph breaks", () => {
    expect(normalizeBody("  a \t b \n\n\n\n c d \r\n e  ")).toBe("a b\n\nc d\ne");
    expect(normalizeBody("   \n ")).toBe("");
  });
});

describe("parseComments keys", () => {
  it("prefers the reply link's id, then the reply container's, then data-comment, then a hash", () => {
    const parsed = parseComments(
      [
        raw({ index: 0, idCandidates: [{ source: "reply-container", name: "", value: "9" }, { source: "reply-link", name: "parent_id", value: "5" }] }),
        raw({ index: 1, idCandidates: [{ source: "reply-container", name: "", value: "6" }] }),
        raw({ index: 2, idCandidates: [{ source: "data-comment", name: "", value: "7" }] }),
        raw({ index: 3 }),
      ],
      "12",
      TZ,
    );
    expect(parsed.comments.map((c) => c.commentKey.slice(0, 2))).toEqual(["5", "6", "7", "h:"]);
    expect(parsed.keySources).toEqual({ "reply-link": 1, "reply-container": 1, "data-comment": 1, hash: 1 });
  });

  it("ignores a reply-link parameter that does not look like a comment id", () => {
    const parsed = parseComments([raw({ index: 0, idCandidates: [{ source: "reply-link", name: "section", value: "42" }] })], "12", TZ);
    expect(parsed.keySources.hash).toBe(1);
  });

  it("hashes the same comment to the same key, and different text, lesson, author or time to another", () => {
    const key = (lesson: string, over: Partial<RawComment> = {}) => parseComments([raw({ index: 0, ...over })], lesson, TZ).comments[0].commentKey;
    expect(key("12")).toBe(key("12", { body: "  Hello  " }));
    expect(new Set([key("12"), key("13"), key("12", { body: "Hi" }), key("12", { name: "Bo Sample" }), key("12", { datetime: null })]).size).toBe(5);
  });

  it("suffixes a key that repeats within the lesson and counts it", () => {
    const parsed = parseComments([raw({ index: 0 }), raw({ index: 1 }), raw({ index: 2 })], "12", TZ);
    expect(new Set(parsed.comments.map((c) => c.commentKey)).size).toBe(3);
    expect(parsed.duplicateKeys).toBe(2);
  });
});

describe("parseComments fields", () => {
  it("links replies to their parent's key and reads dates as instants", () => {
    const parsed = parseComments(
      [
        raw({ index: 0, idCandidates: [{ source: "reply-link", name: "comment_id", value: "10" }] }),
        raw({ index: 1, parentIndex: 0, name: "  Bo \n Sample ", datetime: "2026-11-01", body: "a\n\n\n\nb" }),
        raw({ index: 2, datetime: null }),
        raw({ index: 3, datetime: "not a date" }),
      ],
      "12",
      TZ,
    );
    expect(parsed.comments[1]).toMatchObject({ parentCommentKey: "10", authorName: "Bo Sample", postedAt: "2026-11-01T17:00:00.000Z", body: "a\n\nb" });
    expect(parsed.comments[0].postedAt).toBe("2026-06-27T14:30:00.000Z");
    expect(parsed.comments[2].postedAt).toBeNull();
    expect(parsed.comments[3].postedAt).toBeNull();
  });
});

describe("parsePostsList", () => {
  it("lists lessons with their comments link, counts the ones without, and skips repeats", () => {
    const json = {
      data: [
        { id: "5001", attributes: { urls: { viewCommentsUrl: "https://site.example.test/a?preview_token=t" } } },
        { id: 5002, attributes: { urls: { viewCommentsUrl: " /b " } } },
        { id: "5003", attributes: { urls: {} } },
        { id: "5001", attributes: { urls: { viewCommentsUrl: "/dup" } } },
        { attributes: {} },
      ],
    };
    expect(parsePostsList(json)).toEqual({
      lessons: [
        { lessonKajabiId: "5001", url: "https://site.example.test/a?preview_token=t" },
        { lessonKajabiId: "5002", url: "/b" },
      ],
      withoutLink: 1,
      paged: false,
    });
  });

  it("notes a next page and survives anything else", () => {
    expect(parsePostsList({ data: [], links: { next: "/x?page=2" } }).paged).toBe(true);
    expect(parsePostsList(null)).toEqual({ lessons: [], withoutLink: 0, paged: false });
    expect(parsePostsList({ data: "nope" }).lessons).toEqual([]);
  });
});
