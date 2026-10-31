import { describe, expect, it } from "vitest";
import { cleanGenres, genresError, MAX_GENRE_LENGTH, MAX_GENRES } from "@/lib/book-genres";
import { validateBookInput } from "@/lib/bookValidation";
import { bookCoverUrlFor } from "@/lib/bookCover";

describe("book genres", () => {
  it("trims, collapses spaces and drops blanks", () => {
    expect(cleanGenres(["  Cozy   Mystery ", "", "  "])).toEqual(["Cozy Mystery"]);
    expect(cleanGenres(null)).toEqual([]);
    expect(cleanGenres(undefined)).toEqual([]);
  });

  it("drops case-insensitive duplicates, keeping the first spelling and order", () => {
    expect(cleanGenres(["Fantasy", "romance", "FANTASY"])).toEqual(["Fantasy", "romance"]);
  });

  it("accepts up to the limits and rejects beyond them", () => {
    expect(genresError(["a", "b", "c", "d", "e"].slice(0, MAX_GENRES))).toBeNull();
    expect(genresError(["a", "b", "c", "d", "e", "f"])).toMatch(/at most 5/);
    expect(genresError(["x".repeat(MAX_GENRE_LENGTH)])).toBeNull();
    expect(genresError(["x".repeat(MAX_GENRE_LENGTH + 1)])).toMatch(/too long/);
    // duplicates do not count toward the limit
    expect(genresError(["a", "A", "b", "c", "d", "e"])).toBeNull();
  });

  it("is part of validating a book", () => {
    const input = {
      title: "T",
      publishedDate: "2026-01-01",
      coverUrl: bookCoverUrlFor("media_AAAAAAAAAAA1"),
      purchaseUrl: "https://example.com/buy",
      format: "print" as const,
    };
    expect(validateBookInput(input)).toBeNull();
    expect(validateBookInput({ ...input, genres: ["a", "b", "c", "d", "e", "f"] })).toMatch(/at most 5/);
  });
});
