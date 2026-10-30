// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { describeDomShape } from "@/lib/kajabi/probe";
import { formatProbe } from "@/lib/kajabi/probe";

/** A small stand-in for a lesson page's comments, with made-up people: the probe must describe its shape and nothing it says. */
const PAGE = `
  <section class="comments-section" data-comments-url="/products/demo/posts/12345678/comments?page=2&token=secret">
    <textarea class="comment-box" placeholder="Say Something..."></textarea>
    <button class="post-comment" type="submit">Post Comment</button>
    <ul>
      <li class="comment" data-comment-id="99001" id="comment_99001">
        <img class="avatar" src="https://cdn.example.test/avatars/ada.png?sig=abc" alt="Ada Example">
        <span class="comment-author">Ada Example</span>
        <p class="comment-body">Hello from ada@example.com, I live in Springfield.</p>
        <a class="reply-link" href="/products/demo/posts/12345678/comments/99001/reply">Reply</a>
        <ul><li class="comment reply" data-comment-id="99002"><span class="comment-author">Bo Sample</span><p class="comment-body">Welcome!</p></li></ul>
      </li>
      <li class="comment" data-comment-id="99003"><span class="comment-author">Cy Demo</span></li>
    </ul>
    <a class="more" href="/products/demo/posts/12345678/comments?page=2">Show More</a>
    <a href="javascript:void(0)" class="unrelated">Elsewhere</a>
  </section>
`;

describe("describeDomShape", () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
  });

  it("groups the comment-related elements by tag and classes with counts, attribute names and link paths", () => {
    const lines = describeDomShape("comment");
    const text = lines.join("\n");
    expect(text).toContain("section.comments-section x1 attrs: data-comments-url | urls: /products/demo/posts/:id/comments");
    expect(text).toContain("li.comment x2 attrs: data-comment-id, id");
    expect(text).toContain("li.comment.reply x1 attrs: data-comment-id");
    expect(text).toContain("span.comment-author x3");
    expect(text).toContain("p.comment-body x2");
    expect(text).toContain('a.reply-link "Reply" x1 attrs: href | urls: /products/demo/posts/:id/comments/:id/reply');
    expect(text).toContain('a.more "Show More" x1 attrs: href | urls: /products/demo/posts/:id/comments');
    expect(text).toContain('button.post-comment "Post Comment" x1');
  });

  it("never prints what a comment says, who wrote it, an attribute value, or a query string", () => {
    const text = describeDomShape("comment").join("\n");
    for (const secret of ["Ada Example", "Bo Sample", "Cy Demo", "ada@example.com", "Springfield", "Welcome!", "token=secret", "sig=abc", "99001", "Say Something"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("leaves out elements that have nothing to do with the pattern (apart from the show-more style controls), and javascript or fragment links", () => {
    const text = describeDomShape("comment").join("\n");
    expect(text).not.toContain("unrelated");
    expect(text).not.toContain("javascript");
    // Only the page's show-more and reply style controls are listed whatever the pattern, since they are how more data is asked for.
    const controlsOnly = describeDomShape("nothing-matches-this");
    expect(controlsOnly).toHaveLength(3);
    expect(controlsOnly.every((l) => /^(a|button)\./.test(l) && l.includes('"'))).toBe(true);
  });

  it("is capped at 80 lines", () => {
    document.body.innerHTML = Array.from({ length: 200 }, (_, i) => `<div class="comment-${i}"></div>`).join("");
    expect(describeDomShape("comment").length).toBe(80);
  });
});

describe("formatProbe with requests that are not JSON", () => {
  it("shows the content type of an HTML fragment or script request, by path only", () => {
    const out = formatProbe([
      { method: "GET", status: 200, path: "/products/demo/posts/:id/comments", query: ["page"], fields: [], contentType: "text/html" },
      { method: "GET", status: 200, path: "/api/x", query: [], fields: ["a: string"] },
    ]);
    expect(out).toContain("GET 200 /products/demo/posts/:id/comments [text/html] ?page");
    expect(out).toContain("GET 200 /api/x\n    a: string");
    expect(formatProbe([])).toBe("No requests of interest were seen.");
  });
});
