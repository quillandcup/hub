import type { PublicBook } from "@/lib/data/books";
import { safeHref } from "@/lib/landing/data";

/**
 * What the public Hedgie Bookshelf block shows and where it comes from (docs/product/WRITER_PROFILES.md, "The public Hedgie
 * Bookshelf"): the books members keep at the globe, newest published first, as plain cards. A card carries only what the page shows:
 * the title, the name on the book, the cover and the link to buy it. No member id, no book id, no description and never a legal
 * name (the repository's `publicShelf` reads the display name only).
 */

/** The most books one block loads. The page weighs a card per book, and the cached copy of them has to stay small. */
export const BOOKSHELF_MAX_BOOKS = 500;
export const BOOKSHELF_DEFAULT_MAX = 60;
export const BOOKSHELF_DEFAULT_FIRST_SHOWN = 24;
const GENRE_MAX_LENGTH = 40;

/** One book as the block draws it. Everything here is already safe to put on a public page. */
export type BookCard = {
  title: string;
  /** The name on the book, or null: then the card shows no author line. */
  author: string | null;
  /** A cover from the media library at the shelf size (`/api/media/<id>/book_cover_shelf`), or null for the placeholder. */
  cover: string | null;
  /** Where to buy it (http or https), or null. */
  href: string | null;
  /** The day it was published (YYYY-MM-DD), for the structured data. */
  published: string;
};

/** What one block asks of the data: a filter and a count. Two blocks that ask the same share one read. */
export type BookshelfOptions = { genre: string | null; max: number };

/** The options a block's own props give, clamped: a count of 1 to `BOOKSHELF_MAX_BOOKS` and a genre of at most 40 characters. */
export function bookshelfOptions(props: Record<string, unknown>): BookshelfOptions {
  const asked = typeof props.max === "number" && Number.isFinite(props.max) ? Math.floor(props.max) : BOOKSHELF_DEFAULT_MAX;
  const genre = typeof props.genre === "string" ? props.genre.trim().slice(0, GENRE_MAX_LENGTH) : "";
  return { genre: genre || null, max: Math.min(Math.max(asked, 1), BOOKSHELF_MAX_BOOKS) };
}

export const bookshelfKey = (options: BookshelfOptions) => `${options.max}:${options.genre?.toLowerCase() ?? ""}`;

/** Only a cover the media library serves at the shelf size is drawn; any other address (an older link, someone else's server) gets the placeholder. */
const MEDIA_COVER = /^\/api\/media\/media_[A-Za-z0-9]+\/book_cover_shelf(\?v=[A-Za-z0-9%._~-]+)?$/;

export function coverFor(coverUrl: string): string | null {
  return MEDIA_COVER.test(coverUrl) ? coverUrl : null;
}

/** The card for a book at the globe. A link that is not http or https is dropped, the cover is checked, and the author is whatever the repository allowed. */
export function bookCard(book: PublicBook): BookCard {
  const href = book.purchase_url ? safeHref(book.purchase_url) : "";
  return {
    title: book.title,
    author: book.author,
    cover: coverFor(book.cover_url),
    href: /^https?:\/\//i.test(href) ? href : null,
    published: book.published_date,
  };
}
