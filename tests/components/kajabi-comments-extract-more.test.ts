// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { extractCommentsInPage, isExpanderText } from "@/lib/kajabi/comments-capture";

const LIST = `<div data-comments-list>
  <div class="comment"><p class="comment__name">Ada Example</p><div class="comment__body">One</div>
    <a class="comment__reply" href="/p/1/comments/new?parent_id=1">Reply</a></div>
</div>`;

describe("extractCommentsInPage completeness fields", () => {
  beforeEach(() => {
    document.body.innerHTML = LIST;
  });

  it("counts controls that would show more comments or replies, never Reply or Post Comment, and frames", () => {
    document.body.innerHTML = LIST + `<form class="new_comment"><button>Post Comment</button></form>`;
    expect(extractCommentsInPage()).toMatchObject({ pendingControls: 0, iframes: 0 });
    document.body.innerHTML =
      LIST + `<a class="btn--more" href="#">Load</a><button>View previous comments</button><a href="#">3 replies</a><iframe src="about:blank"></iframe>`;
    expect(extractCommentsInPage()).toMatchObject({ pendingControls: 3, iframes: 1 });
  });

  it("keeps the in-page pattern in step with isExpanderText", () => {
    for (const t of ["Show More", "View previous comments", "3 replies", "Reply", "Post Comment", "Show", "Load more replies", "Delete"]) {
      document.body.innerHTML = `<button>${t}</button>`;
      expect(extractCommentsInPage().pendingControls === 1, t).toBe(isExpanderText(t));
    }
  });

  it("reads replies nested deeper than one level, each under the comment above it", () => {
    document.body.innerHTML = `<div data-comments-list>
      <div class="comment"><p class="comment__name">Ada Example</p><div class="comment__body">One</div>
        <div class="comment--reply"><div class="comment"><p class="comment__name">Bo Sample</p><div class="comment__body">Two</div>
          <div class="comment--reply"><div class="comment"><p class="comment__name">Cy Demo</p><div class="comment__body">Three</div></div></div>
        </div></div>
      </div></div>`;
    expect(extractCommentsInPage().comments.map((c) => [c.index, c.parentIndex])).toEqual([[0, null], [1, 0], [2, 1]]);
  });
});
