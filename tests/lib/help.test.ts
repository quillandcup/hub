import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HELP_ORDER, helpArticlePath, helpImageUrl, isHelpImagePath, isHelpSlug, listHelpArticles, loadHelpArticle, parseHelpArticle } from "@/lib/help";

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

describe("helpArticlePath", () => {
  it("puts a valid slug under /help and refuses anything that could change the target", () => {
    expect(helpArticlePath("join-a-prickle")).toBe("/help/join-a-prickle");
    for (const bad of ["", "../admin", "javascript:alert(1)", "a/b", "//evil.example", "A"]) expect(helpArticlePath(bad)).toBeNull();
  });
});

describe("parseHelpArticle", () => {
  it("takes the title from the first heading and the summary from the first paragraph after it", () => {
    const a = parseHelpArticle("x", "# How it works\n\nFirst line\ncontinues here.\n\n## Step\n\nMore.\n");
    expect(a.title).toBe("How it works");
    expect(a.summary).toBe("First line continues here.");
    expect(a.body.startsWith("First line")).toBe(true);
  });

  it("shows a summary as plain text, without link targets or emphasis marks", () => {
    const a = parseHelpArticle("x", "# T\n\nSee [how to join](/help/join) the **room** with `code` and _care_.");
    expect(a.summary).toBe("See how to join the room with code and care.");
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

  it("lists markdown files by slug, ordered by name when none is ranked, ignoring other files and bad names", () => {
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

describe("the real articles hold together", () => {
  const articles = listHelpArticles();

  /** The screenshot file names a scene writes, in order: its Nth `shot(page, testInfo, "name")` call saves `NN-name.png`. */
  function sceneShots(scene: string): string[] | null {
    const file = path.join("demo", "scenes", `${scene}.spec.ts`);
    if (!existsSync(file)) return null;
    const names = [...readFileSync(file, "utf8").matchAll(/shot\(page, testInfo, "([a-z0-9-]+)"\)/g)].map((m) => m[1]);
    return names.map((name, i) => `${String(i + 1).padStart(2, "0")}-${name}.png`);
  }

  it("lists every article in the index order, and nothing in the order that has no article", () => {
    expect(articles.map((a) => a.slug)).toEqual(HELP_ORDER);
  });

  it("links only to articles that exist", () => {
    const slugs = new Set(articles.map((a) => a.slug));
    for (const a of articles) {
      for (const m of a.body.matchAll(/\]\(\/help\/([a-z0-9-]+)\)/g)) expect(slugs, `${a.slug} links to /help/${m[1]}`).toContain(m[1]);
    }
  });

  it("shows only screenshots that a demo scene captures, so a renamed step can't leave a broken image", () => {
    for (const a of articles) {
      for (const m of a.body.matchAll(/\(img:([a-z0-9-]+)\/([^)]+)\)/g)) {
        const shots = sceneShots(m[1]);
        expect(shots, `${a.slug} uses scene ${m[1]}, which has no demo/scenes/${m[1]}.spec.ts`).not.toBeNull();
        expect(shots, `${a.slug} uses ${m[1]}/${m[2]}`).toContain(m[2]);
      }
    }
  });

  it("gives every image a description", () => {
    for (const a of articles) for (const m of a.body.matchAll(/!\[([^\]]*)\]\(img:/g)) expect(m[1].trim().length, a.slug).toBeGreaterThan(0);
  });
});
