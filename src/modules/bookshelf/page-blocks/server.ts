import { unstable_cache } from "next/cache";
import { getServiceRepos } from "@/lib/data/server";
import { liveCacheOptions } from "@/lib/landing/live-cache";
import type { PageDataLoader } from "@/lib/landing/live-data";
import { bookCard, type BookshelfOptions } from "./live-books";
import { createBookshelfLoader } from "./live-loader";

/**
 * The Bookshelf module's server half: its live data loader with the service role, behind the same one-minute cache as every live
 * figure (`src/lib/landing/live-cache.ts`; a member changing a book's level clears it at once). Server only: it reads the database.
 * The block itself is in `blocks.tsx`. The cached value is the cards only: titles, names on the books, covers and buy links.
 */

const cachedBooks = unstable_cache(
  async (options: BookshelfOptions) => (await getServiceRepos().books.publicShelf({ genre: options.genre, limit: options.max })).map(bookCard),
  ["landing-live-bookshelf"],
  liveCacheOptions,
);

export const bookshelfPageDataLoaders: readonly PageDataLoader[] = [createBookshelfLoader(cachedBooks)];
