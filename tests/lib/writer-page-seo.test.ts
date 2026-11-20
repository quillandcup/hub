import { describe, expect, it } from "vitest";
import { APP_URL, WRITER_PROFILES } from "@/lib/config";
import type { PublicWriterProfile } from "@/lib/data/writer-profiles";
import { jsonLdScript, writerPageDescription, writerPageJsonLd, writerPageMetadata } from "@/lib/writer-page-seo";
import { sitemapIds, sitemapUrl } from "@/lib/writer-sitemap";

const profile = (changes: Partial<PublicWriterProfile> = {}): PublicWriterProfile => ({
  handle: "ada-example",
  name: "Ada Example",
  photoUrl: null,
  bio: null,
  links: { instagram: null, facebook: null, x: null },
  publishedAt: "2027-03-01T12:00:00Z",
  updatedAt: "2027-03-02T12:00:00Z",
  ...changes,
});

describe("writerPageDescription", () => {
  it("is a plain sentence when there is no bio", () => {
    expect(writerPageDescription(profile())).toBe("Ada Example is a writer in the Quill & Cup community.");
  });

  it("is the bio on one line when it is short", () => {
    expect(writerPageDescription(profile({ bio: "I write\ncozy   mysteries." }))).toBe("I write cozy mysteries.");
  });

  it("is cut at a word with an ellipsis when it is long", () => {
    const description = writerPageDescription(profile({ bio: "word ".repeat(100) }));
    expect(description.length).toBeLessThanOrEqual(156);
    expect(description.endsWith("…")).toBe(true);
    expect(description).not.toMatch(/\s…$/);
  });
});

describe("writerPageMetadata", () => {
  it("can be indexed or not, with the same canonical address", () => {
    expect(writerPageMetadata(profile(), { indexed: true }).robots).toEqual({ index: true, follow: true });
    expect(writerPageMetadata(profile(), { indexed: false }).robots).toEqual({ index: false, follow: false });
    expect(writerPageMetadata(profile(), { indexed: false }).alternates?.canonical).toBe(`${APP_URL}/w/ada-example`);
  });

  it("uses a small card without a photo, and a large one with it", () => {
    expect(writerPageMetadata(profile(), { indexed: true }).twitter).toMatchObject({ card: "summary" });
    expect(writerPageMetadata(profile({ photoUrl: "https://photos.example.com/a.png" }), { indexed: true }).twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("structured data", () => {
  it("is a Person with what the page shows and nothing more", () => {
    expect(writerPageJsonLd(profile())).toEqual({ "@context": "https://schema.org", "@type": "Person", name: "Ada Example", url: `${APP_URL}/w/ada-example` });
  });

  it("escapes a closing tag so text can never end the script", () => {
    expect(jsonLdScript({ description: "</script><b>" })).not.toContain("<");
    expect(JSON.parse(jsonLdScript({ description: "</script><b>" }))).toEqual({ description: "</script><b>" });
  });
});

describe("sitemap files", () => {
  it("is one file at least, then one per page size", () => {
    const size = WRITER_PROFILES.sitemapPageSize;
    expect(sitemapIds(0, size)).toEqual([0]);
    expect(sitemapIds(size, size)).toEqual([0]);
    expect(sitemapIds(size + 1, size)).toEqual([0, 1]);
    expect(sitemapIds(size * 3, size)).toEqual([0, 1, 2]);
  });

  it("is at an address under /w", () => {
    expect(sitemapUrl(2)).toBe(`${APP_URL}/w/sitemap/2.xml`);
  });

  it("stays under the 50,000-address limit of a sitemap file", () => {
    expect(WRITER_PROFILES.sitemapPageSize).toBeLessThanOrEqual(50_000);
  });
});
