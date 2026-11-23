import type { BookRepository } from "@/lib/data/books";
import type { MediaAsset, MediaRepository } from "@/lib/data/media";
import type { PresetName } from "./presets";

/**
 * Whether an image may be served to someone who isn't signed in because a book uses it as its cover: only the book cover's shelf
 * size, and only while a live book at the globe (`member_books.visibility` public) uses the image. A book a member keeps to
 * themselves or to members, a deleted one, the Amazon version and a project's pre-publish cover stay behind sign-in. `books`
 * needs the service role, since the caller can't read the image themselves.
 */
export async function isPublicBookCover(books: BookRepository, assetId: string, preset: PresetName | string): Promise<boolean> {
  if (preset !== "book_cover_shelf") return false;
  return books.isPublicCover(assetId);
}

/**
 * The asset a visitor who can't read it themselves may be given, or null: a live image marked public, or the shelf cover of a
 * book at the globe. A library that can't be read answers null (a plain 404), never an error. The repositories need the service role.
 */
export async function assetForVisitor(repos: { media: MediaRepository; books: BookRepository }, assetId: string, preset: PresetName | string): Promise<MediaAsset | null> {
  try {
    const asset = await repos.media.byId(assetId);
    if (!asset || asset.deleted_at) return null;
    return asset.is_public || (await isPublicBookCover(repos.books, asset.id, preset)) ? asset : null;
  } catch {
    return null;
  }
}
