import { KAJABI_COURSES_URL, KAJABI_PHOTO_HOSTS, KAJABI_SITE_URL } from "@/lib/config";
import type { BillingRepository } from "@/lib/data/billing";
import { LandingPageSlugTakenError, type LandingPage, type LandingPageRepository, type LandingPageSummary } from "@/lib/data/landing-pages";
import type { MediaRepository } from "@/lib/data/media";
import { checkLandingPage, type A11yIssue } from "@/lib/landing/a11y";
import { mapAssetIds, normalizeLandingData, sameDocument, sameLandingPage } from "@/lib/landing/data";

export { sameDocument };
import { freeImportKey, keyHasLayout, mapKajabiPage, pageStart, type ImportNote, type PageStart, type PictureSource } from "@/lib/landing/kajabi-import";
import { applyAltEntries, defaultAltComplete, parseAltEntries, pictureSlots, suggestAltTexts, type AltSuggestion, type PictureSlot } from "@/lib/landing/kajabi-alt-text";
import type { Complete } from "@/lib/landing/ai";
import { resolveReferences, type KajabiLookups, type LookupFetchers } from "@/lib/landing/kajabi-lookups";
import { readKajabiZip } from "@/lib/landing/kajabi-zip";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isValidSlug, slugify, SLUG_MAX } from "@/lib/landing/slug";
import { storeImage } from "@/lib/media/library";
import { safeGet } from "@/lib/net/safe-fetch";

/**
 * "Import from Kajabi" (docs/product/LANDING_PAGES.md): an uploaded Kajabi page export becomes a draft page. The mapping is
 * `mapKajabiPage` (deterministic, no model); this is the rest: read the archive safely, fetch the pictures into the
 * media library (private until a page that shows them is published), and save. The admin says what the export is: a
 * new page, or the page whose draft it replaces. A page with the same layout (the import key, kajabi-import.ts) is
 * only ever offered, never assumed: without a choice the import asks. A replace changes that page's draft and nothing
 * else (never its published copy, versions, title or address), and the old draft is kept in the page's history.
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
  /** The Hub's Kajabi offers, to turn a link to an offer into its checkout page. */
  billing?: Pick<BillingRepository, "kajabiOfferRows">;
  /** How the live Kajabi site is read for what the export only names (tests replace it; kajabi-lookups.ts). */
  lookupFetchers?: LookupFetchers;
}

/** A page that looks like the export: it has the same layout (`layoutFingerprint` in kajabi-import.ts). Never proof that it is the same page. */
export type PageMatch = {
  id: string;
  title: string;
  slug: string;
  /** What the page's draft starts with now, to compare with the export's. */
  draftHeading: string;
  published: boolean;
  /** The draft was changed in the editor after the last import. */
  edited: boolean;
  /** The draft differs from the live page, so replacing it also loses changes nobody published. */
  unpublishedChanges: boolean;
};

/** A page an import can replace: one made by an import. */
export type ReplaceablePage = { id: string; title: string; slug: string };

export type InspectOutcome =
  | { status: "error"; error: string }
  | {
      status: "inspected";
      /** What the export starts with, and a title to start from (the export has none). */
      start: PageStart;
      suggestedTitle: string;
      blocks: number;
      /** How many countdowns the page has: their dates are read from the live page when its address is given. */
      countdowns: number;
      /** The pictures that came without a description, with a first suggestion each (the dialog may ask the model for better ones). */
      pictures: PictureSlot[];
      /** Pages with the same layout: often none, several when pages were cloned from each other. */
      matches: PageMatch[];
      /** Every page made by an import, for "replace another page". */
      pages: ReplaceablePage[];
    };

/** What the admin chose: a new page, or replacing the draft of this page. */
export type ImportTarget = { kind: "new" } | { kind: "replace"; pageId: string };

export type ImportOutcome =
  | { status: "error"; error: string }
  /** Nothing was written: a page has the same layout, and the admin must choose between replacing it and a new page. */
  | { status: "choose"; matches: PageMatch[]; pages: ReplaceablePage[] }
  | {
      status: "imported";
      /** "created" a new draft, "updated" the draft of an existing page. */
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


const isEmptyDocument = (d: unknown) => normalizeLandingData(d).content.length === 0;

/** What the admin is told about a page the import would replace: where it stands, so they see what the replacement would lose. */
export function matchOf(page: LandingPage): PageMatch {
  const published = page.status === "published";
  const sameAsLive = published && sameLandingPage(page.draft_data, page.published_data);
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    draftHeading: pageStart(normalizeLandingData(page.draft_data)).heading,
    published,
    // Publishing also moves `updated_at`, and a draft equal to the live page has nothing that would be lost.
    edited: Boolean(page.imported_at) && Date.parse(page.updated_at) > Date.parse(page.imported_at!) && !sameAsLive,
    unpublishedChanges: published && !sameAsLive,
  };
}

async function freeSlug(pages: LandingPageRepository, wish: string, taken: Set<string>): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${wish.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate) && isValidSlug(candidate) && !(await pages.bySlug(candidate))) return candidate;
  }
  throw new Error("no free address found");
}

type Mapped = Extract<ReturnType<typeof mapKajabiPage>, { ok: true }>;
type Read = { ok: true; zip: Extract<ReturnType<typeof readKajabiZip>, { ok: true }>; mapped: Mapped } | { ok: false; error: string };

function readExport(archive: Uint8Array, year: number, lookups?: KajabiLookups): Read {
  const zip = readKajabiZip(archive);
  if (!zip.ok) return { ok: false, error: zip.error };
  let settings: unknown;
  try {
    settings = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(zip.settings));
  } catch {
    return { ok: false, error: "The page's settings in that export couldn't be read." };
  }
  const mapped = mapKajabiPage(settings, { siteUrl: KAJABI_SITE_URL, cdnBase: `https://${KAJABI_PHOTO_HOSTS[0]}/${CDN_PATH}`, year, coursesUrl: KAJABI_COURSES_URL, lookups });
  return mapped.ok ? { ok: true, zip, mapped } : { ok: false, error: mapped.error };
}

const slotsOf = (mapped: Mapped) => pictureSlots(mapped.data, { logoBlockId: mapped.logoBlockId, pictures: mapped.pictures });

/**
 * Suggested descriptions for the pictures the export has none for (kajabi-alt-text.ts): written from the headings near each picture, never from
 * the pictures, by the model when it is set up and by rules otherwise. Writes nothing; the admin reviews the answer in the dialog.
 */
export async function suggestKajabiAltTexts(
  input: { archive: Uint8Array; year: number },
  deps: { complete?: Complete | null } = {},
): Promise<{ status: "error"; error: string } | { status: "suggested"; suggestions: AltSuggestion[]; ai: "used" | "not_set_up" | "failed" }> {
  const read = readExport(input.archive, input.year);
  if (!read.ok) return { status: "error", error: read.error };
  const answer = await suggestAltTexts(slotsOf(read.mapped), read.mapped.data, deps.complete === undefined ? defaultAltComplete() : deps.complete);
  return { status: "suggested", ...answer };
}

/** The pages made by an import (under a key of any version). */
async function importedPages(pages: LandingPageRepository): Promise<LandingPageSummary[]> {
  return (await pages.list("page")).filter((p) => p.import_key);
}

const replaceable = (p: { id: string; title: string; slug: string }): ReplaceablePage => ({ id: p.id, title: p.title, slug: p.slug });

/** Pages whose layout is the export's. A page imported under the first key format (which collided between pages) is never one. */
async function matchesFor(pages: LandingPageRepository, mapped: Mapped, imported: LandingPageSummary[]): Promise<PageMatch[]> {
  const found = await Promise.all(imported.filter((p) => keyHasLayout(p.import_key, mapped.layout)).map((p) => pages.byId(p.id)));
  return found.filter((p): p is LandingPage => Boolean(p)).map(matchOf);
}

/**
 * Reads an export without writing anything: what it starts with, a title to start from, and the pages that look like
 * it, so the admin can tell exports apart and choose before importing.
 */
export async function inspectKajabiExport(deps: Pick<ImportDeps, "pages">, input: { archive: Uint8Array; year: number }): Promise<InspectOutcome> {
  const read = readExport(input.archive, input.year);
  if (!read.ok) return { status: "error", error: read.error };
  const imported = await importedPages(deps.pages);
  return { status: "inspected", start: read.mapped.start, suggestedTitle: read.mapped.suggestedTitle, blocks: read.mapped.counts.blocks, countdowns: read.mapped.references.countdowns.length, pictures: slotsOf(read.mapped), matches: await matchesFor(deps.pages, read.mapped, imported), pages: imported.map(replaceable) };
}

export async function importKajabiExport(
  deps: ImportDeps,
  input: { archive: Uint8Array; title: string; target?: ImportTarget; userId: string | null; year: number; /** The descriptions the admin reviewed, by the id of the block that holds each picture (`{ alt, decorative }`). Pictures without an entry keep none. */ altTexts?: unknown; /** The path of the public Kajabi page the export came from (the export doesn't say), to read a countdown's date from it. */ originalPath?: string },
): Promise<ImportOutcome> {
  let read = readExport(input.archive, input.year);
  if (!read.ok) return { status: "error", error: read.error };
  // What the export only names (a page's address, an offer's checkout, a countdown's date) is looked up, and the page mapped again with the answers.
  const refs = read.mapped.references;
  if (refs.landingPageIds.length > 0 || refs.offerCodes.length > 0 || refs.countdowns.length > 0) {
    const lookups = await resolveReferences(refs, { originalPath: input.originalPath }, { fetchers: deps.lookupFetchers, offers: deps.billing ? () => deps.billing!.kajabiOfferRows() : undefined });
    const again = readExport(input.archive, input.year, lookups);
    if (again.ok) read = again;
  }
  const { zip, mapped } = read;

  const title = input.title.trim().slice(0, 120);
  const imported = await importedPages(deps.pages);
  const keys = new Set(imported.map((p) => p.import_key!));

  let existing: LandingPage | null = null;
  if (!input.target) {
    // Without a choice, an export that looks like a page already here is never imported over it: the admin is asked.
    const matches = await matchesFor(deps.pages, mapped, imported);
    if (matches.length > 0) return { status: "choose", matches, pages: imported.map(replaceable) };
  } else if (input.target.kind === "replace") {
    existing = await deps.pages.byId(input.target.pageId);
    if (!existing || existing.kind !== "page") return { status: "error", error: "That page no longer exists." };
    if (!existing.import_key) return { status: "error", error: "Only a page made by an import can be replaced by one." };
  }
  if (!existing && !title) return { status: "error", error: "Give the page a title: the export doesn't have one." };

  // Pictures: the export's own files first, a Kajabi upload from the CDN otherwise. A picture that can't be had is left out, and said.
  let notes = [...mapped.notes];
  let document = mapped.data;
  if (input.altTexts !== undefined) {
    const slots = slotsOf(mapped);
    const applied = applyAltEntries(mapped.data, parseAltEntries(input.altTexts, new Set(slots.map((s) => s.id))), slots);
    document = applied.data;
    // The reviewed descriptions replace the generic "no description" to-dos; what is still empty is said once, with its count.
    notes = notes.filter((n) => !(n.kind === "todo" && /no description/i.test(n.text)));
    if (applied.remaining > 0) notes.push({ kind: "todo", text: `${applied.remaining} picture${applied.remaining === 1 ? " has" : "s have"} no description: add one in the editor (or mark it decorative) before publishing.` });
  }
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
  const data = sanitizeLandingData(mapAssetIds(document, (value) => ids.get(value) ?? (value.startsWith("kajabi-import-picture:") ? "" : value)));
  const issues = checkLandingPage(data);
  const counts = { blocks: mapped.counts.blocks, hidden: mapped.counts.hidden, pictures: ids.size, picturesFailed: failed + Math.max(0, mapped.pictures.length - MAX_PICTURES) };

  if (existing) {
    // The old draft stays restorable from the page's history, unless there was nothing in it.
    const keep = !isEmptyDocument(existing.draft_data) && !sameDocument(existing.draft_data, data);
    if (keep) await deps.pages.keepDraftBeforeImport(existing.id, input.userId, "Replaced by a Kajabi import");
    // The page takes a key for the export's layout (so its next export is found), unless it has one already. This is also
    // how a page made under the first key format moves to the current one.
    const key = keyHasLayout(existing.import_key, mapped.layout) ? undefined : freeImportKey(mapped.importKey, keys);
    const page = await deps.pages.replaceImportedDraft(existing.id, data, input.userId, key);
    if (!page) return { status: "error", error: "That page was deleted while the import ran." };
    return { status: "imported", action: "updated", slug: page.slug, title: page.title, published: page.status === "published", keptBefore: keep, notes, issues, counts };
  }

  const taken = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await freeSlug(deps.pages, slugify(title) || "page", taken);
    try {
      // A second page with the same layout (a page cloned in Kajabi) gets a numbered key, so the first keeps its own.
      const page = await deps.pages.create({ title, slug, data, createdBy: input.userId, importKey: freeImportKey(mapped.importKey, keys) });
      return { status: "imported", action: "created", slug: page.slug, title: page.title, published: false, keptBefore: false, notes, issues, counts };
    } catch (error) {
      if (!(error instanceof LandingPageSlugTakenError)) throw error;
      // The address was taken a moment ago, or another import with this layout just landed: look at both again.
      taken.add(slug);
      for (const p of await importedPages(deps.pages)) keys.add(p.import_key!);
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
