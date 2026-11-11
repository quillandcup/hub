import { describe, expect, it } from "vitest";
import { cleanText, decodePage, httpsImageUrl, parsePagePreview, MAX_DESCRIPTION, MAX_TITLE } from "@/lib/chat/link-preview-html";

const PAGE = "https://example.test/articles/one";
const html = (head: string, body = "<p>hello</p>") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("parsePagePreview", () => {
  it("reads the Open Graph tags", () => {
    const p = parsePagePreview(
      html(`<title>Fallback</title>
        <meta property="og:title" content="The title">
        <meta property="og:description" content="What it is about">
        <meta property="og:site_name" content="Example Press">
        <meta property="og:image" content="https://cdn.example.test/cover.jpg">`),
      PAGE
    );
    expect(p).toEqual({ title: "The title", description: "What it is about", siteName: "Example Press", imageUrl: "https://cdn.example.test/cover.jpg" });
  });

  it("falls back to Twitter tags, the title element and the description meta", () => {
    const p = parsePagePreview(html(`<title> Plain   title </title><meta name="description" content="Meta description"><meta name="twitter:image" content="https://cdn.example.test/t.png">`), PAGE);
    expect(p).toEqual({ title: "Plain title", description: "Meta description", siteName: null, imageUrl: "https://cdn.example.test/t.png" });
  });

  it("uses the first of a repeated tag, and skips an empty one for the next", () => {
    const p = parsePagePreview(html(`<meta property="og:title" content=""><meta property="og:title" content="Second"><meta name="twitter:title" content="Twitter">`), PAGE);
    expect(p.title).toBe("Twitter");
    expect(parsePagePreview(html(`<meta property="og:title" content="First"><meta property="og:title" content="Second">`), PAGE).title).toBe("First");
  });

  it("resolves a relative picture address against the page", () => {
    expect(parsePagePreview(html(`<meta property="og:image" content="/img/cover.png">`), PAGE).imageUrl).toBe("https://example.test/img/cover.png");
    expect(parsePagePreview(html(`<meta property="og:image" content="cover.png">`), PAGE).imageUrl).toBe("https://example.test/articles/cover.png");
    expect(parsePagePreview(html(`<meta property="og:image" content="//cdn.example.test/c.png">`), PAGE).imageUrl).toBe("https://cdn.example.test/c.png");
  });

  it("drops a picture that is not https, or carries credentials, or is not an address at all", () => {
    for (const bad of ["http://cdn.example.test/c.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "https://user:pw@cdn.example.test/c.png", "https://", "   "]) {
      expect(parsePagePreview(html(`<meta property="og:image" content="${bad}">`), PAGE).imageUrl, bad).toBeNull();
    }
  });

  it("decodes entities once and keeps what is left as text, markup included", () => {
    const p = parsePagePreview(html(`<meta property="og:title" content="Tom &amp; Jerry &lt;b&gt;bold&lt;/b&gt; &amp;amp; more">`), PAGE);
    // `&amp;` becomes `&` once; the encoded `&amp;amp;` is a literal "&amp;" the page asked to show.
    expect(p.title).toBe("Tom & Jerry <b>bold</b> &amp; more");
  });

  it("treats a script or tags inside a title as text, not as markup, and never reads past the head", () => {
    const p = parsePagePreview(html(`<title><script>alert(1)</script>Real</title><meta property="og:description" content="x">`, `<meta property="og:title" content="From the body"><title>Body title</title>`), PAGE);
    expect(p.title).toBe("<script>alert(1)</script>Real");
    expect(p.description).toBe("x");
    const fromBody = parsePagePreview(html(`<meta charset="utf-8">`, `<meta property="og:title" content="From the body">`), PAGE);
    expect(fromBody.title).toBeNull();
  });

  it("copes with malformed markup: unclosed tags, a missing head end, stray brackets", () => {
    const p = parsePagePreview(`<html><head><title>Broken <<<meta property="og:description" content="still here"><meta property="og:image" content="https://cdn.example.test/a.png"`, PAGE);
    expect(p.title).toContain("Broken");
    expect(parsePagePreview("not html at all", PAGE)).toEqual({ title: null, description: null, siteName: null, imageUrl: null });
    expect(parsePagePreview("", PAGE).title).toBeNull();
    expect(parsePagePreview(`<head><meta property="og:title" content="No closing head">`, PAGE).title).toBe("No closing head");
  });

  it("reads only the head: a huge body after it costs nothing and cannot change the answer", () => {
    const big = html(`<meta property="og:title" content="Head wins">`, "<div>".repeat(200_000) + "x".repeat(300_000));
    const started = Date.now();
    const p = parsePagePreview(big, PAGE);
    expect(p.title).toBe("Head wins");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("survives a hostile head: thousands of tags, very deep nesting", () => {
    const many = `<meta name="x" content="y">`.repeat(20_000) + `<meta property="og:title" content="After many">`;
    expect(parsePagePreview(html(many), PAGE).title).toBe("After many");
    const deep = "<div>".repeat(20_000);
    expect(() => parsePagePreview(html(`<meta property="og:title" content="Deep">${deep}`), PAGE)).not.toThrow();
  });

  it("caps long texts", () => {
    const p = parsePagePreview(html(`<meta property="og:title" content="${"t".repeat(MAX_TITLE + 50)}"><meta property="og:description" content="${"d".repeat(MAX_DESCRIPTION + 50)}">`), PAGE);
    expect([...(p.title ?? "")]).toHaveLength(MAX_TITLE);
    expect(p.title?.endsWith("…")).toBe(true);
    expect([...(p.description ?? "")]).toHaveLength(MAX_DESCRIPTION);
  });
});

describe("cleanText", () => {
  it("drops control and direction-override characters and collapses whitespace", () => {
    const messy = ["a", String.fromCharCode(0), "b", String.fromCharCode(0x202e), "c", String.fromCharCode(0x200b), "d\n\n\te  f", String.fromCharCode(0xa0), "g"].join("");
    expect(cleanText(messy, 100)).toBe("abcd e f g");
  });

  it("returns null for nothing worth showing", () => {
    expect(cleanText(null, 10)).toBeNull();
    expect(cleanText("  \n\t ", 10)).toBeNull();
    expect(cleanText(String.fromCharCode(0x202e, 0x200b), 10)).toBeNull();
  });

  it("does not cut a character in two", () => {
    const text = "😀".repeat(10);
    expect(cleanText(text, 5)).toBe("😀😀😀😀…");
  });
});

describe("httpsImageUrl", () => {
  it("refuses an address that is too long", () => {
    expect(httpsImageUrl(`https://example.test/${"a".repeat(2100)}`, PAGE)).toBeNull();
  });
});

describe("decodePage", () => {
  it("decodes UTF-8 by default", () => {
    expect(decodePage(Buffer.from("<title>Café</title>", "utf-8"), "text/html")).toContain("Café");
  });

  it("uses the charset the server declared", () => {
    const bytes = Buffer.from([0x3c, 0x74, 0x3e, 0x43, 0x61, 0x66, 0xe9]); // "<t>Caf" + é in windows-1252
    expect(decodePage(bytes, "text/html; charset=windows-1252")).toBe("<t>Café");
    expect(decodePage(bytes, 'text/html; charset="ISO-8859-1"')).toBe("<t>Café");
  });

  it("falls back to a charset the page declares near its start", () => {
    const bytes = Buffer.concat([Buffer.from('<meta charset="windows-1252"><title>Caf', "latin1"), Buffer.from([0xe9])]);
    expect(decodePage(bytes, "text/html")).toContain("Café");
    const equiv = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>', "latin1"), Buffer.from([0xe9])]);
    expect(decodePage(equiv, null)).toContain("é");
  });

  it("ignores a charset it does not know", () => {
    expect(decodePage(Buffer.from("<p>Café</p>", "utf-8"), "text/html; charset=no-such-charset")).toContain("Café");
  });
});
