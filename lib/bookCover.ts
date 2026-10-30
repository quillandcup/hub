import { mediaSrc } from "@/lib/media/url";
import { PRESETS, tooSmallFor } from "@/lib/media/presets";
import { safeUrl } from "@/lib/url";

// Book covers (docs/MEDIA_LIBRARY.md). A member uploads a cover at any size; the media library makes the
// Bookshelf size and the Amazon ebook cover from it. Covers uploaded before that were cropped to exactly
// 145x215 and live in the `book-covers` bucket; they keep their URL until `pnpm covers:adopt` moves them.

/** What a request body can carry (Vercel allows about 4.5 MB). A cover is rarely more than a couple of MB. */
export const BOOK_COVER_MAX_BYTES = 4 * 1024 * 1024;

export function describeBookCoverRequirements(): string {
  return `Any size: a JPEG, PNG, WebP or iPhone photo up to ${BOOK_COVER_MAX_BYTES / (1024 * 1024)} MB. We make the Bookshelf size and the Amazon size from it.`;
}

/** The URL a library cover is shown at everywhere a book cover is. */
export function bookCoverUrlFor(assetId: string): string {
  return mediaSrc(assetId, "book_cover_shelf");
}

const LIBRARY_COVER = /^\/api\/media\/(media_[1-9A-HJ-NP-Za-km-z]{12})\/book_cover_shelf$/;

/** The library asset behind a cover URL, or null for a link to somewhere else (an older cover). */
export function coverAssetIdOf(url: string | null | undefined): string | null {
  return url ? (LIBRARY_COVER.exec(url)?.[1] ?? null) : null;
}

/** A cover URL we'll store and show: one of our library paths, or an ordinary http(s) link. */
export function bookCoverUrl(url: string | null | undefined): string | null {
  return coverAssetIdOf(url) ? (url as string) : safeUrl(url);
}

/** Whether a library cover can go to Amazon as it is: null when it can, else why not. */
export function amazonCoverProblem(asset: { width: number; height: number }): string | null {
  return tooSmallFor(asset, PRESETS.book_cover_kdp_ebook);
}

/** Where the Amazon ebook version of a library cover is downloaded. */
export function amazonCoverHref(assetId: string): string {
  return `/api/media/${assetId}/book_cover_kdp_ebook?download=1`;
}
