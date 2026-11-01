// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { extractCommentsInPage, normalizeBody, parseComments } from "@/lib/kajabi/comments-capture";

/** A stand-in for a Kajabi member lesson page, with made-up people, shaped like the structure the probes found. */
const PAGE = `
  <h3 class="comments__title">Comments 4</h3>
  <form class="new_comment"><textarea></textarea><button>Post Comment</button></form>
  <div class="comments" data-comments-list>
    <div class="comment" data-comment>
      <img class="comment__avatar" src="https://cdn.example.test/ada.png?sig=abc">
      <p class="comment__name">Ada   Example</p>
      <p class="comment__date"><time data-local datetime="2026-06-27T14:30:00Z">on Jun 27</time></p>
      <div class="comment__body" data-comment-body><p>First   paragraph<br>second line</p><p>Second paragraph</p></div>
      <a class="comment__reply" data-remote href="/products/x/posts/12/comments/new?parent_id=111" kjb-settings-id="s">Reply</a>
      <div data-comment-reply data-section-id="s" id="comment_reply_111"></div>
      <div class="comment--reply" data-comment-replies>
        <div class="comment" data-comment>
          <p class="comment__name">Bo Sample</p>
          <p class="comment__date"><time datetime="2026-06-28">Jun 28</time></p>
          <div class="comment__body"><p>Welcome, Ada!</p></div>
          <div data-comment-reply id="comment_reply_222"></div>
        </div>
      </div>
    </div>
    <div class="comment" data-comment>
      <p class="comment__name">Cy Demo</p>
      <div class="comment__body"><p><script>alert(1)</script><img src=x onerror="alert(2)"><b>bold</b> &lt;i&gt;text&lt;/i&gt;</p></div>
    </div>
    <div class="comment" data-comment>
      <p class="comment__name">Dee Sample</p>
      <p class="comment__date"><time datetime="2026-06-29T01:00:00-04:00">Jun 29</time></p>
      <div class="comment__body"></div>
    </div>
    <a class="btn--more" data-remote href="/products/x/posts/12/comments/show_more?desc_from=3&per=15" id="more">Show More</a>
  </div>
`;

describe("extractCommentsInPage", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  it("reads every comment, nesting replies under their parent, with the page's total", () => {
    const { comments, total } = extractCommentsInPage();
    expect(total).toBe(4);
    expect(comments.map((c) => [c.index, c.parentIndex, c.name.trim()])).toEqual([
      [0, null, "Ada   Example"],
      [1, 0, "Bo Sample"],
      [2, null, "Cy Demo"],
      [3, null, "Dee Sample"],
    ]);
    expect(comments[0].datetime).toBe("2026-06-27T14:30:00Z");
    expect(comments[2].datetime).toBeNull();
  });

  it("collects id candidates from the reply link and the reply container, per comment", () => {
    const { comments } = extractCommentsInPage();
    expect(comments[0].idCandidates).toEqual([
      { source: "reply-link", name: "parent_id", value: "111" },
      { source: "reply-container", name: "", value: "111" },
    ]);
    // A reply has no link of its own; it must not borrow its parent's.
    expect(comments[1].idCandidates).toEqual([{ source: "reply-container", name: "", value: "222" }]);
    expect(comments[2].idCandidates).toEqual([]);
  });

  it("returns a body as text, with line and paragraph breaks and never markup", () => {
    const { comments } = extractCommentsInPage();
    expect(comments[0].body).not.toContain("<");
    expect(comments[2].body).not.toMatch(/<(script|img|b)\b/);
    // Escaped markup in the source is text; it stays text.
    expect(comments[2].body).toContain("<i>text</i>");
    expect(normalizeBody(comments[3].body)).toBe("");
  });

  it("leaves the page alone: nothing is clicked, typed or submitted", () => {
    let submitted = false;
    document.querySelector("form")!.addEventListener("submit", () => (submitted = true));
    extractCommentsInPage();
    expect(submitted).toBe(false);
    expect(document.querySelectorAll("div.comment")).toHaveLength(4);
  });

  it("finds no total on a page without a heading count, and no comments on an empty list", () => {
    document.body.innerHTML = `<div class="comments" data-comments-list></div><h2>Lesson notes</h2>`;
    expect(extractCommentsInPage()).toEqual({ comments: [], total: null });
  });

  it("reads other ways a page prints its total", () => {
    document.body.innerHTML = `<h4>12 Comments</h4>`;
    expect(extractCommentsInPage().total).toBe(12);
    document.body.innerHTML = `<h4>Comments (7)</h4>`;
    expect(extractCommentsInPage().total).toBe(7);
  });

  it("feeds parseComments end to end", () => {
    const parsed = parseComments(extractCommentsInPage().comments, "12", "America/New_York");
    expect(parsed.comments.map((c) => [c.commentKey, c.parentCommentKey, c.authorName])).toEqual([
      ["111", null, "Ada Example"],
      ["222", "111", "Bo Sample"],
      [expect.stringMatching(/^h:[0-9a-f]{32}$/), null, "Cy Demo"],
      [expect.stringMatching(/^h:[0-9a-f]{32}$/), null, "Dee Sample"],
    ]);
    expect(parsed.keySources).toEqual({ "reply-link": 1, "reply-container": 1, "data-comment": 0, hash: 2 });
    // A bare date is noon Eastern; an offset time is that instant.
    expect(parsed.comments[1].postedAt).toBe("2026-06-28T16:00:00.000Z");
    expect(parsed.comments[3].postedAt).toBe("2026-06-29T05:00:00.000Z");
    expect(parsed.comments[0].body).toBe("First paragraph\nsecond line\n\nSecond paragraph");
  });
});
