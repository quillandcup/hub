import { describe, it, expect } from "vitest";
import {
  amazonCoverHref,
  amazonCoverProblem,
  bookCoverUrl,
  bookCoverUrlFor,
  coverAssetIdOf,
  describeBookCoverRequirements,
} from "@/lib/bookCover";

const ID = "media_AAAAAAAAAAA1";

describe("library cover URLs", () => {
  it("are the shelf-size route for the asset, and are recognised again", () => {
    expect(bookCoverUrlFor(ID)).toBe(`/api/media/${ID}/book_cover_shelf`);
    expect(coverAssetIdOf(bookCoverUrlFor(ID))).toBe(ID);
  });

  it("are told apart from other links, other presets and made-up ids", () => {
    for (const url of [`/api/media/${ID}/event_card`, `/api/media/${ID}/book_cover_shelf?x=1`, "/api/media/media_short/book_cover_shelf", "https://example.com/cover.jpg", "", null, undefined]) {
      expect(coverAssetIdOf(url)).toBeNull();
    }
  });
});

describe("bookCoverUrl", () => {
  it("accepts a library cover and an ordinary link, and drops anything else", () => {
    expect(bookCoverUrl(bookCoverUrlFor(ID))).toBe(bookCoverUrlFor(ID));
    expect(bookCoverUrl("https://example.com/cover.jpg")).toBe("https://example.com/cover.jpg");
    for (const bad of ["javascript:alert(1)", "/api/media/anything", "//evil.example/x.jpg", "", null, undefined]) {
      expect(bookCoverUrl(bad)).toBeNull();
    }
  });
});

describe("the Amazon cover", () => {
  it("is offered for a cover big enough, and says what's needed otherwise", () => {
    expect(amazonCoverProblem({ width: 1600, height: 2560 })).toBeNull();
    expect(amazonCoverProblem({ width: 625, height: 1000 })).toBeNull();
    expect(amazonCoverProblem({ width: 290, height: 430 })).toMatch(/at least 625 x 1000 px/);
    expect(amazonCoverHref(ID)).toBe(`/api/media/${ID}/book_cover_kdp_ebook?download=1`);
  });

  it("describes what can be uploaded", () => {
    expect(describeBookCoverRequirements()).toMatch(/Any size/);
    expect(describeBookCoverRequirements()).toMatch(/4 MB/);
  });
});
