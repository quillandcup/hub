import { describe, expect, it } from "vitest";
import { parseBookSpec } from "@/scripts/import-storefront-books-spec";

const book = {
  memberName: "Ada Example",
  title: "An Example Book",
  coverUrl: "https://example.com/cover.jpg",
  purchaseUrl: "https://example.com/shop",
  publishedDate: "2026-10-12",
  price: 2.99,
  format: "ebook",
};

describe("parseBookSpec", () => {
  it("accepts complete books", () => {
    expect(parseBookSpec([book, { ...book, title: "Another", format: "print", price: 0 }])).toEqual({
      ok: true,
      books: [book, { ...book, title: "Another", format: "print", price: 0 }],
    });
  });

  it("names a missing purchase link and a missing format, never defaulting either", () => {
    const { purchaseUrl: _purchaseUrl, format: _format, ...incomplete } = book;
    expect(parseBookSpec([incomplete])).toEqual({
      ok: false,
      errors: ["Book 1: purchaseUrl is missing", 'Book 1: format must be "print" or "ebook"'],
    });
  });

  it("lists every problem, by book", () => {
    const result = parseBookSpec([book, { ...book, title: " ", coverUrl: "http://example.com/c.jpg", publishedDate: "2026-13-40", price: "2.99" }]);
    expect(result).toEqual({
      ok: false,
      errors: [
        "Book 2: title is missing",
        "Book 2: coverUrl must be an https link",
        "Book 2: publishedDate must be YYYY-MM-DD",
        "Book 2: price must be a number",
      ],
    });
  });

  it("refuses an empty spec, a spec that isn't an array and an entry that isn't an object", () => {
    expect(parseBookSpec([])).toEqual({ ok: false, errors: ["The spec must be a non-empty JSON array of books"] });
    expect(parseBookSpec({ title: "x" })).toEqual({ ok: false, errors: ["The spec must be a non-empty JSON array of books"] });
    expect(parseBookSpec(["x", null])).toEqual({ ok: false, errors: ["Book 1 must be an object", "Book 2 must be an object"] });
  });
});
