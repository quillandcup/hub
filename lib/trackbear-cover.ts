import { randomUUID } from "crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOK_COVER_HEIGHT, BOOK_COVER_WIDTH } from "@/lib/bookCover";
import { TRACKBEAR_ORIGIN } from "@/lib/trackbear-import";
import type { CoverCopier } from "@/lib/trackbear-import-runner";

// TrackBear names uploaded covers "<uuid>.<ext>" (server/api/v1/project.ts handleUploadCover).
// Anything else is refused rather than interpolated into a fetch URL.
const TRACKBEAR_COVER_FILENAME = /^[0-9a-f-]{36}\.(apng|avif|gif|jpeg|png|svg|webp)$/i;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024; // TrackBear caps uploads at 2MB; leave headroom
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Copies a TrackBear project cover (public at trackbear.app/uploads/covers/<file>) into the same
 * book-covers bucket /api/bookshelf/cover uses. TrackBear accepts any size and seven formats; Hub
 * covers are PNG/JPEG at exactly 145x215 (lib/bookCover.ts), so every cover is center-cropped to
 * that size and re-encoded as JPEG.
 */
export function makeTrackbearCoverCopier(supabase: SupabaseClient): CoverCopier {
  return async (coverFilename, memberId) => {
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

    let jpeg: Buffer;
    let resizedFrom: string | null = null;
    try {
      const image = sharp(source);
      const { width, height } = await image.metadata();
      if (width !== BOOK_COVER_WIDTH || height !== BOOK_COVER_HEIGHT) resizedFrom = `${width}×${height}`;
      jpeg = await image
        .resize(BOOK_COVER_WIDTH, BOOK_COVER_HEIGHT, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (err) {
      console.error("TrackBear cover conversion failed:", coverFilename, err);
      return { error: "couldn't read the TrackBear cover image; upload it by hand." };
    }

    const path = `${memberId}/${randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("book-covers")
      .upload(path, jpeg, { contentType: "image/jpeg" });
    if (uploadError) {
      console.error("TrackBear cover upload failed:", uploadError);
      return { error: "upload to Hub failed; upload it by hand." };
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("book-covers").getPublicUrl(path);
    return { url: publicUrl, resizedFrom };
  };
}
