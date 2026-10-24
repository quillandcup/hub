import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { helpImageUrl, isHelpImagePath, isHelpSlug, listHelpArticles, loadHelpArticle, parseHelpArticle } from "@/lib/help";

describe("help slugs and image names", () => {
  it("accepts lowercase topic slugs and rejects anything that could leave the folder", () => {
    expect(isHelpSlug("join-a-prickle")).toBe(true);
    for (const bad of ["", "Join", "a/b", "..", "a..b", "-a", "a-", "a b", "a.md"]) expect(isHelpSlug(bad)).toBe(false);
  });

  it("accepts a scene folder and an image file, and nothing else", () => {
    expect(isHelpImagePath("join-a-prickle", "01-dashboard.png")).toBe(true);
    expect(isHelpImagePath("join-a-prickle", "01-dashboard.JPG")).toBe(false);
    for (const [scene, file] of [["..", "x.png"], ["a", "../x.png"], ["a", "x.svg"], ["a", "x.png/y"], ["a/b", "x.png"]]) {
      expect(isHelpImagePath(scene, file)).toBe(false);
    }
  });

  it("turns an img: reference into the signed-in image route, and refuses other sources", () => {
    expect(helpImageUrl("img:join-a-prickle/01-dashboard.png")).toBe("/help/images/join-a-prickle/01-dashboard.png");
    for (const src of ["https://example.com/x.png", "img:../x.png", "img:a/b/c.png", "/help/images/a/x.png", "img:a/x.svg"]) {
      expect(helpImageUrl(src)).toBeNull();
    }
  });
});

describe("parseHelpArticle", () => {
  it("takes the title from the first heading and the summary from the first paragraph after it", () => {
    const a = parseHelpArticle("x", "# How it works\n\nFirst line\ncontinues here.\n\n## Step\n\nMore.\n");
    expect(a.title).toBe("How it works");
    expect(a.summary).toBe("First line continues here.");
    expect(a.body.startsWith("First line")).toBe(true);
  });

  it("skips headings, images and lists when picking the summary, and falls back to the slug without a title", () => {
    const a = parseHelpArticle("no-title", "## Only a section\n\n![shot](img:a/b.png)\n\n- a list\n\nThe real summary.");
    expect(a.title).toBe("no-title");
    expect(a.summary).toBe("The real summary.");
  });
});

describe("listing and loading articles", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "help-"));
    writeFileSync(path.join(dir, "b-second.md"), "# Second\n\nBody b.");
    writeFileSync(path.join(dir, "a-first.md"), "# First\n\nBody a.");
    writeFileSync(path.join(dir, "Not_A_Slug.md"), "# Ignored\n\nx");
    writeFileSync(path.join(dir, "notes.txt"), "ignored");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists markdown files by slug, in order, ignoring other files and bad names", () => {
    expect(listHelpArticles(dir).map((a) => [a.slug, a.title])).toEqual([["a-first", "First"], ["b-second", "Second"]]);
  });

  it("loads one article, and returns null for a missing file or an unsafe slug", () => {
    expect(loadHelpArticle("a-first", dir)?.title).toBe("First");
    expect(loadHelpArticle("missing", dir)).toBeNull();
    expect(loadHelpArticle("../package", dir)).toBeNull();
  });

  it("lists nothing when the folder is missing", () => {
    expect(listHelpArticles(path.join(dir, "nope"))).toEqual([]);
  });

  it("reads the real help/ folder, where every article has a title and a summary", () => {
    const articles = listHelpArticles();
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(isHelpSlug(a.slug)).toBe(true);
      expect(a.title).not.toBe(a.slug);
      expect(a.summary.length).toBeGreaterThan(0);
    }
  });
});
