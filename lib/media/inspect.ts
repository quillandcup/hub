import { createHash } from "crypto";
import sharp from "sharp";

/** The largest original we keep; matches the `media` bucket's limit. */
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** Refuse to decode anything bigger than this many pixels (a decompression bomb is a small file with a huge canvas). */
export const MAX_PIXELS = 100_000_000;

const FORMATS: Record<string, { mime: string; extension: string }> = {
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  png: { mime: "image/png", extension: "png" },
  webp: { mime: "image/webp", extension: "webp" },
  gif: { mime: "image/gif", extension: "gif" },
  avif: { mime: "image/avif", extension: "avif" },
};

export type Inspection =
  | { ok: true; mime: string; extension: string; width: number; height: number; sha256: string }
  | { ok: false; error: string; heic?: true };

/**
 * What an upload really is, from its bytes: never the browser's content type or the file name. SVG is
 * refused (it can carry script). HEIC is reported with `heic: true` so the caller can convert it first
 * (lib/media/heic.ts); sharp's build can read its header but not decode it.
 * Width and height are as the picture is shown, after EXIF orientation.
 */
export async function inspectImage(bytes: Buffer): Promise<Inspection> {
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty" };
  if (bytes.byteLength > MAX_ORIGINAL_BYTES) return { ok: false, error: `That file is larger than ${MAX_ORIGINAL_BYTES / (1024 * 1024)} MB` };
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return { ok: false, error: "That doesn't look like an image we can read. Use a JPEG, PNG, WebP, GIF or AVIF" };
  }
  let key: string = meta.format ?? "";
  if (key === "heif") key = meta.compression === "av1" ? "avif" : "heic";
  if (key === "heic") return { ok: false, heic: true, error: "HEIC photos need converting to JPEG first" };
  const format = FORMATS[key];
  if (!format) return { ok: false, error: "Use a JPEG, PNG, WebP, GIF or AVIF image" };
  if (!meta.width || !meta.height) return { ok: false, error: "Couldn't read that image's size" };
  if (meta.width * meta.height > MAX_PIXELS) return { ok: false, error: "That image is too large to process" };
  // EXIF orientations 5-8 turn the picture a quarter turn, so width and height swap.
  const turned = (meta.orientation ?? 1) >= 5;
  return {
    ok: true,
    mime: format.mime,
    extension: format.extension,
    width: turned ? meta.height : meta.width,
    height: turned ? meta.width : meta.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
