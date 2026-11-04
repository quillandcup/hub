import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";
import {
  changelogEntryPath,
  changelogSince,
  findChangelogEntry,
  isChangelogImagePath,
  isChangelogSlug,
  listChangelog,
  renderChangelogMarkdown,
  validateChangelog,
} from "@/lib/changelog";

const entry = (over: Partial<ChangelogEntry>): ChangelogEntry => ({
  slug: "a-thing",
  date: "2026-11-01",
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
