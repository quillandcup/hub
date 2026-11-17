import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

/**
 * Reads a Kajabi page export (a zip of the page's theme) for the importer, in memory and with limits, because the
 * archive comes from a person's upload and is untrusted. Nothing is written to disk or run. Only two kinds of entry
 * are ever decompressed: `config/settings_data.json` (the page's content) and the images in `assets/`; every other
 * entry (scripts, styles, templates) is skipped without being inflated, so it costs nothing and cannot hurt. Each
 * entry is counted as it is inflated, not by the size its header claims, and the read stops the moment a limit is
 * passed. A name with `..`, a leading `/`, a backslash or a drive letter makes the whole archive refused.
 */

export const ZIP_LIMITS = {
  /** The uploaded file. */
  archiveBytes: 4 * 1024 * 1024,
  /** Entries in the archive (a Kajabi theme has about a hundred). */
  entries: 1000,
  settingsBytes: 2 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  /** Everything inflated together. */
  totalBytes: 24 * 1024 * 1024,
} as const;

const SETTINGS = /(^|\/)config\/settings_data\.json$/;
const IMAGE = /(^|\/)assets\/([^/]+\.(?:png|jpe?g|gif|webp))$/i;

export type ZipRead = { ok: true; settings: Uint8Array; images: Map<string, Uint8Array> } | { ok: false; error: string };

const unsafeName = (name: string) => name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..");

export type ZipLimits = { [K in keyof typeof ZIP_LIMITS]: number };

export function readKajabiZip(archive: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipRead {
  if (archive.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (archive.byteLength > limits.archiveBytes) return { ok: false, error: "That file is too large for a page export." };
  // A zip starts with "PK".
  if (archive[0] !== 0x50 || archive[1] !== 0x4b) return { ok: false, error: "That isn't a zip file." };

  let failure: string | null = null;
  let entries = 0;
  let total = 0;
  let settings: Uint8Array | null = null;
  const images = new Map<string, Uint8Array>();
  const stop = (message: string) => {
    failure ??= message;
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    if (failure) return;
    if (++entries > limits.entries) return stop("That archive has too many files to be a page export.");
    if (unsafeName(file.name)) return stop("That archive has a file name that isn't allowed.");
    if (file.name.startsWith("__MACOSX/") || file.name.endsWith("/")) return;
    const isSettings = SETTINGS.test(file.name);
    const imageName = IMAGE.exec(file.name)?.[2];
    if (!isSettings && !imageName) return; // never inflated
    const cap = isSettings ? limits.settingsBytes : limits.imageBytes;
    if (isSettings ? settings : images.has(imageName!)) return; // the first of a name wins
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) return stop("That archive could not be read.");
      size += chunk.byteLength;
      total += chunk.byteLength;
      if (size > cap || total > limits.totalBytes) {
        file.terminate();
        return stop("That archive is too large when unpacked.");
      }
      chunks.push(chunk);
      if (final) {
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.byteLength;
        }
        if (isSettings) settings = out;
        else images.set(imageName!, out);
      }
    };
    file.start();
  };

  try {
    unzip.push(archive, true);
  } catch {
    return { ok: false, error: "That archive could not be read." };
  }
  if (failure) return { ok: false, error: failure };
  if (!settings) return { ok: false, error: "That doesn't look like a Kajabi page export: it has no config/settings_data.json." };
  return { ok: true, settings, images };
}
