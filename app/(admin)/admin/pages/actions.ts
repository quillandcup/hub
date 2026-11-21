"use server";

import { isDeepStrictEqual } from "node:util";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { LandingPageSlugTakenError, isLandingPageType, type LandingPageType } from "@/lib/data/landing-pages";
import { createRepos } from "@/lib/data/repos";
import { checkLandingPage, type A11yIssue } from "@/lib/landing/a11y";
import { collectAssetIds, mapAssetIds, normalizeLandingData, type LandingData } from "@/lib/landing/data";
import { MAX_LANDING_BYTES, countBlocks, parseLandingImport, pruneToKnownBlocks, type ImportSource } from "@/lib/landing/json-transfer";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { aiConfigured, generateLandingPage, reviseLandingPage } from "@/lib/landing/ai";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { LANDING_STARTERS, isStarterKey, starterData } from "@/lib/landing/starters";
import { loadTemplateDraft } from "@/lib/landing/template-data";
import { isLandingPageId, isLandingVersionId, isValidSlug, slugify } from "@/lib/landing/slug";

/**
 * The page builder's server actions (docs/LANDING_PAGES.md). Every one checks for an admin itself. `saveLandingDraft` is the
 * autosave: it writes the draft only and is not audited or counted; publishing is a separate, explicit step that checks the page
 * first, keeps a version and makes the pictures it uses servable to visitors who aren't signed in.
 */

export type PageResult = { error?: string; slug?: string };
export type PublishResult = { error?: string; issues?: A11yIssue[]; publishedAt?: string };

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;

const NOT_FOUND = "That page no longer exists.";
const MAX_BYTES = MAX_LANDING_BYTES;

const tooBig = (data: unknown) => JSON.stringify(data ?? null).length > MAX_BYTES;

function refresh(...slugs: (string | null | undefined)[]) {
  revalidatePath("/admin/pages");
  for (const slug of slugs) if (slug) revalidatePath(`/p/${slug}`);
}

function failed(action: string, error: unknown, shown: string): { error: string } {
  // The database's message is for the logs only.
  console.error(`landing page ${action} failed:`, error instanceof Error ? error.message : String(error));
  return { error: shown };
}

// ---- create ----------------------------------------------------------------------------------------------

async function createImpl(auth: Auth, input: { title: string; slug?: string; data?: LandingData; pageType?: LandingPageType }): Promise<PageResult> {
  const title = (input.title ?? "").trim();
  if (!title) return { error: "Give the page a title." };
  const slug = (input.slug ?? "").trim() || slugify(title);
  if (!isValidSlug(slug)) return { error: "The address can use lowercase letters, numbers and dashes." };
  try {
    const page = await createRepos(auth.supabase).landingPages.create({ title, slug, data: input.data, createdBy: auth.user.id, pageType: input.pageType });
    refresh();
    return { slug: page.slug };
  } catch (error) {
    if (error instanceof LandingPageSlugTakenError) return { error: "Another page already has that address." };
    return failed("create", error, "Couldn't create the page.");
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/**
 * Makes a draft page, empty, from a starter (lib/landing/starters.ts) or from a saved template (`template`, its id; cleaned again
 * as it is used); its address is the title's words unless one is given.
 */
export async function createLandingPage(input: { title: string; slug?: string; starter?: string; template?: string; pageType?: string }): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_created", async () => {
    // Website or landing (docs/LANDING_PAGES.md): a landing page unless said otherwise. A starter belongs to one type and decides it.
    if (input?.pageType !== undefined && !isLandingPageType(input.pageType)) return { error: "Choose a website page or a landing page." };
    const pageType: LandingPageType = input?.pageType ?? "landing";
    if (input?.template) {
      try {
        const repo = createRepos(auth.supabase).landingPages;
        const draft = await loadTemplateDraft(repo, input.template);
        if (!draft.ok) return { error: draft.error };
        const source = await repo.byId(input.template);
        return createImpl(auth, { title: input.title, slug: input.slug, data: draft.data, pageType: source && isLandingPageType(source.page_type) ? source.page_type : pageType });
      } catch (error) {
        return failed("create from template", error, "Couldn't create the page.");
      }
    }
    if (input?.starter && !isStarterKey(input.starter)) return { error: "That starting point doesn't exist." };
    const data = input?.starter && isStarterKey(input.starter) ? sanitizeLandingData(starterData(input.starter)) : undefined;
    if (input?.starter && isStarterKey(input.starter) && LANDING_STARTERS[input.starter].pageType !== pageType) return { error: "That starting point is for the other kind of page." };
    return createImpl(auth, { title: input?.title, slug: input?.slug, data, pageType });
  });
}

async function buildWithAiImpl(auth: Auth, input: { title: string; slug?: string; prompt: string; pageType?: string }): Promise<PageResult> {
  if (!aiConfigured()) return { error: "Build with AI isn't set up yet." };
  if (!input.title?.trim()) return { error: "Give the page a title." };
  const slug = (input.slug ?? "").trim() || slugify(input.title);
  if (!isValidSlug(slug)) return { error: "The address can use lowercase letters, numbers and dashes." };
  // Generate first: when the assistant fails, no empty page is left behind.
  const built = await generateLandingPage(input.prompt);
  if (!built.ok) return { error: built.error };
  return createImpl(auth, { title: input.title, slug, data: sanitizeLandingData(stampLandingVersion(built.data)), pageType: isLandingPageType(input.pageType) ? input.pageType : "landing" });
}

/** Makes a draft page from the admin's description (lib/landing/ai.ts). Never published: the admin reads it in the editor first. */
export async function createLandingPageWithAi(input: { title: string; slug?: string; prompt: string; pageType?: string }): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_ai_built", () => buildWithAiImpl(auth, input), (r) => ({ ok: !r.error }));
}

export type AiBlocksResult = { error?: string; blocks?: unknown[]; notes?: A11yIssue[]; summary?: string };

/**
 * Blocks for the editor's AI tab: the admin's description in, blocks out, to be added to the page being edited. Saves
 * nothing: the editor inserts them (one undo step) and autosave takes it from there. The page itself is not sent.
 */
export async function generateLandingBlocks(prompt: string): Promise<AiBlocksResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction(
    "landing_page_ai_added",
    async () => {
      if (!aiConfigured()) return { error: "Build with AI isn't set up yet." };
      const built = await generateLandingPage(prompt, undefined, "add");
      if (!built.ok) return { error: built.error };
      return { blocks: built.data.content, notes: built.issues, summary: built.summary };
    },
    (r) => ({ ok: !r.error }),
  );
}

/**
 * Changes the page being edited as the admin describes. The editor sends the page's current blocks (what it shows, saved
 * or not); the answer is the whole revised list for the editor to put in place as one undo step. Saves nothing.
 */
export async function reviseLandingBlocks(prompt: string, content: unknown): Promise<AiBlocksResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction(
    "landing_page_ai_revised",
    async () => {
      if (!aiConfigured()) return { error: "Build with AI isn't set up yet." };
      if (tooBig(content)) return { error: "This page is too large to change." };
      const built = await reviseLandingPage(prompt, content);
      if (!built.ok) return { error: built.error };
      return { blocks: built.data.content, notes: built.issues, summary: built.summary };
    },
    (r) => ({ ok: !r.error }),
  );
}

// ---- autosave --------------------------------------------------------------------------------------------

/** Saves the draft as it is edited. Not audited and not counted: the audit log records publishing, not typing. */
export async function saveLandingDraft(pageId: string, data: unknown): Promise<{ error?: string; savedAt?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  if (tooBig(data)) return { error: "This page is too large to save." };
  try {
    const savedAt = await createRepos(auth.supabase).landingPages.saveDraft(pageId, sanitizeLandingData(stampLandingVersion(data)), auth.user.id);
    return savedAt ? { savedAt } : { error: NOT_FOUND };
  } catch (error) {
    return failed("autosave", error, "Couldn't save. Your changes are still here; trying again.");
  }
}

// ---- details ---------------------------------------------------------------------------------------------

export type DetailsInput = { title: string; slug: string; seoTitle: string; seoDescription: string; socialImageAssetId: string };

async function detailsImpl(auth: Auth, pageId: string, input: DetailsInput): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  const title = input.title.trim();
  const slug = input.slug.trim();
  if (!title) return { error: "Give the page a title." };
  if (!isValidSlug(slug)) return { error: "The address can use lowercase letters, numbers and dashes." };
  const repo = createRepos(auth.supabase).landingPages;
  try {
    const before = await repo.byId(pageId);
    const page = await repo.updateDetails(
      pageId,
      { title, slug, seoTitle: input.seoTitle.trim() || null, seoDescription: input.seoDescription.trim() || null, socialImageAssetId: input.socialImageAssetId.trim() || null },
      auth.user.id,
    );
    if (!page) return { error: NOT_FOUND };
    refresh(before?.slug, page.slug);
    return { slug: page.slug };
  } catch (error) {
    if (error instanceof LandingPageSlugTakenError) return { error: "Another page already has that address." };
    return failed("details", error, "Couldn't save the details.");
  }
}

/** The title, address and what a search result or a shared link shows. A published page's address change takes effect at once. */
export async function updateLandingPageDetails(pageId: string, input: DetailsInput): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_details_saved", () => detailsImpl(auth, pageId, input));
}

// ---- publish ---------------------------------------------------------------------------------------------

async function publishImpl(auth: Auth, pageId: string, data: unknown, note?: string): Promise<PublishResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  if (tooBig(data)) return { error: "This page is too large to publish." };
  const repos = createRepos(auth.supabase);
  const clean = sanitizeLandingData(stampLandingVersion(data));
  try {
    const current = await repos.landingPages.byId(pageId);
    if (!current) return { error: NOT_FOUND };
    // A template legitimately has placeholders and empty links: its checks are warnings and never block. It is not on the public site either.
    const isTemplate = current.kind === "template";
    const found = checkLandingPage(clean);
    const issues: A11yIssue[] = isTemplate ? found.map((i) => ({ ...i, severity: "warning" as const })) : found;
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length > 0) return { error: "Fix these before publishing.", issues };
    // The draft the editor is showing is what goes live: save it, then publish it, so nothing typed a moment ago is left out.
    if (!(await repos.landingPages.saveDraft(pageId, clean, auth.user.id))) return { error: NOT_FOUND };
    const page = await repos.landingPages.publish(pageId, note);
    if (!page) return { error: NOT_FOUND };
    // A signed-out visitor is served only assets marked public (docs/MEDIA_LIBRARY.md), so the ones this page uses are marked now.
    // A template's pictures stay private: they become public only when a page made from it is published.
    const assetIds = isTemplate ? [] : [...new Set([...collectAssetIds(clean), ...(page.social_image_asset_id ? [page.social_image_asset_id] : [])])];
    for (const id of assetIds) {
      const asset = await repos.media.byId(id);
      if (asset && !asset.deleted_at && !asset.is_public) await repos.media.edit(id, { is_public: true });
    }
    refresh(isTemplate ? undefined : page.slug);
    return { issues, publishedAt: page.published_at ?? undefined };
  } catch (error) {
    return failed("publish", error, "Couldn't publish the page.");
  }
}

/** Publishes what the editor is showing: checks it, keeps a version (with an optional note on what changed, at most 200 characters, shown in History and never in the Activity Log), and makes its pictures public. Stops on problems that would stop a visitor. */
export async function publishLandingPage(pageId: string, data: unknown, options?: { note?: string }): Promise<PublishResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_published", () => publishImpl(auth, pageId, data, typeof options?.note === "string" ? options.note : undefined), (r) => ({ ok: !r.error, detail: r.error ? "refused" : undefined }));
}

async function unpublishImpl(auth: Auth, pageId: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  try {
    const page = await createRepos(auth.supabase).landingPages.unpublish(pageId, auth.user.id);
    if (!page) return { error: NOT_FOUND };
    refresh(page.slug);
    return { slug: page.slug };
  } catch (error) {
    return failed("unpublish", error, "Couldn't take the page down.");
  }
}

/** Takes the page off the public site at once; the draft and the versions stay. */
export async function unpublishLandingPage(pageId: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_unpublished", () => unpublishImpl(auth, pageId));
}

// ---- versions --------------------------------------------------------------------------------------------

async function restoreImpl(auth: Auth, versionId: string): Promise<PageResult> {
  if (!isLandingVersionId(versionId)) return { error: "That version no longer exists." };
  try {
    const page = await createRepos(auth.supabase).landingPages.restoreVersion(versionId);
    if (!page) return { error: "That version no longer exists." };
    refresh();
    return { slug: page.slug };
  } catch (error) {
    return failed("restore", error, "Couldn't bring that version back.");
  }
}

/** Puts an earlier published version into the draft. It does not go live until it is published again. */
export async function restoreLandingPageVersion(versionId: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_version_restored", () => restoreImpl(auth, versionId));
}

async function resetDraftImpl(auth: Auth, pageId: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  try {
    const page = await createRepos(auth.supabase).landingPages.resetDraftToPublished(pageId, auth.user.id);
    if (!page) return { error: "There is no published version to go back to." };
    refresh();
    return { slug: page.slug };
  } catch (error) {
    return failed("draft reset", error, "Couldn't reset the draft.");
  }
}

/** Throws the draft's unpublished changes away: the draft becomes the published document again. Nothing goes live or changes publicly. */
export async function resetLandingDraftToPublished(pageId: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_draft_reset", () => resetDraftImpl(auth, pageId));
}

async function starterImpl(auth: Auth, pageId: string, starter: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  if (!isStarterKey(starter)) return { error: "That starting point doesn't exist." };
  const repo = createRepos(auth.supabase).landingPages;
  try {
    // The draft as it is now is kept in History first, so the replacement can be undone with Bring back.
    const kept = await repo.keepDraftBeforeStarter(pageId, auth.user.id, `Replaced by the starter “${LANDING_STARTERS[starter].label}”`);
    if (!kept) return { error: NOT_FOUND };
    const page = await repo.replaceDraftWithStarter(pageId, sanitizeLandingData(starterData(starter)), auth.user.id);
    if (!page) return { error: NOT_FOUND };
    refresh();
    return { slug: page.slug };
  } catch (error) {
    return failed("starter replace", error, "Couldn't replace the draft.");
  }
}

/** Replaces the draft with a starter's page. The old draft is kept in History; the published copy, title, address and search settings are untouched, and nothing goes live. */
export async function replaceLandingDraftWithStarter(pageId: string, starter: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_starter_applied", () => starterImpl(auth, pageId, starter));
}

// ---- import a page's JSON --------------------------------------------------------------------------------

export type JsonImportSummary = {
  blocksBefore: number;
  blocksAfter: number;
  /** Blocks the builder doesn't have, by type, that were left out. */
  leftOut: { type: string; count: number }[];
  /** Props a block doesn't have, dropped. */
  droppedProps: number;
  /** Pictures that aren't in this media library, cleared. */
  removedPictures: number;
  /** What the publish check would say about the imported page. */
  issues: A11yIssue[];
  /** The imported page is the same as the draft now, so nothing would change. */
  identical: boolean;
  /** Where the file says it came from (informational: it never changes this page's title or address). */
  source?: ImportSource;
};
/** `applied` is true when the draft was replaced: never on a dry run, or when the file matches the draft already. */
export type JsonImportResult = { error?: string; summary?: JsonImportSummary; applied?: boolean };

async function jsonImportImpl(auth: Auth, pageId: string, text: unknown, dryRun: boolean): Promise<JsonImportResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  if (typeof text !== "string") return { error: "Choose a file or paste the page's JSON first." };
  const parsed = parseLandingImport(text);
  if (!parsed.ok) return { error: parsed.error };
  const repos = createRepos(auth.supabase);
  const repo = repos.landingPages;
  try {
    const page = await repo.byId(pageId);
    if (!page) return { error: NOT_FOUND };

    // The file is untrusted: bring it up to date, keep only blocks and props the builder has, then check its pictures and clean it as a save does.
    const pruned = pruneToKnownBlocks(normalizeLandingData(parsed.document));
    const ids = collectAssetIds(pruned.data);
    const found = await Promise.all(ids.map((id) => repos.media.byId(id)));
    const missing = new Set(ids.filter((_, i) => !found[i] || found[i]?.deleted_at));
    let removedPictures = 0;
    const withPictures = missing.size === 0 ? pruned.data : mapAssetIds(pruned.data, (id) => (missing.has(id) ? (removedPictures++, "") : id));
    const clean = sanitizeLandingData(stampLandingVersion(withPictures));
    if (tooBig(clean)) return { error: "This page is too large to import." };

    const current = sanitizeLandingData(stampLandingVersion(page.draft_data));
    const summary: JsonImportSummary = {
      blocksBefore: countBlocks(current.content),
      blocksAfter: countBlocks(clean.content),
      leftOut: pruned.leftOut,
      droppedProps: pruned.droppedProps,
      removedPictures,
      issues: checkLandingPage(clean),
      identical: isDeepStrictEqual(clean, current),
      source: parsed.source,
    };
    if (dryRun || summary.identical) return { summary, applied: false };

    // The draft as it is now is kept in History first, so the import can be undone with Bring back.
    if (!(await repo.keepDraftBeforeStarter(pageId, auth.user.id, "Replaced by a JSON import"))) return { error: NOT_FOUND };
    if (!(await repo.replaceDraftWithStarter(pageId, clean, auth.user.id))) return { error: NOT_FOUND };
    refresh();
    return { summary, applied: true };
  } catch (error) {
    return failed("json import", error, "Couldn't import the page.");
  }
}

/**
 * Replaces the draft with a page's JSON (a file exported from the builder, or a bare document): unknown blocks and props are
 * left out, missing pictures cleared, rich text and links cleaned as on save. `dryRun` returns the same summary and writes
 * nothing. The old draft is kept in History; the published copy, title, address and search settings are untouched, and nothing goes live.
 */
export async function importLandingDraftJson(pageId: string, text: string, options?: { dryRun?: boolean }): Promise<JsonImportResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const dryRun = options?.dryRun === true;
  return withAction(
    "landing_page_json_imported",
    () => jsonImportImpl(auth, pageId, text, dryRun),
    (r) => ({ ok: !r.error, detail: r.error ? undefined : dryRun ? "preview" : r.applied ? undefined : "unchanged" }),
  );
}

// ---- duplicate and delete --------------------------------------------------------------------------------

async function duplicateImpl(auth: Auth, pageId: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  const repo = createRepos(auth.supabase).landingPages;
  try {
    const source = await repo.byId(pageId);
    if (!source) return { error: NOT_FOUND };
    const full = source;
    // The copy is always a draft, with the draft document as it is now.
    for (let n = 1; n <= 20; n++) {
      const slug = `${source.slug}-copy${n === 1 ? "" : `-${n}`}`.slice(0, 80).replace(/-+$/, "");
      try {
        const copy = await repo.create({ title: `${source.title} (copy)`, slug, data: sanitizeLandingData(full.draft_data), createdBy: auth.user.id, kind: source.kind === "template" ? "template" : "page", pageType: isLandingPageType(source.page_type) ? source.page_type : "landing" });
        refresh();
        return { slug: copy.slug };
      } catch (error) {
        if (!(error instanceof LandingPageSlugTakenError)) throw error;
      }
    }
    return { error: "Couldn't find a free address for the copy." };
  } catch (error) {
    return failed("duplicate", error, "Couldn't copy the page.");
  }
}

/** A new draft page with this page's content, titled "(copy)". */
export async function duplicateLandingPage(pageId: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_duplicated", () => duplicateImpl(auth, pageId));
}

async function deleteImpl(auth: Auth, pageId: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  try {
    const repo = createRepos(auth.supabase).landingPages;
    const before = await repo.byId(pageId);
    if (!(await repo.remove(pageId, auth.user.id))) return { error: NOT_FOUND };
    refresh(before?.slug);
    return {};
  } catch (error) {
    return failed("delete", error, "Couldn't delete the page.");
  }
}

/** Deletes the page (it stays in the database until removed on request, and its address is free again). It disappears from the public site at once. */
export async function deleteLandingPage(pageId: string): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_deleted", () => deleteImpl(auth, pageId));
}
