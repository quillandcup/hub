import { describe, expect, it } from "vitest";
import { joinGenres, parseGenres } from "@/lib/book-genres";

describe("book genres", () => {
  it("reads older free-text values as tags", () => {
    expect(parseGenres("Romance, Fantasy")).toEqual(["Romance", "Fantasy"]);
    expect(parseGenres("  Cozy   Mystery ,, ")).toEqual(["Cozy Mystery"]);
  });

  it("is empty for no genre", () => {
    expect(parseGenres(null)).toEqual([]);
    expect(parseGenres(undefined)).toEqual([]);
    expect(parseGenres("")).toEqual([]);
    expect(joinGenres([])).toBe("");
  });

  it("drops case-insensitive duplicates, keeping the first spelling and order", () => {
    expect(parseGenres("Fantasy, romance, fantasy")).toEqual(["Fantasy", "romance"]);
    expect(joinGenres(["Fantasy", "FANTASY", "Romance"])).toBe("Fantasy, Romance");
  });

  it("round-trips through the stored string", () => {
    const tags = ["Romance", "Cozy Mystery"];
    expect(parseGenres(joinGenres(tags))).toEqual(tags);
  });
});
