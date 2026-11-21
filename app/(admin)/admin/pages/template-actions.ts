"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { LandingPageSlugTakenError } from "@/lib/data/landing-pages";
import { createRepos } from "@/lib/data/repos";
import { MAX_LANDING_BYTES } from "@/lib/landing/json-transfer";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isLandingPageId, isValidSlug, slugify } from "@/lib/landing/slug";
import { loadTemplateDraft, TEMPLATE_GONE } from "@/lib/landing/template-data";
import { TEMPLATE_NAME_MAX } from "@/lib/landing/templates";

/**
 * The page builder's template actions (docs/product/LANDING_PAGES.md, "Templates"). A template is a page of kind `template`: it has a draft,
 * a published copy and versions like any page, and the page actions (publish, unpublish, duplicate, delete, restore a version,
 * rename) work on it as they do on a page. These are the two things only templates have: saving a page as a template, and
 * starting a page from one. Every one checks for an admin itself. None of them changes the page it starts from, and none makes a
 * template public: a template never leaves the admin.
 */

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export type TemplateResult = { error?: string; templateId?: string; slug?: string; name?: string; published?: boolean };

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;

const NAME_TAKEN = "A template with that name already exists. Choose another name, or replace that template's draft.";

function failed(action: string, error: unknown, shown: string): { error: string } {
  // The database's message is for the logs only.
  console.error(`landing template ${action} failed:`, error instanceof Error ? error.message : String(error));
  return { error: shown };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type SaveTemplateInput = {
  /** A new template's name (its title). Ignored when replacing a draft: the template keeps its name. */
  name?: string;
  /** Replace this template's draft with the page (the template's previous draft is kept in its History). */
  replaceId?: string;
  /** The page being saved (its title goes in the version's automatic note: "Saved from the page ..."). The page is only read. */
  fromPageId?: string;
  /** Publish the template at once (a new version of its published copy; the template rules: checks are warnings, pictures stay private). */
  publish?: boolean;
};

/** An address for a new template from its name: the name's words, then `-2`, `-3` ... until one is free. */
function slugCandidates(name: string): string[] {
  const base = slugify(name) || "template";
  const first = isValidSlug(base) ? base : `${base}-template`;
  return [first, ...Array.from({ length: 19 }, (_, i) => `${first.slice(0, 76)}-${i + 2}`)];
}

async function saveImpl(auth: Auth, data: unknown, input: SaveTemplateInput): Promise<TemplateResult> {
  if (JSON.stringify(data ?? null).length > MAX_LANDING_BYTES) return { error: "This page is too large to save as a template." };
  // Cleaned exactly as a save of the page cleans it; nothing the editor sent is trusted.
  const clean = sanitizeLandingData(stampLandingVersion(data));
  if (clean.content.length === 0) return { error: "This page is empty. Add something to it before saving it as a template." };
  if (JSON.stringify(clean).length > MAX_LANDING_BYTES) return { error: "This page is too large to save as a template." };
  const repo = createRepos(auth.supabase).landingPages;
  try {
    const from = input?.fromPageId && isLandingPageId(input.fromPageId) ? await repo.byId(input.fromPageId) : null;
    let template;
    if (input?.replaceId !== undefined) {
      if (!isLandingPageId(input.replaceId)) return { error: TEMPLATE_GONE };
      const existing = await repo.byId(input.replaceId);
      if (!existing || existing.kind !== "template") return { error: TEMPLATE_GONE };
      // The template's draft as it is now is kept in its History first (the same kept version as before a starter), so this can be undone with Bring back.
      if (!(await repo.keepDraftBeforeStarter(existing.id, auth.user.id, `Replaced by ${from ? `the page “${from.title}”` : "a page"}`))) return { error: TEMPLATE_GONE };
      template = await repo.replaceDraftWithStarter(existing.id, clean, auth.user.id);
      if (!template) return { error: TEMPLATE_GONE };
    } else {
      const name = text(input?.name);
      if (!name) return { error: "Give the template a name." };
      if (name.length > TEMPLATE_NAME_MAX) return { error: `Keep the name under ${TEMPLATE_NAME_MAX} characters.` };
      if ((await repo.list("template")).some((t) => t.title.trim().toLowerCase() === name.toLowerCase())) return { error: NAME_TAKEN };
      for (const slug of slugCandidates(name)) {
        try {
          template = await repo.create({ title: name, slug, data: clean, createdBy: auth.user.id, kind: "template", pageType: from && (from.page_type === "website" || from.page_type === "landing") ? from.page_type : "landing" });
          break;
        } catch (error) {
          if (!(error instanceof LandingPageSlugTakenError)) throw error;
        }
      }
      if (!template) return { error: "Couldn't find a free address for the template. Try another name." };
    }
    // Publishing a template keeps a version of the published copy. It is not on the public site, so no picture is made public.
    const published = input?.publish === true ? await repo.publish(template.id, from ? `Saved from the page “${from.title}”` : "Saved from a page") : null;
    if (input?.publish === true && !published) return { error: TEMPLATE_GONE };
    revalidatePath("/admin/pages", "layout");
    return { templateId: template.id, slug: template.slug, name: template.title, published: Boolean(published) };
  } catch (error) {
    return failed("save", error, "Couldn't save the template.");
  }
}

/**
 * Saves the page the editor is showing as a template: a NEW template (its draft is this page; edit and publish it like any page), or
 * replaces an existing template's draft with it (`replaceId`; the previous draft stays in that template's History and nothing is
 * published unless `publish` is set). The page itself is not changed. The content is cleaned like a save and size-capped.
 */
export async function saveLandingTemplate(data: unknown, input: SaveTemplateInput): Promise<TemplateResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_saved", () => saveImpl(auth, data, input), (r) => ({ ok: !r.error, detail: r.error ? undefined : input?.replaceId ? "replaced" : "created" }));
}

async function applyImpl(auth: Auth, pageId: string, templateId: string): Promise<{ error?: string; slug?: string }> {
  if (!isLandingPageId(pageId)) return { error: "That page no longer exists." };
  const repos = createRepos(auth.supabase);
  try {
    const draft = await loadTemplateDraft(repos.landingPages, templateId);
    if (!draft.ok) return { error: draft.error };
    if (JSON.stringify(draft.data).length > MAX_LANDING_BYTES) return { error: "This template is too large to use." };
    const target = await repos.landingPages.byId(pageId);
    if (!target) return { error: "That page no longer exists." };
    // The draft as it is now is kept in History first (the same version as before a starter), so the replacement can be undone with Bring back.
    if (!(await repos.landingPages.keepDraftBeforeStarter(pageId, auth.user.id, `Replaced by the template “${draft.name}”`))) return { error: "That page no longer exists." };
    const page = await repos.landingPages.replaceDraftWithStarter(pageId, draft.data, auth.user.id);
    if (!page) return { error: "That page no longer exists." };
    revalidatePath("/admin/pages");
    return { slug: page.slug };
  } catch (error) {
    return failed("apply", error, "Couldn't replace the draft.");
  }
}

/**
 * Replaces a page's (or another template's) draft with a published template's PUBLISHED copy, as "Start over from a starter" does with
 * a built-in one: the old draft is kept in History, the published copy, title, address and search settings are untouched, and nothing goes live.
 */
export async function replaceLandingDraftWithTemplate(pageId: string, templateId: string): Promise<{ error?: string; slug?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_applied", () => applyImpl(auth, pageId, templateId));
}
