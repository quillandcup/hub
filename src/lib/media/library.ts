import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaAsset, MediaRepository } from "@/lib/data/media";
import { heicToJpeg } from "./heic";
import { inspectImage } from "./inspect";
import { renderPreset, renditionPath, settingsFor } from "./render";
import { PRESETS, tooSmallFor, type PresetName } from "./presets";

export const MEDIA_BUCKET = "media";

type Storage = Pick<SupabaseClient["storage"], "from">;

export type StoreResult =
  | { ok: true; asset: MediaAsset; duplicate: boolean; convertedFrom: "heic" | null }
  | { ok: false; error: string };

/** The longest key an import builds (`kajabi-import-service.ts`). */
const SOURCE_KEY_MAX = 300;

/** `<key>#<12 hex of the bytes' hash>`, shortening the key (never the hash) to stay within the cap. */
export function versionedKey(key: string, sha256: string): string {
  const suffix = `#${sha256.slice(0, 12)}`;
  return `${key.slice(0, SOURCE_KEY_MAX - suffix.length)}${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /duplicate key value violates unique constraint/i.test(error.message);
}

/** A title from a file name: no extension, separators as spaces. */
export function titleFromFileName(name: string | null | undefined): string {
  const base = (name ?? "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled").slice(0, 120);
}

/**
 * Keeps an uploaded image in a library: checks what it is (a HEIC photo is converted to JPEG first), returns the asset already holding the same
 * bytes if there is one (the same file twice is one asset), otherwise stores the original, untouched, at
 * `originals/<owner or "shared">/<sha256>.<ext>` and adds the row. The path is a function of the bytes, so
 * a retry after a failure between the two steps lands on the same object.
 */
export async function storeImage(
  media: MediaRepository,
  storage: Storage,
  input: {
    bytes: Buffer;
    title?: string | null;
    ownerMemberId?: string | null;
    createdBy?: string | null;
    tags?: string[];
    isPublic?: boolean;
    /** Where it came from (an import's name and the key that identifies it there), for an image that isn't an upload. */
    source?: "upload" | "kajabi" | "video_frame" | "event_photo";
    sourceKey?: string | null;
  }
): Promise<StoreResult> {
  let bytes = input.bytes;
  let convertedFrom: "heic" | null = null;
  let inspected = await inspectImage(bytes);
  if (!inspected.ok && inspected.heic) {
    const jpeg = await heicToJpeg(bytes);
    if (!jpeg) return { ok: false, error: "Couldn't read that HEIC photo. Export it as a JPEG and upload that" };
    bytes = jpeg;
    convertedFrom = "heic";
    inspected = await inspectImage(bytes);
  }
  if (!inspected.ok) return { ok: false, error: inspected.error };
  const owner = input.ownerMemberId ?? null;

  const existing = await media.bySha(inspected.sha256, owner);
  if (existing) return { ok: true, asset: existing, duplicate: true, convertedFrom };

  const path = `originals/${owner ?? "shared"}/${inspected.sha256}.${inspected.extension}`;
  const { error: uploadError } = await storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: inspected.mime, upsert: true });
  if (uploadError) throw new Error(`media upload failed: ${uploadError.message}`);

  const fields = {
    storage_path: path,
    mime_type: inspected.mime,
    width: inspected.width,
    height: inspected.height,
    bytes: bytes.byteLength,
    sha256: inspected.sha256,
    title: (input.title?.trim() || "Untitled").slice(0, 120),
    tags: input.tags,
    owner_member_id: owner,
    created_by: input.createdBy ?? null,
    is_public: input.isPublic ?? false,
    source: input.source ?? "upload",
  };
  const origin = input.sourceKey ? { source: fields.source, key: input.sourceKey } : null;
  // A row that isn't an upload must have a key, and only one live asset can hold a key. When the key is already held by an asset with
  // other bytes (the source serves a changed picture), this picture takes the key plus a short hash of its bytes: still the same
  // for the same bytes, so a later re-import finds it again.
  const held = origin ? await media.bySource(origin.source, origin.key) : null;
  const key = origin ? (held && held.sha256 !== inspected.sha256 ? versionedKey(origin.key, inspected.sha256) : origin.key) : null;
  let asset: MediaAsset;
  try {
    asset = await media.add({ ...fields, source_key: key });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request stored these bytes, or this key, a moment ago: use what is there.
    const same = (await media.bySha(inspected.sha256, owner)) ?? (key ? await media.bySource(fields.source, key) : null);
    if (same && same.sha256 === inspected.sha256) return { ok: true, asset: same, duplicate: true, convertedFrom };
    if (!origin) throw error;
    // The key was taken meanwhile by other bytes: the hashed key is the one left.
    const hashed = versionedKey(origin.key, inspected.sha256);
    if (hashed === key) throw error;
    asset = await media.add({ ...fields, source_key: hashed });
  }
  return { ok: true, asset, duplicate: false, convertedFrom };
}

export type RenditionResult =
  | { ok: true; body: Buffer | Uint8Array; contentType: string }
  | { ok: false; status: 422 | 502; error: string };

/**
 * The asset at this preset's size: the cached rendition if there is one, otherwise made from the original
 * and cached. A preset with a minimum source size (the Amazon cover) refuses a smaller picture with the reason.
 */
export async function renditionOf(storage: Storage, asset: MediaAsset, name: PresetName): Promise<RenditionResult> {
  const preset = PRESETS[name];
  const small = tooSmallFor(asset, preset);
  if (small) return { ok: false, status: 422, error: small };

  const bucket = storage.from(MEDIA_BUCKET);
  const settings = settingsFor(asset, name);
  const path = renditionPath(asset, name, settings);
  const cached = await bucket.download(path);
  if (cached.data) return { ok: true, body: new Uint8Array(await cached.data.arrayBuffer()), contentType: cached.data.type || (preset.format === "jpeg" ? "image/jpeg" : "image/webp") };

  const original = await bucket.download(asset.storage_path);
  if (original.error || !original.data) {
    console.error("Couldn't read a media original:", asset.id, original.error?.message);
    return { ok: false, status: 502, error: "Couldn't load the image" };
  }
  const { body, contentType } = await renderPreset(Buffer.from(await original.data.arrayBuffer()), name, settings);
  const { error } = await bucket.upload(path, body, { contentType, upsert: true });
  if (error) console.error("Couldn't cache a media rendition:", asset.id, name, error.message); // served anyway; the next request tries again
  return { ok: true, body, contentType };
}
