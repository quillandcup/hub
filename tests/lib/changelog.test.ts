import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";
import {
  changelogEntryPath,
  changelogSince,
  filterByCategory,
  findChangelogEntry,
  isChangelogImagePath,
  isChangelogSlug,
  listChangelog,
  listProductChangelog,
  parseCategoryFilter,
  renderChangelogMarkdown,
  validateChangelog,
} from "@/lib/changelog";

const entry = (over: Partial<ChangelogEntry>): ChangelogEntry => ({
  slug: "a-thing",
  date: "2026-11-01",
  audience: "product",
  category: "new",
  title: "A thing",
  summary: "It does a thing.",
  body: "More about the thing.",
  ...over,
});

describe("the committed changelog", () => {
  it("is valid", () => {
    expect(validateChangelog()).toEqual([]);
  });

  it("matches the generated CHANGELOG.md (run `pnpm changelog:generate`)", () => {
    const file = readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
    expect(file).toBe(renderChangelogMarkdown(CHANGELOG_ENTRIES));
  });
});

describe("listChangelog", () => {
  it("sorts newest first, and later entries first within a day", () => {
    const entries = [entry({ slug: "old", date: "2026-10-01" }), entry({ slug: "first", date: "2026-11-01" }), entry({ slug: "second", date: "2026-11-01" })];
    expect(listChangelog(entries).map((e) => e.slug)).toEqual(["second", "first", "old"]);
  });
});

describe("changelogSince", () => {
  const entries = [entry({ slug: "a", date: "2026-10-01" }), entry({ slug: "b", date: "2026-11-01" })];
  it("returns only entries after the day, and everything for null", () => {
    expect(changelogSince("2026-10-01", entries).map((e) => e.slug)).toEqual(["b"]);
    expect(changelogSince(null, entries)).toHaveLength(2);
  });
});

describe("paths and lookups", () => {
  it("builds a path only from a valid slug", () => {
    expect(changelogEntryPath("whats-new")).toBe("/changelog/whats-new");
    expect(changelogEntryPath("../x")).toBeNull();
    expect(changelogEntryPath("Bad Slug")).toBeNull();
  });

  it("finds an entry by slug or null", () => {
    expect(findChangelogEntry("a-thing", [entry({})])?.title).toBe("A thing");
    expect(findChangelogEntry("nope", [entry({})])).toBeNull();
  });

  it("tells a slug from anything else", () => {
    expect(isChangelogSlug("a-thing-2")).toBe(true);
    expect(isChangelogSlug("A_thing")).toBe(false);
  });

  it("accepts only an entry's own screenshots", () => {
    expect(isChangelogImagePath("a-thing", "/changelog/a-thing/shot-1.png")).toBe(true);
    expect(isChangelogImagePath("a-thing", "/changelog/other/shot.png")).toBe(false);
    expect(isChangelogImagePath("a-thing", "/changelog/a-thing/../x.png")).toBe(false);
    expect(isChangelogImagePath("a-thing", "https://example.com/x.png")).toBe(false);
  });
});

describe("validateChangelog", () => {
  it("reports each kind of problem", () => {
    const problems = validateChangelog([
      entry({ slug: "Bad Slug" }),
      entry({ slug: "dup" }),
      entry({ slug: "dup", date: "11/01/2026", title: " ", summary: "has *markdown*", body: "", image: { src: "/x.png", alt: "" } }),
      entry({ slug: "pic", body: "![x](https://example.com/x.png)" }),
    ]);
    const text = problems.join("\n");
    for (const expected of ["slug must be", "duplicate slug", "date must be", "empty title", "no markdown", "empty body", "image must be", "image needs alt", "body image"]) {
      expect(text).toContain(expected);
    }
  });

  it("accepts an entry with its own screenshot", () => {
    expect(
      validateChangelog([entry({ body: "![the page](/changelog/a-thing/page.png)", image: { src: "/changelog/a-thing/page.png", alt: "The page" } })]),
    ).toEqual([]);
  });
});

describe("audiences", () => {
  const product = entry({ slug: "product-one", date: "2026-11-02" });
  const eng = entry({ slug: "eng-one", date: "2026-11-03", audience: "engineering", title: "Repository pattern", summary: "Queries moved behind repositories.", body: "Every table has one interface and two implementations." });

  it("lists only product entries for members, and everything for CHANGELOG.md", () => {
    expect(listProductChangelog([product, eng]).map((e) => e.slug)).toEqual(["product-one"]);
    expect(listChangelog([product, eng]).map((e) => e.slug)).toEqual(["eng-one", "product-one"]);
    expect(changelogSince(null, [product, eng]).map((e) => e.slug)).toEqual(["product-one"]);
  });

  it("gives an engineering entry no page: its slug finds nothing", () => {
    expect(findChangelogEntry("eng-one", [product, eng])).toBeNull();
    expect(findChangelogEntry("product-one", [product, eng])?.title).toBe("A thing");
  });

  it("writes engineering entries into CHANGELOG.md with a tag and their body, and product ones without", () => {
    const md = renderChangelogMarkdown([product, eng]);
    expect(md).toContain("## 2026-11-03 · Engineering · New: Repository pattern");
    expect(md).toContain("Every table has one interface and two implementations.");
    expect(md).toContain("## 2026-11-02 · New: A thing");
    expect(md).not.toContain("More about the thing.");
  });

  it("refuses an unknown audience and screenshots on an engineering entry", () => {
    const problems = validateChangelog([
      entry({ slug: "a", audience: "staff" as never }),
      entry({ slug: "b", audience: "engineering", body: "![x](/changelog/b/x.png)" }),
      entry({ slug: "c", audience: "engineering", image: { src: "/changelog/c/x.png", alt: "x" } }),
    ]).join("\n");
    expect(problems).toContain("unknown audience");
    expect(problems.match(/no screenshots/g)).toHaveLength(2);
  });
});

describe("the category filter", () => {
  const entries = [entry({ slug: "n", category: "new" }), entry({ slug: "i", category: "improved" }), entry({ slug: "f", category: "fixed" })];

  it("reads a category from the query, and anything else as no filter", () => {
    expect(parseCategoryFilter("new")).toBe("new");
    expect(parseCategoryFilter(["fixed", "new"])).toBe("fixed");
    for (const bad of [undefined, "", "all", "toString", "__proto__", "NEW"]) expect(parseCategoryFilter(bad as string | undefined)).toBeNull();
  });

  it("keeps one category, or everything for null", () => {
    expect(filterByCategory(entries, "improved").map((e) => e.slug)).toEqual(["i"]);
    expect(filterByCategory(entries, null).map((e) => e.slug)).toEqual(["n", "i", "f"]);
  });
});
