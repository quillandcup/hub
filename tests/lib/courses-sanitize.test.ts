import { describe, it, expect } from "vitest";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";

describe("sanitizeLessonHtml", () => {
  it("keeps headings, lists, emphasis and images", () => {
    const html = '<h2>Week 1</h2><p>Write <strong>daily</strong> and <em>kindly</em>.</p><ul><li>One</li></ul><img src="https://example.test/a.png" alt="A" />';
    expect(sanitizeLessonHtml(html)).toBe(html);
  });

  it("removes scripts, handlers, styles and frames", () => {
    const out = sanitizeLessonHtml(
      '<p onclick="steal()" style="color:red" class="x">Hi</p><script>alert(1)</script><iframe src="https://evil.test"></iframe><style>p{}</style>'
    )!;
    expect(out).toBe("<p>Hi</p>");
  });

  it("opens links in a new tab without the opener, and drops javascript: links", () => {
    expect(sanitizeLessonHtml('<a href="https://example.test">x</a>')).toBe(
      '<a href="https://example.test" target="_blank" rel="noopener noreferrer">x</a>'
    );
    expect(sanitizeLessonHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer">x</a>'
    );
  });

  it("allows only http(s) images", () => {
    expect(sanitizeLessonHtml('<img src="data:image/png;base64,AAAA">')).toBe("");
    expect(sanitizeLessonHtml('<img src="//evil.test/a.png">')).toBe("");
  });

  it("returns null for nothing to keep", () => {
    expect(sanitizeLessonHtml(null)).toBeNull();
    expect(sanitizeLessonHtml("   ")).toBeNull();
  });
});
