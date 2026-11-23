import { describe, it, expect } from "vitest";
import { checkLandingPage } from "@/lib/landing/a11y";
import { collectAssetIds, cleanLinks, normalizeLandingData, parseEmbed, safeHref } from "@/lib/landing/data";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";
import { sanitizeLandingData, sanitizeRichText } from "@/lib/landing/sanitize";
import { isLandingPageId, isValidSlug, slugify } from "@/lib/landing/slug";

describe("slugs", () => {
  it("turns a title into an address", () => {
    expect(slugify("Spring Writing Challenge!")).toBe("spring-writing-challenge");
    expect(slugify("Café & Quill")).toBe("cafe-and-quill");
    expect(slugify("  --  ")).toBe("");
  });

  it("accepts lowercase words with dashes only, and keeps the editor's own address free", () => {
    expect(isValidSlug("spring-2027")).toBe(true);
    for (const bad of ["", "Spring", "a b", "-a", "a-", "a--b", "a/b", "new", "a".repeat(81)]) expect(isValidSlug(bad)).toBe(false);
    expect(isValidSlug(null)).toBe(false);
  });

  it("checks ids that arrive in a request", () => {
    expect(isLandingPageId("lpg_AAAAAAAAAAA1")).toBe(true);
    expect(isLandingPageId("mbr_AAAAAAAAAAA1")).toBe(false);
    expect(isLandingPageId("lpg_short")).toBe(false);
    expect(isLandingPageId(undefined)).toBe(false);
  });
});

describe("links", () => {
  it("keeps http(s), mailto, site paths and anchors, and drops everything else", () => {
    for (const ok of ["https://example.com/a", "http://example.com", "mailto:a@example.com", "/p/spring", "#faq"]) expect(safeHref(ok)).toBe(ok);
    for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "//evil.example", "data:text/html,x", "ftp://x", "/\\evil", "/api/members", "/api/../x", "/%2e%2e/x", ""]) expect(safeHref(bad)).toBe("");
    expect(safeHref(42)).toBe("");
  });

  it("cleans every href and url in a document, however deep", () => {
    const cleaned = cleanLinks({ content: [{ props: { href: "javascript:x", content: [{ props: { items: [{ href: "https://ok.example" }, { url: "data:x" }] } }] } }] });
    expect(JSON.stringify(cleaned)).not.toContain("javascript");
    expect(JSON.stringify(cleaned)).toContain("https://ok.example");
    expect(JSON.stringify(cleaned)).not.toContain("data:x");
  });
});

describe("assets", () => {
  it("collects every *AssetId, in slots and lists, once", () => {
    const data = { content: [{ props: { backgroundImageAssetId: "media_a", content: [{ props: { imageAssetId: "media_b", items: [{ imageAssetId: "media_a" }, { imageAssetId: "" }] } }] } }], root: { props: { logoAssetId: "media_c" } } };
    expect(collectAssetIds(data)).toEqual(["media_a", "media_b", "media_c"]);
  });
});

describe("video links", () => {
  it("builds the embed address from the id alone, for the hosts we allow", () => {
    expect(parseEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(parseEmbed("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("youtube");
    expect(parseEmbed("https://vimeo.com/123456789")?.src).toBe("https://player.vimeo.com/video/123456789?dnt=1");
    expect(parseEmbed("https://player.mux.com/AbC123")?.provider).toBe("mux");
  });

  it("refuses other hosts, plain http, scripts and junk", () => {
    for (const bad of ["https://evil.example/embed/dQw4w9WgXcQ", "http://youtu.be/dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=<script>", "nonsense", ""]) {
      expect(parseEmbed(bad)).toBeNull();
    }
    expect(parseEmbed(undefined)).toBeNull();
  });
});

describe("sanitizing", () => {
  it("keeps formatting and removes scripts, handlers, styles and images from rich text", () => {
    const html = sanitizeRichText('<p onclick="x()" style="color:red">Hi <strong>there</strong><script>alert(1)</script><img src="https://x.example/a.png"></p><a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>');
    expect(html).toContain("<strong>there</strong>");
    expect(html).not.toMatch(/script|onclick|style=|<img|javascript:/i);
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("cleans the html props and the links of a whole document, and tolerates a broken one", () => {
    const clean = sanitizeLandingData({ content: [{ type: "RichText", props: { html: "<p>ok</p><script>x</script>" } }, { type: "Button", props: { href: "javascript:x" } }] });
    expect(JSON.stringify(clean)).not.toMatch(/script|javascript/);
    expect(clean.root).toEqual({});
    expect(normalizeLandingData(null)).toEqual({ content: [], root: {}, schemaVersion: LANDING_SCHEMA_VERSION });
    expect(normalizeLandingData([1])).toEqual({ content: [], root: {}, schemaVersion: LANDING_SCHEMA_VERSION });
  });
});

describe("checks before publishing", () => {
  const page = (...blocks: { type: string; props: Record<string, unknown> }[]) => ({ content: blocks, root: {} });
  const title = { type: "Heading", props: { text: "Welcome", level: "h1" } };
  const errors = (data: unknown) => checkLandingPage(data).filter((i) => i.severity === "error").map((i) => i.message);

  it("passes a page with a title and a described picture", () => {
    expect(checkLandingPage(page(title, { type: "Image", props: { imageAssetId: "media_a", alt: "A hedgehog writing" } }))).toEqual([]);
  });

  it("stops an empty page and a page with no title", () => {
    expect(errors(page())).toContain("The page is empty.");
    expect(errors(page({ type: "RichText", props: { html: "<p>x</p>" } }))).toEqual([expect.stringContaining("one title")]);
  });

  it("stops a picture with no description unless it is decoration, in a slot too", () => {
    const section = { type: "Section", props: { content: [{ type: "Image", props: { imageAssetId: "media_a", alt: "" } }] } };
    expect(errors(page(title, section))).toEqual([expect.stringContaining("description")]);
    const decorative = { type: "Section", props: { content: [{ type: "Image", props: { imageAssetId: "media_a", alt: "", decorative: true } }] } };
    expect(errors(page(title, decorative))).toEqual([]);
  });

  it("stops a button with no link and a card button with no link, and warns about vague link text", () => {
    expect(errors(page(title, { type: "Button", props: { label: "Join", href: "javascript:x" } }))).toEqual([expect.stringContaining("no link")]);
    expect(errors(page(title, { type: "CardGrid", props: { items: [{ type: "GridCard", props: { id: "c1", title: "Book", buttonLabel: "Buy", href: "" } }] } }))).toEqual([expect.stringContaining("button has no link")]);
    const warnings = checkLandingPage(page(title, { type: "Button", props: { label: "Click here", href: "https://x.example" } })).filter((i) => i.severity === "warning");
    expect(warnings).toHaveLength(1);
  });

  it("warns about skipped heading levels and a second title, and about text over an unshaded picture", () => {
    const skipped = checkLandingPage(page(title, { type: "Heading", props: { text: "Deep", level: "h3" } }));
    expect(skipped.map((i) => i.message).join(" ")).toContain("skips a level");
    const twice = checkLandingPage(page(title, { type: "Heading", props: { text: "Again", level: "h1" } }));
    expect(twice.map((i) => i.message).join(" ")).toContain("more than one page title");
    const unshaded = checkLandingPage(page(title, { type: "Section", props: { backgroundImageAssetId: "media_a", overlay: "none", content: [] } }));
    expect(unshaded.map((i) => i.message).join(" ")).toContain("no shade");
  });

  it("stops a link-list link with no address and warns about vague link text", () => {
    const found = checkLandingPage(page(title, { type: "LinkList", props: { items: [{ type: "LinkItem", props: { id: "l1", label: "Shop", href: "javascript:x" } }, { type: "LinkItem", props: { id: "l2", label: "here", href: "https://x.example" } }] } }));
    expect(found.filter((i) => i.severity === "error").map((i) => i.message)).toEqual([expect.stringContaining("Shop")]);
    expect(found.filter((i) => i.severity === "warning")).toHaveLength(1);
  });

  it("stops a countdown with no date and a video from a host we don't allow", () => {
    expect(errors(page(title, { type: "Countdown", props: { targetAt: "" } }))).toEqual(["The countdown has no date."]);
    expect(errors(page(title, { type: "Video", props: { url: "https://evil.example/v", title: "x" } }))).toEqual([expect.stringContaining("YouTube, Vimeo or Mux")]);
  });
});
