import { describe, expect, it } from "vitest";
import { EXPANDER_PATTERN, isExpanderText, mergePostLessons, nextPostsPageUrl, parseComments, parsePostsList, type RawComment } from "@/lib/kajabi/comments-capture";
import { commentsCompletenessNote } from "@/lib/courses/migrate";

const TZ = "America/New_York";
const raw = (over: Partial<RawComment> & { index: number }): RawComment => ({
  parentIndex: null,
  name: "Ada Example",
  datetime: "2026-06-27T14:30:00Z",
  body: "Hello",
  idCandidates: [],
  ...over,
});
const link = (value: string) => [{ source: "reply-link" as const, name: "parent_id", value }];

describe("parseComments key collisions", () => {
  it("never lets two comments share an id: an id the lesson repeats is dropped for all of them and each is hashed by its content", () => {
    // A reply link naming the thread's first comment on every comment of the thread: without the guard, 3 comments become 1 row.
    const parsed = parseComments(
      [
        raw({ index: 0, body: "Root", idCandidates: link("77") }),
        raw({ index: 1, parentIndex: 0, name: "Bo Sample", body: "Reply one", idCandidates: link("77") }),
        raw({ index: 2, parentIndex: 0, name: "Cy Demo", body: "Reply two", idCandidates: link("77") }),
        raw({ index: 3, body: "Other thread", idCandidates: link("88") }),
      ],
      "12",
      TZ,
    );
    const keys = parsed.comments.map((c) => c.commentKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys[3]).toBe("88");
    expect(keys.slice(0, 3).every((k) => k.startsWith("h:") && !k.includes("~"))).toBe(true);
    expect(parsed.keySources).toEqual({ "reply-link": 1, "reply-container": 0, "data-comment": 0, hash: 3 });
    expect(parsed.duplicateKeys).toBe(3);
    expect(parsed.comments[1].parentCommentKey).toBe(keys[0]);
  });

  it("gives the same keys whatever order the page lists a repeated id in", () => {
    const a = raw({ index: 0, body: "A", idCandidates: link("5") });
    const b = raw({ index: 1, name: "Bo Sample", body: "B", idCandidates: link("5") });
    const forward = parseComments([a, b], "12", TZ).comments.map((c) => c.commentKey);
    const backward = parseComments([{ ...b, index: 0 }, { ...a, index: 1 }], "12", TZ).comments.map((c) => c.commentKey);
    expect([...forward].sort()).toEqual([...backward].sort());
  });
});

describe("expander controls", () => {
  it("matches controls that reveal more and nothing that writes", () => {
    for (const t of ["Show More", "show more comments", "View previous comments", "Load more replies", "See all 12 comments", "View 3 replies", "Show replies", "3 replies", "1 reply", "2 more replies"]) {
      expect(isExpanderText(t), t).toBe(true);
    }
    for (const t of ["Reply", "Post Comment", "Delete", "Comments", "Show", "Replies are closed", "", "x".repeat(80)]) {
      expect(isExpanderText(t), t).toBe(false);
    }
    expect(EXPANDER_PATTERN.test("Show More")).toBe(true);
  });
});

describe("posts list paging", () => {
  const cur = "https://app.example.test/api/admin/products/9/posts?per=20";

  it("follows a next link or a next page number, and stops otherwise", () => {
    expect(nextPostsPageUrl({ links: { next: "/api/admin/products/9/posts?page=2" } }, cur)).toBe("https://app.example.test/api/admin/products/9/posts?page=2");
    expect(nextPostsPageUrl({ meta: { next_page: 3 } }, cur)).toBe("https://app.example.test/api/admin/products/9/posts?per=20&page=3");
    expect(nextPostsPageUrl({ meta: { next_page: "4" } }, cur)).toContain("page=4");
    expect(nextPostsPageUrl({ links: { next: null }, meta: { next_page: null } }, cur)).toBeNull();
    expect(nextPostsPageUrl({ links: { next: "http://[bad" } }, cur)).toBeNull();
    expect(nextPostsPageUrl({ meta: { next_page: 2 } }, "not a url")).toBeNull();
    expect(nextPostsPageUrl(undefined, cur)).toBeNull();
  });

  it("reads a declared total and merges pages without repeating a lesson", () => {
    expect(parsePostsList({ data: [], meta: { total_count: 40 } }).declaredTotal).toBe(40);
    const a = { lessonKajabiId: "1", url: "/a" };
    const b = { lessonKajabiId: "2", url: "/b" };
    expect(mergePostLessons([[a, b], [b, { lessonKajabiId: "3", url: "/c" }]]).map((l) => l.lessonKajabiId)).toEqual(["1", "2", "3"]);
  });
});

describe("commentsCompletenessNote", () => {
  it("says how many lessons have captured comments, and flags a capture that looks partial", () => {
    expect(commentsCompletenessNote(40, 12, 20)).toBe("Completeness: 40 captured comments sit on 12 of 20 lessons of this course. Compare this with the lessons that show comments in Kajabi.");
    expect(commentsCompletenessNote(1, 1, 30)).toContain("That is few");
    expect(commentsCompletenessNote(5, 2, 30)).toContain("That is few");
    expect(commentsCompletenessNote(3, 2, 4)).not.toContain("That is few");
    expect(commentsCompletenessNote(0, 0, 12)).toContain("Nothing was captured");
    expect(commentsCompletenessNote(0, 0, 0)).toContain("no Kajabi lessons");
  });
});
