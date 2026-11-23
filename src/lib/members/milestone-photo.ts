import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MILESTONE_PHOTO } from "@/lib/config";
import { inspectImage, MAX_PIXELS } from "@/lib/media/inspect";
import { MAX_MILESTONE_UPLOAD_LABEL, MILESTONE_PHOTO_BUCKET, milestonePhotoPath, tokenOfPath } from "@/lib/milestone-photos";
import { UPLOAD_TYPES } from "@/lib/members/photo";

/**
 * The bytes of a photo on a milestone (docs/product/FINISHERS.md, "Photos"). Same care as the profile photo
 * (`src/lib/members/photo.ts`): the type is decided by sniffing the bytes, never by the file name or the browser's type, and the
 * picture is re-encoded, which drops EXIF (including where it was taken) and every other piece of metadata. The result is a WebP
 * of at most `maxEdge` pixels on its longest side, in the private `milestone-photos` bucket under the member's own folder.
 * Only server code writes to the bucket: it has no storage policy.
 */

export interface MilestonePhotoStore {
  upload(path: string, bytes: Buffer): Promise<void>;
  remove(path: string): Promise<void>;
  download(path: string): Promise<Buffer | null>;
}

/** The store over the (service-role) storage client. */
export function milestonePhotoStore(supabase: SupabaseClient): MilestonePhotoStore {
  const bucket = () => supabase.storage.from(MILESTONE_PHOTO_BUCKET);
  return {
    async upload(path, bytes) {
      const { error } = await bucket().upload(path, bytes, { contentType: "image/webp", upsert: false });
      if (error) throw new Error(error.message);
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(error.message);
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

export type PreparedMilestonePhoto = { ok: true; encoded: Buffer } | { ok: false; error: string };

/** An upload, checked and re-encoded: the size, then what the bytes really are, then a WebP without metadata, turned upright. */
export async function prepareMilestonePhoto(bytes: Buffer): Promise<PreparedMilestonePhoto> {
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (bytes.byteLength > MILESTONE_PHOTO.maxUploadBytes) return { ok: false, error: `Use a photo of ${MAX_MILESTONE_UPLOAD_LABEL} or less.` };
  const inspected = await inspectImage(bytes);
  if (!inspected.ok) return { ok: false, error: inspected.heic ? "Use a JPEG, PNG or WebP photo (a HEIC photo needs saving as a JPEG first)." : "That doesn't look like a photo we can use. Use a JPEG, PNG or WebP photo." };
  if (!(UPLOAD_TYPES as readonly string[]).includes(inspected.mime)) return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  try {
    const encoded = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(MILESTONE_PHOTO.maxEdge, MILESTONE_PHOTO.maxEdge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: MILESTONE_PHOTO.quality })
      .toBuffer();
    return { ok: true, encoded };
  } catch {
    return { ok: false, error: "We couldn't read that photo. Try another one." };
  }
}

/** A new random file name: 128 random bits as hex. */
export function newPhotoToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Stores a prepared photo for the member and returns where it is. The caller then writes the path on the row and, once that
 * has worked, deletes the file it replaces (`discardPhoto`): a file with no row pointing at it is harmless and unreachable, a row
 * pointing at no file is not.
 */
export async function storeMilestonePhoto(store: MilestonePhotoStore, memberId: string, encoded: Buffer): Promise<string> {
  const path = milestonePhotoPath(memberId, newPhotoToken());
  await store.upload(path, encoded);
  return path;
}

/** Deletes a file that is no longer pointed at, best effort (a leftover file is unreachable and harmless). */
export async function discardPhoto(store: MilestonePhotoStore, path: string | null | undefined): Promise<void> {
  if (!path || !tokenOfPath(path)) return;
  await store.remove(path).catch((error) => console.error("[milestone-photo] Couldn't delete a photo file", error));
}
