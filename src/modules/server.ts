import type { PageDataLoader } from "@/lib/landing/live-data";
import { bookshelfPageDataLoaders } from "./bookshelf/page-blocks/server";
import { eventsPageDataLoaders } from "./events/page-blocks/server";

/** The live data loaders of the installed modules' page blocks (server only: they read the database; see `index.ts`, the composition root). */
export const installedPageDataLoaders: readonly PageDataLoader[] = [...eventsPageDataLoaders, ...bookshelfPageDataLoaders];
