import { bookCoverUrlFor, coverAssetIdOf } from "@/lib/bookCover";
import type { MediaRepository } from "@/lib/data/media";
import { safeUrl } from "@/lib/url";

export type ResolvedCover = { url: string; assetId: string | null } | { error: string };

/**
 * What to store for a cover the member submitted. A library cover (`/api/media/<id>/book_cover_shelf`) must be
 * one of their own live assets, so nobody can point a book at someone else's picture; the URL is rebuilt from
 * the id rather than trusted. Any other cover must be an ordinary http(s) link (an older cover), with no asset.
 */
export async function resolveBookCover(media: MediaRepository, memberId: string, coverUrl: string | null | undefined): Promise<ResolvedCover> {
  const assetId = coverAssetIdOf(coverUrl);
  if (!assetId) {
    const url = safeUrl(coverUrl);
    return url ? { url, assetId: null } : { error: "Cover image failed to upload correctly — try again" };
  }
  const asset = await media.byId(assetId).catch(() => null);
  if (!asset || asset.deleted_at || asset.owner_member_id !== memberId) return { error: "That cover isn't one of yours: upload it again" };
  return { url: bookCoverUrlFor(asset.id), assetId: asset.id };
}

/**
 * After a cover is replaced, removes the old library asset if it was the member's own and nothing uses it any
 * more (the book and the project it came from can share one). Best effort: a failure only leaves an unused
 * image in their library.
 */
export async function releaseReplacedCover(media: MediaRepository, memberId: string, previousAssetId: string | null, newAssetId: string | null): Promise<void> {
  if (!previousAssetId || previousAssetId === newAssetId) return;
  try {
    const asset = await media.byId(previousAssetId);
    if (!asset || asset.deleted_at || asset.owner_member_id !== memberId) return;
    if ((await media.usages(previousAssetId)).length > 0) return;
    await media.remove(previousAssetId);
  } catch (error) {
    console.error("Couldn't release a replaced book cover:", error);
  }
}
