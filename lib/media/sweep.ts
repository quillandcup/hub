import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import type { MediaRepository } from "@/lib/data/media";
import { MEDIA_BUCKET } from "./library";

type Storage = Pick<SupabaseClient["storage"], "from">;

/** An upload that was started and never confirmed is abandoned after this long. */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** A deleted image is kept this long (nothing in the app undoes a delete, but staff can ask for one), then its files go. */
export const DELETED_KEEP_DAYS = 30;
/** How many deleted images one run clears; the rest go on the following nights. */
const MAX_ASSETS_PER_RUN = 200;
/** Stop starting new work after this long, to finish inside the function's limit. */
const BUDGET_MS = 240_000;
const PAGE = 1000;
const REMOVE_CHUNK = 100;

export interface SweepResult {
  /** Unconfirmed uploads removed from `uploads/`. */
  staleUploads: number;
  /** Deleted images whose files (original and renditions) were removed. */
  assetsCleared: number;
  /** Deleted images something still uses, left alone. */
  assetsInUse: number;
  /** Deleted images whose files couldn't be removed; tried again next time. */
  failed: number;
}

/**
 * Housekeeping for the media bucket, nightly (/api/reconcile/media):
 * 1. removes objects left in `uploads/` for over a day (a signed upload that was never confirmed);
 * 2. removes the files of images deleted over `DELETED_KEEP_DAYS` ago, and notes on the row that it did,
 *    so the row (and its title and tags) stays but the bytes don't. An image something still shows is skipped.
 * `storage` and `media` need the service role.
 */
export async function sweepMedia(media: MediaRepository, storage: Storage): Promise<SweepResult> {
  const result: SweepResult = { staleUploads: 0, assetsCleared: 0, assetsInUse: 0, failed: 0 };
  const started = clock.now();
  const bucket = storage.from(MEDIA_BUCKET);

  // 1. Unconfirmed uploads.
  const staleBefore = started - STALE_UPLOAD_MS;
  const stale: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list("uploads", { limit: PAGE, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) throw new Error(`media uploads list failed: ${error.message}`);
    for (const object of data ?? []) {
      if (object.id === null) continue; // a folder
      const created = Date.parse(object.created_at ?? "");
      if (Number.isFinite(created) && created < staleBefore) stale.push(`uploads/${object.name}`);
    }
    if (!data || data.length < PAGE) break;
  }
  for (let i = 0; i < stale.length; i += REMOVE_CHUNK) {
    const chunk = stale.slice(i, i + REMOVE_CHUNK);
    const { error } = await bucket.remove(chunk);
    if (error) {
      console.error("Couldn't remove stale media uploads:", error.message);
      result.failed += chunk.length;
    } else {
      result.staleUploads += chunk.length;
    }
  }

  // 2. The files of images deleted long ago.
  const deletedBefore = new Date(started - DELETED_KEEP_DAYS * 24 * 60 * 60 * 1000);
  for (const asset of await media.expiredDeleted(deletedBefore, MAX_ASSETS_PER_RUN)) {
    if (clock.now() - started > BUDGET_MS) break;
    try {
      if ((await media.usages(asset.id)).length > 0) {
        result.assetsInUse++;
        continue;
      }
      const { data: renditions, error: listError } = await bucket.list(`renditions/${asset.id}`, { limit: PAGE });
      if (listError) throw new Error(listError.message);
      const paths = [asset.storage_path, ...(renditions ?? []).filter((o) => o.id !== null).map((o) => `renditions/${asset.id}/${o.name}`)];
      const { error: removeError } = await bucket.remove(paths);
      if (removeError) throw new Error(removeError.message);
      await media.markFilesRemoved(asset.id);
      result.assetsCleared++;
    } catch (error) {
      console.error("Couldn't clear the files of deleted media asset %s:", asset.id, error);
      result.failed++;
    }
  }
  return result;
}
