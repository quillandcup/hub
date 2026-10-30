import { BOOKSHELF_PUBLIC } from "@/lib/config";
import type { MediaRepository } from "@/lib/data/media";
import type { PresetName } from "./presets";

/**
 * Whether an image may be served to someone who isn't signed in because a book uses it as its cover. Only while
 * the Bookshelf is public (app.config.ts `bookshelfPublic`), only for the book cover's shelf size, and only for
 * an image a book shows: the Amazon version and a project's pre-publish cover stay behind sign-in. `media` needs
 * the service role, since the caller can't read the image themselves.
 */
export async function isPublicBookCover(media: MediaRepository, assetId: string, preset: PresetName | string): Promise<boolean> {
  if (!BOOKSHELF_PUBLIC || preset !== "book_cover_shelf") return false;
  return (await media.usages(assetId)).some((u) => u.kind === "book");
}
