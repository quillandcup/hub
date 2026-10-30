import type { SupabaseClient } from "@supabase/supabase-js";
import { bookCoverUrlFor } from "@/lib/bookCover";
import type { MediaRepository } from "@/lib/data/media";
import { storeImage } from "@/lib/media/library";
import { TRACKBEAR_ORIGIN } from "@/lib/trackbear-import";
import type { CoverCopier } from "@/lib/trackbear-import-runner";

// TrackBear names uploaded covers "<uuid>.<ext>" (server/api/v1/project.ts handleUploadCover).
// Anything else is refused rather than interpolated into a fetch URL.
const TRACKBEAR_COVER_FILENAME = /^[0-9a-f-]{36}\.(apng|avif|gif|jpeg|png|svg|webp)$/i;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024; // TrackBear caps uploads at 2MB; leave headroom
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Copies a TrackBear project cover (public at trackbear.app/uploads/covers/<file>) into the media library as the
 * member's own image, at its original size: the Bookshelf size and the Amazon cover are made from it when asked for
 * (docs/MEDIA_LIBRARY.md). The same file imported again is the same library image. TrackBear also accepts SVG,
 * which the library refuses, so that cover is reported for the member to upload by hand. `storage` needs the
 * service role.
 */
export function makeTrackbearCoverCopier(media: MediaRepository, storage: SupabaseClient["storage"]): CoverCopier {
  return async (coverFilename, memberId, title) => {
    if (!TRACKBEAR_COVER_FILENAME.test(coverFilename)) return { error: "unrecognized cover filename." };

    let source: Buffer;
    try {
      const res = await fetch(`${TRACKBEAR_ORIGIN}/uploads/covers/${coverFilename}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { error: `couldn't download it from TrackBear (HTTP ${res.status}); upload it by hand.` };
      source = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.error("TrackBear cover download failed:", coverFilename, err);
      return { error: "couldn't download it from TrackBear; upload it by hand." };
    }
    if (source.length > MAX_SOURCE_BYTES) return { error: "the TrackBear cover file is too large; upload it by hand." };

    try {
      const stored = await storeImage(media, storage, { bytes: source, title, ownerMemberId: memberId });
      if (!stored.ok) return { error: `couldn't use the TrackBear cover (${stored.error}); upload it by hand.` };
      return { url: bookCoverUrlFor(stored.asset.id), assetId: stored.asset.id };
    } catch (err) {
      console.error("TrackBear cover upload failed:", coverFilename, err);
      return { error: "upload to Hub failed; upload it by hand." };
    }
  };
}
