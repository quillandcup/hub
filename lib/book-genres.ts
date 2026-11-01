import { cleanTopic } from "@/lib/ask-me-about";

/**
 * A book's genres are tags (member_books.genres), at most MAX_GENRES, each up to
 * MAX_GENRE_LENGTH characters, no case-insensitive duplicates. Mirrors the CHECK
 * public.valid_book_genres, so the form can reject bad input before the database does.
 */

export const MAX_GENRES = 5;
export const MAX_GENRE_LENGTH = 40;

/** Trim each genre, drop blanks and case-insensitive duplicates (first spelling and the member's order win). */
export function cleanGenres(genres: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of genres ?? []) {
    const genre = cleanTopic(raw ?? "");
    const key = genre.toLowerCase();
    if (!genre || seen.has(key)) continue;
    seen.add(key);
    result.push(genre);
  }
  return result;
}

/** Why a list can't be saved, or null. */
export function genresError(genres: readonly string[] | null | undefined): string | null {
  const cleaned = cleanGenres(genres);
  const tooLong = cleaned.find((g) => g.length > MAX_GENRE_LENGTH);
  if (tooLong) return `"${tooLong.slice(0, 20)}…" is too long — keep each genre under ${MAX_GENRE_LENGTH} characters`;
  if (cleaned.length > MAX_GENRES) return `Pick at most ${MAX_GENRES} genres`;
  return null;
}
