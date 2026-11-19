"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { LandingPageSlugTakenError } from "@/lib/data/landing-pages";
import { createRepos } from "@/lib/data/repos";
import { checkLandingPage, type A11yIssue } from "@/lib/landing/a11y";
import { collectAssetIds, type LandingData } from "@/lib/landing/data";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { aiConfigured, generateLandingPage, reviseLandingPage } from "@/lib/landing/ai";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isStarterKey, starterData } from "@/lib/landing/starters";
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
const MAX_BYTES = 2_000_000;

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

async function createImpl(auth: Auth, input: { title: string; slug?: string; data?: LandingData }): Promise<PageResult> {
  const title = (input.title ?? "").trim();
  if (!title) return { error: "Give the page a title." };
  const slug = (input.slug ?? "").trim() || slugify(title);
  if (!isValidSlug(slug)) return { error: "The address can use lowercase letters, numbers and dashes." };
  try {
    const page = await createRepos(auth.supabase).landingPages.create({ title, slug, data: input.data, createdBy: auth.user.id });
    refresh();
    return { slug: page.slug };
  } catch (error) {
    if (error instanceof LandingPageSlugTakenError) return { error: "Another page already has that address." };
    return failed("create", error, "Couldn't create the page.");
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Makes a draft page, empty or from a starter (lib/landing/starters.ts); its address is the title's words unless one is given. */
export async function createLandingPage(input: { title: string; slug?: string; starter?: string }): Promise<PageResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_created", async () => {
    if (input?.starter && !isStarterKey(input.starter)) return { error: "That starting point doesn't exist." };
    const data = input?.starter && isStarterKey(input.starter) ? sanitizeLandingData(starterData(input.starter)) : undefined;
    return createImpl(auth, { title: input?.title, slug: input?.slug, data });
  });
}

async function buildWithAiImpl(auth: Auth, input: { title: string; slug?: string; prompt: string }): Promise<PageResult> {
  if (!aiConfigured()) return { error: "Build with AI isn't set up yet." };
  if (!input.title?.trim()) return { error: "Give the page a title." };
  const slug = (input.slug ?? "").trim() || slugify(input.title);
  if (!isValidSlug(slug)) return { error: "The address can use lowercase letters, numbers and dashes." };
  // Generate first: when the assistant fails, no empty page is left behind.
  const built = await generateLandingPage(input.prompt);
  if (!built.ok) return { error: built.error };
  return createImpl(auth, { title: input.title, slug, data: sanitizeLandingData(stampLandingVersion(built.data)) });
}

/** Makes a draft page from the admin's description (lib/landing/ai.ts). Never published: the admin reads it in the editor first. */
export async function createLandingPageWithAi(input: { title: string; slug?: string; prompt: string }): Promise<PageResult> {
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
    const before = (await repo.list()).find((p) => p.id === pageId);
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

async function publishImpl(auth: Auth, pageId: string, data: unknown): Promise<PublishResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  if (tooBig(data)) return { error: "This page is too large to publish." };
  const repos = createRepos(auth.supabase);
  const clean = sanitizeLandingData(stampLandingVersion(data));
  const issues = checkLandingPage(clean);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return { error: "Fix these before publishing.", issues };
  try {
    // The draft the editor is showing is what goes live: save it, then publish it, so nothing typed a moment ago is left out.
    if (!(await repos.landingPages.saveDraft(pageId, clean, auth.user.id))) return { error: NOT_FOUND };
    const page = await repos.landingPages.publish(pageId);
    if (!page) return { error: NOT_FOUND };
    // A signed-out visitor is served only assets marked public (docs/MEDIA_LIBRARY.md), so the ones this page uses are marked now.
    const assetIds = [...new Set([...collectAssetIds(clean), ...(page.social_image_asset_id ? [page.social_image_asset_id] : [])])];
    for (const id of assetIds) {
      const asset = await repos.media.byId(id);
      if (asset && !asset.deleted_at && !asset.is_public) await repos.media.edit(id, { is_public: true });
    }
    refresh(page.slug);
    return { issues, publishedAt: page.published_at ?? undefined };
  } catch (error) {
    return failed("publish", error, "Couldn't publish the page.");
  }
}

/** Publishes what the editor is showing: checks it, keeps a version, and makes its pictures public. Stops on problems that would stop a visitor. */
export async function publishLandingPage(pageId: string, data: unknown): Promise<PublishResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_page_published", () => publishImpl(auth, pageId, data), (r) => ({ ok: !r.error, detail: r.error ? "refused" : undefined }));
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

// ---- duplicate and delete --------------------------------------------------------------------------------

async function duplicateImpl(auth: Auth, pageId: string): Promise<PageResult> {
  if (!isLandingPageId(pageId)) return { error: NOT_FOUND };
  const repo = createRepos(auth.supabase).landingPages;
  try {
    const source = (await repo.list()).find((p) => p.id === pageId);
    if (!source) return { error: NOT_FOUND };
    const full = await repo.bySlug(source.slug);
    if (!full) return { error: NOT_FOUND };
    // The copy is always a draft, with the draft document as it is now.
    for (let n = 1; n <= 20; n++) {
      const slug = `${source.slug}-copy${n === 1 ? "" : `-${n}`}`.slice(0, 80).replace(/-+$/, "");
      try {
        const copy = await repo.create({ title: `${source.title} (copy)`, slug, data: sanitizeLandingData(full.draft_data), createdBy: auth.user.id });
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
    const before = (await repo.list()).find((p) => p.id === pageId);
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
