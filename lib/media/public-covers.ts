import { BOOKSHELF_PUBLIC } from "@/lib/config";
import type { MediaAsset, MediaRepository } from "@/lib/data/media";
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

/**
 * The asset a visitor who can't read it themselves may be given, or null: a live image marked public, or a book's
 * cover at the shelf size while the Bookshelf is public. A library that can't be read answers null (a plain 404),
 * never an error. `media` needs the service role.
 */
export async function assetForVisitor(media: MediaRepository, assetId: string, preset: PresetName | string): Promise<MediaAsset | null> {
  try {
    const asset = await media.byId(assetId);
    if (!asset || asset.deleted_at) return null;
    return asset.is_public || (await isPublicBookCover(media, asset.id, preset)) ? asset : null;
  } catch {
    return null;
  }
}
