import { describe, expect, it } from "vitest";
import { blockFor, blockMatches, blockOptionsFor, describeBlock, isBlockScope, isBlocked, type PreviewBlock } from "@/lib/chat/link-preview-blocks";

const IMG = "https://thumb.wikimedia.org/wikipedia/commons/a/ab/x.jpg";

describe("blockOptionsFor", () => {
  it("offers the site, the first path segment and the exact link for an address with a path", () => {
    expect(blockOptionsFor(IMG)).toEqual([
      { scope: "site", label: "Block all previews from thumb.wikimedia.org" },
      { scope: "path", label: "Block previews from links under thumb.wikimedia.org/wikipedia/…" },
      { scope: "link", label: "Block previews from this specific link" },
    ]);
  });

  it("offers no path scope for an address without a path segment", () => {
    expect(blockOptionsFor("https://example.com").map((o) => o.scope)).toEqual(["site", "link"]);
    expect(blockOptionsFor("https://example.com/").map((o) => o.scope)).toEqual(["site", "link"]);
    expect(blockOptionsFor("https://example.com//x").map((o) => o.scope)).toEqual(["site", "link"]);
  });

  it("drops a leading www from the host shown", () => {
    expect(blockOptionsFor("https://WWW.Example.com/a")[0].label).toBe("Block all previews from example.com");
  });

  it("cuts a long label with an ellipsis", () => {
    const host = `${"a".repeat(60)}.example.com`;
    const options = blockOptionsFor(`https://${host}/${"b".repeat(80)}/c`);
    expect(options[0].label).toMatch(/…$/);
    expect(options[0].label.length).toBeLessThan(80);
    expect(options[1].label).toMatch(/…\/…$/);
  });

  it("offers nothing for an address that cannot be blocked", () => {
    for (const bad of ["http://example.com/a", "not an address", "ftp://example.com/a", "https://[::1]/a", "https://-bad-/a", ""]) expect(blockOptionsFor(bad)).toEqual([]);
  });

  it("does not offer a path scope when the first segment is too long to store", () => {
    expect(blockOptionsFor(`https://example.com/${"x".repeat(250)}/y`).map((o) => o.scope)).toEqual(["site", "link"]);
  });

  it("offers nothing for an address too long to store", () => {
    expect(blockOptionsFor(`https://example.com/${"x".repeat(2100)}`)).toEqual([]);
  });
});

describe("blockFor", () => {
  it("builds the normalised rule for each scope", () => {
    expect(blockFor(IMG, "site")).toEqual({ scope: "site", host: "thumb.wikimedia.org", pathPrefix: null, url: null });
    expect(blockFor(IMG, "path")).toEqual({ scope: "path", host: "thumb.wikimedia.org", pathPrefix: "/wikipedia", url: null });
    expect(blockFor(IMG, "link")).toEqual({ scope: "link", host: "thumb.wikimedia.org", pathPrefix: null, url: IMG });
  });

  it("lowercases and strips www from the host, drops the fragment and user info, keeps the query", () => {
    expect(blockFor("https://user:pw@WWW.Example.COM:8443/a/b?q=1#frag", "link")).toEqual({ scope: "link", host: "example.com", pathPrefix: null, url: "https://www.example.com:8443/a/b?q=1" });
    expect(blockFor("https://www.Example.com/a#x", "site")?.host).toBe("example.com");
  });

  it("has no path rule for an address without a path segment, and none for a bad address or scope", () => {
    expect(blockFor("https://example.com/", "path")).toBeNull();
    expect(blockFor("http://example.com/a", "site")).toBeNull();
    expect(blockFor(IMG, "nope" as never)).toBeNull();
  });
});

describe("isBlocked", () => {
  const site = blockFor(IMG, "site") as PreviewBlock;
  const path = blockFor(IMG, "path") as PreviewBlock;
  const link = blockFor(IMG, "link") as PreviewBlock;

  it("a site rule covers every address on the host, with or without www, and nothing on another host", () => {
    expect(isBlocked("https://thumb.wikimedia.org/other", [site])).toBe(true);
    expect(isBlocked("https://www.thumb.wikimedia.org/other", [site])).toBe(true);
    expect(isBlocked("https://THUMB.wikimedia.org:444/other?x=1", [site])).toBe(true);
    expect(isBlocked("https://wikimedia.org/other", [site])).toBe(false);
    expect(isBlocked("https://sub.thumb.wikimedia.org/other", [site])).toBe(false);
    expect(isBlocked("https://notthumb.wikimedia.org/other", [site])).toBe(false);
  });

  it("a path rule covers its segment and below, on a segment boundary only", () => {
    expect(isBlocked("https://thumb.wikimedia.org/wikipedia", [path])).toBe(true);
    expect(isBlocked("https://thumb.wikimedia.org/wikipedia/", [path])).toBe(true);
    expect(isBlocked("https://thumb.wikimedia.org/wikipedia/commons/x.png", [path])).toBe(true);
    expect(isBlocked("https://thumb.wikimedia.org/wikipediax", [path])).toBe(false);
    expect(isBlocked("https://thumb.wikimedia.org/wiki", [path])).toBe(false);
    expect(isBlocked("https://other.org/wikipedia/a", [path])).toBe(false);
    const wiki = blockFor("https://thumb.wikimedia.org/wiki/x", "path") as PreviewBlock;
    expect(isBlocked("https://thumb.wikimedia.org/wikipedia/a", [wiki])).toBe(false);
  });

  it("a link rule covers exactly that address, fragment aside", () => {
    expect(isBlocked(IMG, [link])).toBe(true);
    expect(isBlocked(`${IMG}#top`, [link])).toBe(true);
    expect(isBlocked(`${IMG}?v=2`, [link])).toBe(false);
    expect(isBlocked(`${IMG}x`, [link])).toBe(false);
  });

  it("is false without rules, for a bad address, for http, and for a malformed path rule", () => {
    expect(isBlocked(IMG, [])).toBe(false);
    expect(isBlocked("nope", [site])).toBe(false);
    expect(isBlocked("http://thumb.wikimedia.org/a", [site])).toBe(false);
    expect(blockMatches({ scope: "path", host: "thumb.wikimedia.org", pathPrefix: null, url: null }, IMG)).toBe(false);
  });

  it("any one rule is enough", () => {
    expect(isBlocked(IMG, [blockFor("https://other.org/a", "site") as PreviewBlock, link])).toBe(true);
  });
});

describe("describeBlock and isBlockScope", () => {
  it("describes each scope plainly", () => {
    expect(describeBlock(blockFor(IMG, "site") as PreviewBlock)).toBe("thumb.wikimedia.org");
    expect(describeBlock(blockFor(IMG, "path") as PreviewBlock)).toBe("thumb.wikimedia.org/wikipedia/…");
    expect(describeBlock(blockFor(IMG, "link") as PreviewBlock)).toBe("thumb.wikimedia.org/wikipedia/commons/a/ab/x.jpg");
    expect(describeBlock({ scope: "path", host: "a.org", pathPrefix: null, url: null })).toBe("a.org/…");
    expect(describeBlock({ scope: "link", host: "a.org", pathPrefix: null, url: null })).toBe("a.org");
  });

  it("recognises the three scopes only", () => {
    expect(["site", "path", "link"].every(isBlockScope)).toBe(true);
    expect(isBlockScope("all")).toBe(false);
    expect(isBlockScope(null)).toBe(false);
  });
});
