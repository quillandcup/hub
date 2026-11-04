import { describe, expect, it } from "vitest";
import { cleanEditions, editionsError, editionsSummary, rowEditions, sortEditions, storedEditions } from "@/lib/book-editions";

const PRINT = { format: "print" as const, purchase_url: "https://example.com/print", price: 17.99 };
const EBOOK = { format: "ebook" as const, purchase_url: "https://example.com/ebook", price: null };

describe("rowEditions", () => {
  it("reads the stored editions, print first", () => {
    expect(rowEditions([EBOOK, PRINT])).toEqual([PRINT, EBOOK]);
  });

  it("has no editions for an empty or missing value", () => {
    expect(rowEditions([])).toEqual([]);
    expect(rowEditions(null)).toEqual([]);
  });

  it("skips entries that aren't editions, and reads a missing price as null", () => {
    expect(rowEditions([null, 3, [], { format: "audio", purchase_url: "x" }, { format: "print" }, { format: "print", purchase_url: "https://example.com/p" }])).toEqual([
      { format: "print", purchase_url: "https://example.com/p", price: null },
    ]);
  });
});

describe("storedEditions", () => {
  it("writes the editions print first", () => {
    expect(storedEditions([EBOOK, PRINT])).toEqual([PRINT, EBOOK]);
  });

  it("writes an empty list for no editions", () => {
    expect(storedEditions([])).toEqual([]);
  });
});

describe("editionsError", () => {
  const ok = { format: "print" as const, purchaseUrl: "https://example.com/p", price: 10 };

  it("accepts one edition, or one per format", () => {
    expect(editionsError([ok])).toBeNull();
    expect(editionsError([ok, { format: "ebook", purchaseUrl: "https://example.com/e" }])).toBeNull();
  });

  it.each([
    [undefined, "Add at least one"],
    [[], "Add at least one"],
    [[{ ...ok, format: "audio" as never }], "Choose print or ebook"],
    [[ok, ok], "Only one print edition"],
    [[{ ...ok, purchaseUrl: "  " }], "Where to buy the print edition is required"],
    [[{ ...ok, purchaseUrl: "ftp://example.com" }], "valid link"],
    [[{ ...ok, price: -0.01 }], "must be zero or more"],
    [[{ ...ok, price: Number.NaN }], "must be zero or more"],
  ])("rejects %j", (input, message) => {
    expect(editionsError(input)).toContain(message);
  });

  it("accepts a free book", () => {
    expect(editionsError([{ ...ok, price: 0 }])).toBeNull();
  });
});

describe("cleanEditions, sortEditions, editionsSummary", () => {
  it("trims the link and makes a missing price null", () => {
    expect(cleanEditions([{ format: "ebook", purchaseUrl: "  https://example.com/e " }])).toEqual([{ format: "ebook", purchase_url: "https://example.com/e", price: null }]);
  });

  it("puts print before ebook", () => {
    expect(sortEditions([EBOOK, PRINT]).map((e) => e.format)).toEqual(["print", "ebook"]);
  });

  it("summarizes what a book is sold as", () => {
    expect(editionsSummary([EBOOK, PRINT])).toBe("Print $17.99 · Ebook");
  });
});
