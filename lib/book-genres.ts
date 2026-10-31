import { MAX_TOPIC_LENGTH, splitTopicInput } from "@/lib/ask-me-about";

/**
 * A book's genres are tags in the form but one comma-separated string in member_books.genre
 * (what the bookshelf and project pages already show), so older free-text values like
 * "Romance, Fantasy" load as two tags and nothing needs migrating. Tags can't contain a comma.
 */

export const MAX_GENRES = 5;
export const MAX_GENRE_LENGTH = MAX_TOPIC_LENGTH;

/** Stored text -> tags, dropping blanks and case-insensitive duplicates. */
export function parseGenres(stored: string | null | undefined): string[] {
  const seen = new Set<string>();
  return splitTopicInput(stored ?? "").filter((genre) => {
    const key = genre.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tags -> stored text (empty string when there are none). */
export function joinGenres(genres: readonly string[]): string {
  return parseGenres(genres.join(",")).join(", ");
}
