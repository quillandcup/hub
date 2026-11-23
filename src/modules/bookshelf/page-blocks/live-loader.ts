import { logLiveFailure, type PageDataLoader } from "@/lib/landing/live-data";
import { blocksOf } from "@/lib/landing/walk";
import { bookshelfKey, bookshelfOptions, type BookCard, type BookshelfOptions } from "./live-books";

/**
 * The Bookshelf module's live data loader: the Hedgie Bookshelf block gets `live: { books }` in its render-only props, the books at
 * the globe newest first (docs/product/LANDING_PAGES.md, "Live data"). Blocks that ask the same (genre, count) share one read, and a page
 * with no such block costs nothing. A block whose read fails, or that has no book to show, gets no `live` and draws its empty line.
 */

export const BOOKSHELF_BLOCK_TYPES = ["HedgieBookshelf"] as const;

export type BookshelfLoader = (options: BookshelfOptions) => Promise<BookCard[]>;

/** What a page asks of the books, deduplicated, so a page with none costs nothing. */
export function neededBookshelves(page: unknown): BookshelfOptions[] {
  const wanted = new Map<string, BookshelfOptions>();
  for (const block of blocksOf(page)) {
    if (block.type !== "HedgieBookshelf") continue;
    const options = bookshelfOptions(block.props);
    wanted.set(bookshelfKey(options), options);
  }
  return [...wanted.values()];
}

export function createBookshelfLoader(load: BookshelfLoader): PageDataLoader {
  return {
    id: "bookshelf",
    types: BOOKSHELF_BLOCK_TYPES,
    async load(page) {
      const wanted = neededBookshelves(page);
      if (wanted.length === 0) return null;
      const pairs = await Promise.all(wanted.map(async (options) => [bookshelfKey(options), await load(options).catch((e) => logLiveFailure("bookshelf", e))] as const));
      const shelves = new Map(pairs);
      return ({ type, props }) => {
        if (type !== "HedgieBookshelf") return undefined;
        const books = shelves.get(bookshelfKey(bookshelfOptions(props)));
        return books && books.length > 0 ? { ...props, live: { books } } : undefined;
      };
    },
  };
}
