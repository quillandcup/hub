import { describe, expect, it } from "vitest";
import { CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";
import {
  changelogEntryPath,
  changelogSince,
  filterByCategory,
  filterByAudience,
  findAnyChangelogEntry,
  findChangelogEntry,
  groupByMonth,
  parseAudienceFilter,
  searchChangelog,
  isChangelogImagePath,
  isChangelogSlug,
  listChangelog,
  listProductChangelog,
  parseCategoryFilter,
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

  it("lists only product entries for members, and everything for the admin changelog", () => {
    expect(listProductChangelog([product, eng]).map((e) => e.slug)).toEqual(["product-one"]);
    expect(listChangelog([product, eng]).map((e) => e.slug)).toEqual(["eng-one", "product-one"]);
    expect(changelogSince(null, [product, eng]).map((e) => e.slug)).toEqual(["product-one"]);
  });

  const staff = entry({ slug: "staff-one", date: "2026-11-04", audience: "staff", title: "A staff tool", summary: "What the team can do.", body: "![the page](/changelog/staff-one/page.png)" });

  it("never lets a staff entry reach a member: not the list, not the digest feed, not a page", () => {
    expect(listProductChangelog([product, eng, staff]).map((e) => e.slug)).toEqual(["product-one"]);
    expect(changelogSince(null, [product, staff]).map((e) => e.slug)).toEqual(["product-one"]);
    expect(findChangelogEntry("staff-one", [product, staff])).toBeNull();
    // The admin Changelog still has it, and filters to it.
    expect(listChangelog([product, eng, staff]).map((e) => e.slug)).toEqual(["staff-one", "eng-one", "product-one"]);
    expect(findAnyChangelogEntry("staff-one", [product, staff])?.title).toBe("A staff tool");
    expect(filterByAudience([product, eng, staff], "staff").map((e) => e.slug)).toEqual(["staff-one"]);
    expect(parseAudienceFilter("staff")).toBe("staff");
  });

  it("allows staff screenshots in the entry's own folder, and engineering none", () => {
    expect(validateChangelog([staff])).toEqual([]);
    expect(validateChangelog([{ ...staff, image: { src: "/changelog/staff-one/page.png", alt: "The page" } }])).toEqual([]);
    expect(validateChangelog([{ ...staff, body: "![x](/changelog/other/page.png)" }]).join("\n")).toContain("must be /changelog/staff-one/");
  });

  it("gives an engineering entry no page: its slug finds nothing", () => {
    expect(findChangelogEntry("eng-one", [product, eng])).toBeNull();
    expect(findChangelogEntry("product-one", [product, eng])?.title).toBe("A thing");
  });


  it("refuses an unknown audience and screenshots on an engineering entry", () => {
    const problems = validateChangelog([
      entry({ slug: "a", audience: "nonsense" as never }),
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

describe("major entries", () => {
  it("can be set on a product entry, and only on a product entry", () => {
    const major = entry({ slug: "big", major: true, title: "A big thing" });
    expect(validateChangelog([major])).toEqual([]);
    expect(validateChangelog([entry({ slug: "eng", audience: "engineering", major: true })]).join("\n")).toContain("only a product entry can be major");
  });
});

describe("searching and grouping", () => {
  const entries = [
    entry({ slug: "chat", title: "Hub Chat", summary: "Read our Slack conversations.", body: "Mention people with @.", date: "2026-11-01" }),
    entry({ slug: "courses", title: "Courses in the Hub", summary: "Watch lessons.", body: "Resume where you stopped.", date: "2026-10-12", audience: "engineering" }),
    entry({ slug: "fix", title: "A fix", summary: "Sign-in page.", body: "Slack links.", date: "2026-10-30", category: "fixed" }),
  ];

  it("finds entries containing every word, in any case, in the title, summary or text", () => {
    expect(searchChangelog(entries, "slack").map((e) => e.slug)).toEqual(["chat", "fix"]);
    expect(searchChangelog(entries, "SLACK conversations").map((e) => e.slug)).toEqual(["chat"]);
    expect(searchChangelog(entries, "resume stopped").map((e) => e.slug)).toEqual(["courses"]);
    expect(searchChangelog(entries, "slack nothing")).toEqual([]);
  });

  it("treats no query, whitespace or a repeated parameter sensibly", () => {
    expect(searchChangelog(entries, undefined)).toHaveLength(3);
    expect(searchChangelog(entries, "   ")).toHaveLength(3);
    expect(searchChangelog(entries, ["chat", "fix"]).map((e) => e.slug)).toEqual(["chat"]);
  });

  it("reads the audience filter and applies it", () => {
    expect(parseAudienceFilter("engineering")).toBe("engineering");
    for (const bad of [undefined, "", "everyone", "toString", "PRODUCT"]) expect(parseAudienceFilter(bad as string | undefined)).toBeNull();
    expect(filterByAudience(entries, "engineering").map((e) => e.slug)).toEqual(["courses"]);
    expect(filterByAudience(entries, null)).toHaveLength(3);
  });

  it("finds any entry by slug, engineering included (members' lookup refuses those)", () => {
    expect(findAnyChangelogEntry("courses", entries)?.title).toBe("Courses in the Hub");
    expect(findChangelogEntry("courses", entries)).toBeNull();
    expect(findAnyChangelogEntry("nope", entries)).toBeNull();
  });

  it("groups by month in the order given, labelled for people", () => {
    expect(groupByMonth(listChangelog(entries)).map((g) => [g.month, g.label, g.entries.map((e) => e.slug)])).toEqual([
      ["2026-11", "November 2026", ["chat"]],
      ["2026-10", "October 2026", ["fix", "courses"]],
    ]);
  });
});
