import { KAJABI_PHOTO_HOSTS, KAJABI_SITE_URL } from "@/lib/config";
import { LandingPageSlugTakenError, type LandingPage, type LandingPageRepository } from "@/lib/data/landing-pages";
import type { MediaRepository } from "@/lib/data/media";
import { checkLandingPage, type A11yIssue } from "@/lib/landing/a11y";
import { mapAssetIds, normalizeLandingData } from "@/lib/landing/data";
import { mapKajabiPage, type ImportNote, type PictureSource } from "@/lib/landing/kajabi-import";
import { readKajabiZip } from "@/lib/landing/kajabi-zip";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isValidSlug, slugify, SLUG_MAX } from "@/lib/landing/slug";
import { storeImage } from "@/lib/media/library";
import { safeGet } from "@/lib/net/safe-fetch";

/**
 * "Import from Kajabi" (docs/LANDING_PAGES.md): an uploaded Kajabi page export becomes a draft page. The mapping is
 * `mapKajabiPage` (deterministic, no model); this is the rest: read the archive safely, fetch the pictures into the
 * media library (private until a page that shows them is published), and save. The page is found again by its import
 * key, so a repeat import replaces that page's draft and nothing else: never its published copy, versions, title or
 * address. Before an unconfirmed draft is replaced, the admin is asked, and the old draft is kept in the page's history.
 */

const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 15_000;
const MAX_PICTURES = 30;
/** Where a Kajabi upload path such as `file-uploads/sites/...` lives on the CDN. */
const CDN_PATH = "kajabi-storefronts-production";

export type FetchPicture = (url: string) => Promise<{ bytes: Buffer } | { error: string }>;

/** https only, and only the Kajabi CDN: an export must not make the server fetch from anywhere else. Public hosts only, 8 MB, 15 s. */
export const fetchKajabiPicture: FetchPicture = async (address) => {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { error: "not an address" };
  }
  if (url.protocol !== "https:" || !KAJABI_PHOTO_HOSTS.includes(url.hostname)) return { error: "not on the Kajabi picture host" };
  const got = await safeGet(url, { maxBytes: MAX_PICTURE_BYTES, timeoutMs: PICTURE_TIMEOUT_MS, allowHttp: false, accept: "image/*" });
  return got.ok ? { bytes: got.bytes } : { error: got.reason === "too_large" ? "too large" : got.detail };
};

export interface ImportDeps {
  pages: LandingPageRepository;
  media: MediaRepository;
  /** Service role, for the media files. */
  storage: Parameters<typeof storeImage>[1];
  fetchPicture?: FetchPicture;
}

export type ImportOutcome =
  | { status: "error"; error: string }
  /** Nothing was written: the admin must confirm replacing what is there. */
  | { status: "confirm"; reasons: string[]; existing: { title: string; slug: string } }
  | {
      status: "imported";
      /** "created" a new draft, "updated" the draft of a page imported before. */
      action: "created" | "updated";
      slug: string;
      title: string;
      /** The page was live: it stays as it is until the draft is published. */
      published: boolean;
      /** The old draft was kept in the page's history. */
      keptBefore: boolean;
      notes: ImportNote[];
      issues: A11yIssue[];
      counts: { blocks: number; hidden: number; pictures: number; picturesFailed: number };
    };

/** Two documents are the same whatever order their keys come in (the database sorts them). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const sameDocument = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const isEmptyDocument = (d: unknown) => normalizeLandingData(d).content.length === 0;

/** Why replacing this page's draft needs a yes: the draft has changes only it holds, or the export is a different page than the one named. */
export function replaceReasons(page: LandingPage, typedTitle: string): string[] {
  const reasons: string[] = [];
  const live = page.status === "published";
  const sameAsLive = live && sameDocument(page.draft_data, page.published_data);
  // Publishing also moves `updated_at`, and a draft equal to the live page has nothing that would be lost.
  if (page.imported_at && Date.parse(page.updated_at) > Date.parse(page.imported_at) && !sameAsLive) reasons.push("Its draft was edited after the last import. Those edits will be replaced (the old draft is kept in the page's history).");
  if (live && !sameAsLive) reasons.push("Its draft has unpublished changes that differ from the live page. They will be replaced (the old draft is kept in the page's history); the live page doesn't change.");
  if (typedTitle.trim() && typedTitle.trim().toLowerCase() !== page.title.trim().toLowerCase()) reasons.push(`This export matches the page "${page.title}", which you named "${typedTitle.trim()}". Its draft will be replaced.`);
  return reasons;
}

async function freeSlug(pages: LandingPageRepository, wish: string, taken: Set<string>): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${wish.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate) && isValidSlug(candidate) && !(await pages.bySlug(candidate))) return candidate;
  }
  throw new Error("no free address found");
}

export async function importKajabiExport(
  deps: ImportDeps,
  input: { archive: Uint8Array; title: string; confirm: boolean; userId: string | null; year: number },
): Promise<ImportOutcome> {
  const zip = readKajabiZip(input.archive);
  if (!zip.ok) return { status: "error", error: zip.error };
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(zip.settings));
  } catch {
    return { status: "error", error: "The page's settings in that export couldn't be read." };
  }
  const mapped = mapKajabiPage(settings, { siteUrl: KAJABI_SITE_URL, cdnBase: `https://${KAJABI_PHOTO_HOSTS[0]}/${CDN_PATH}`, year: input.year });
  if (!mapped.ok) return { status: "error", error: mapped.error };

  const title = input.title.trim().slice(0, 120);
  const existing = await deps.pages.byImportKey(mapped.importKey);
  if (!existing && !title) return { status: "error", error: "Give the page a title: the export doesn't have one." };
  if (existing && !input.confirm) {
    const reasons = replaceReasons(existing, title);
    if (reasons.length > 0) return { status: "confirm", reasons, existing: { title: existing.title, slug: existing.slug } };
  }

  // Pictures: the export's own files first, a Kajabi upload from the CDN otherwise. A picture that can't be had is left out, and said.
  const notes = [...mapped.notes];
  const ids = new Map<string, string>();
  let failed = 0;
  const wanted = mapped.pictures.slice(0, MAX_PICTURES);
  if (mapped.pictures.length > MAX_PICTURES) notes.push({ kind: "left_out", text: `The page has ${mapped.pictures.length} pictures; only the first ${MAX_PICTURES} were imported.` });
  const getPicture = deps.fetchPicture ?? fetchKajabiPicture;
  for (const [index, picture] of wanted.entries()) {
    const found = await pictureBytes(picture, zip.images, getPicture);
    const stored = "error" in found ? found : await storeImage(deps.media, deps.storage, { bytes: found.bytes, title: `${title || existing?.title || "Imported"} (picture ${index + 1})`.slice(0, 120), source: "kajabi", sourceKey: `import:${mapped.importKey}:${picture.zipName ?? picture.url ?? index}`.slice(0, 300), tags: ["imported"], createdBy: input.userId });
    if ("error" in stored) {
      failed++;
      notes.push({ kind: "left_out", text: `Picture ${index + 1} couldn't be imported (${stored.error}); add it in the editor.` });
    } else ids.set(picture.placeholder, stored.asset.id);
  }
  const data = sanitizeLandingData(mapAssetIds(mapped.data, (value) => ids.get(value) ?? (value.startsWith("kajabi-import-picture:") ? "" : value)));
  const issues = checkLandingPage(data);
  const counts = { blocks: mapped.counts.blocks, hidden: mapped.counts.hidden, pictures: ids.size, picturesFailed: failed + Math.max(0, mapped.pictures.length - MAX_PICTURES) };

  if (existing) {
    // The old draft stays restorable from the page's history, unless there was nothing in it.
    const keep = !isEmptyDocument(existing.draft_data) && !sameDocument(existing.draft_data, data);
    if (keep) await deps.pages.keepDraftBeforeImport(existing.id, input.userId, "Replaced by a Kajabi import");
    const page = await deps.pages.replaceImportedDraft(existing.id, data, input.userId);
    if (!page) return { status: "error", error: "That page was deleted while the import ran." };
    return { status: "imported", action: "updated", slug: page.slug, title: page.title, published: page.status === "published", keptBefore: keep, notes, issues, counts };
  }

  const taken = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await freeSlug(deps.pages, slugify(title) || "page", taken);
    try {
      const page = await deps.pages.create({ title, slug, data, createdBy: input.userId, importKey: mapped.importKey });
      return { status: "imported", action: "created", slug: page.slug, title: page.title, published: false, keptBefore: false, notes, issues, counts };
    } catch (error) {
      if (!(error instanceof LandingPageSlugTakenError)) throw error;
      // The address was taken a moment ago, or another import of this same page just landed.
      const raced = await deps.pages.byImportKey(mapped.importKey);
      if (raced) {
        const page = await deps.pages.replaceImportedDraft(raced.id, data, input.userId);
        if (page) return { status: "imported", action: "updated", slug: page.slug, title: page.title, published: page.status === "published", keptBefore: false, notes, issues, counts };
      }
      taken.add(slug);
    }
  }
  return { status: "error", error: "Couldn't find a free address for the page." };
}

async function pictureBytes(picture: PictureSource, images: Map<string, Uint8Array>, get: FetchPicture): Promise<{ bytes: Buffer } | { error: string }> {
  if (picture.zipName) {
    const file = images.get(picture.zipName);
    if (file) return { bytes: Buffer.from(file) };
    if (!picture.url) return { error: "it isn't in the export" };
  }
  return picture.url ? get(picture.url) : { error: "no source" };
}

