"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { LandingTemplateNameTakenError } from "@/lib/data/landing-templates";
import { createRepos } from "@/lib/data/repos";
import { MAX_LANDING_BYTES } from "@/lib/landing/json-transfer";
import { stampLandingVersion } from "@/lib/landing/migrations";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { isLandingPageId } from "@/lib/landing/slug";
import { editorNames, UNKNOWN_EDITOR } from "@/lib/landing/template-people";
import { loadTemplateDraft, TEMPLATE_GONE } from "@/lib/landing/template-data";
import {
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_NOTE_MAX,
  blockTally,
  isLandingTemplateId,
  isLandingTemplateVersionId,
  type TemplateVersionKind,
} from "@/lib/landing/templates";

/**
 * The page builder's template actions (docs/LANDING_PAGES.md, "Templates"). Every one checks for an admin itself. A template is
 * saved from the page the editor is showing (cleaned as a save cleans it), overwritten with the next version (the old one is kept),
 * brought back as a new version, renamed or deleted (softly). None of them publishes anything or touches a page's title,
 * address, search settings or published copy. Ids travel only between our client and these actions, and are checked at the door.
 */

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export type TemplateResult ={ error?: string; templateId?: string; name?: string; version?: number };

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;

const VERSION_GONE = "That version no longer exists.";
const NAME_TAKEN = "A template with that name already exists. Choose another name, or overwrite that template.";

function refresh() {
  revalidatePath("/admin/pages", "layout");
}

function failed(action: string, error: unknown, shown: string): { error: string } {
  // The database's message is for the logs only.
  console.error(`landing template ${action} failed:`, error instanceof Error ? error.message : String(error));
  return { error: shown };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// ---- save ------------------------------------------------------------------------------------------------

export type SaveTemplateInput = {
  /** A new template's name (ignored when overwriting: the template keeps its name). */
  name?: string;
  description?: string;
  /** Overwrite this template with the page, as its next version. */
  overwriteId?: string;
  /** Why it changed (optional). */
  note?: string;
};

async function saveImpl(auth: Auth, data: unknown, input: SaveTemplateInput): Promise<TemplateResult> {
  const description = text(input?.description);
  const note = text(input?.note);
  if (description.length > TEMPLATE_DESCRIPTION_MAX) return { error: `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters.` };
  if (note.length > TEMPLATE_NOTE_MAX) return { error: `Keep the note under ${TEMPLATE_NOTE_MAX} characters.` };
  if (JSON.stringify(data ?? null).length > MAX_LANDING_BYTES) return { error: "This page is too large to save as a template." };
  // Cleaned exactly as a save of the page cleans it; nothing the editor sent is trusted.
  const clean = sanitizeLandingData(stampLandingVersion(data));
  if (clean.content.length === 0) return { error: "This page is empty. Add something to it before saving it as a template." };
  if (JSON.stringify(clean).length > MAX_LANDING_BYTES) return { error: "This page is too large to save as a template." };
  const repo = createRepos(auth.supabase).landingTemplates;
  try {
    let name = text(input?.name);
    if (input?.overwriteId !== undefined) {
      if (!isLandingTemplateId(input.overwriteId)) return { error: TEMPLATE_GONE };
      const existing = await repo.byId(input.overwriteId);
      if (!existing) return { error: TEMPLATE_GONE };
      name = existing.name;
    } else {
      if (!name) return { error: "Give the template a name." };
      if (name.length > TEMPLATE_NAME_MAX) return { error: `Keep the name under ${TEMPLATE_NAME_MAX} characters.` };
    }
    const saved = await repo.save({ name, description, data: clean, templateId: input?.overwriteId, note: note || null, createdBy: auth.user.id });
    if (!saved) return { error: TEMPLATE_GONE };
    refresh();
    return { templateId: saved.id, name, version: saved.version };
  } catch (error) {
    if (error instanceof LandingTemplateNameTakenError) return { error: NAME_TAKEN };
    return failed("save", error, "Couldn't save the template.");
  }
}

/**
 * Saves the page the editor is showing as a template: a new one, or the next version of an existing one (`overwriteId`; the old
 * version stays in its history). The page's content is cleaned like a save and size-capped; the page itself is not changed.
 */
export async function saveLandingTemplate(data: unknown, input: SaveTemplateInput): Promise<TemplateResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_saved", () => saveImpl(auth, data, input), (r) => ({ ok: !r.error, detail: r.error ? undefined : r.version === 1 ? "created" : "overwritten" }));
}

// ---- versions --------------------------------------------------------------------------------------------

export type TemplateVersionRow = { id: string; version: number; kind: TemplateVersionKind; note: string | null; name: string; by: string; createdAt: string };
export type TemplateVersionsResult = { error?: string; versions?: TemplateVersionRow[] };

const KINDS: TemplateVersionKind[] = ["created", "overwritten", "restored"];

/** A template's versions, newest first, with who saved each. A read: not counted. */
export async function loadLandingTemplateVersions(templateId: string): Promise<TemplateVersionsResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isLandingTemplateId(templateId)) return { error: TEMPLATE_GONE };
  try {
    const repos = createRepos(auth.supabase);
    const [template, versions] = await Promise.all([repos.landingTemplates.byId(templateId), repos.landingTemplates.versions(templateId)]);
    if (!template) return { error: TEMPLATE_GONE };
    const names = await editorNames(repos, versions.map((v) => v.created_by));
    return {
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        kind: KINDS.find((k) => k === v.kind) ?? "overwritten",
        note: v.note,
        name: v.name,
        by: (v.created_by && names.get(v.created_by)) || UNKNOWN_EDITOR,
        createdAt: v.created_at,
      })),
    };
  } catch (error) {
    return failed("versions", error, "Couldn't load the history.");
  }
}

export type TemplateOutlineResult = { error?: string; blocks?: { type: string; count: number }[] };

/** What a version holds, as block counts by type: a look inside without drawing the page. A read: not counted. */
export async function loadLandingTemplateOutline(versionId: string): Promise<TemplateOutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isLandingTemplateVersionId(versionId)) return { error: VERSION_GONE };
  try {
    const found = await createRepos(auth.supabase).landingTemplates.versionData(versionId);
    return found ? { blocks: blockTally(found.data.content) } : { error: VERSION_GONE };
  } catch (error) {
    return failed("outline", error, "Couldn't open that version.");
  }
}

async function restoreImpl(auth: Auth, versionId: string): Promise<TemplateResult> {
  if (!isLandingTemplateVersionId(versionId)) return { error: VERSION_GONE };
  try {
    const repo = createRepos(auth.supabase).landingTemplates;
    const saved = await repo.restoreVersion(versionId, auth.user.id);
    if (!saved) return { error: VERSION_GONE };
    const template = await repo.byId(saved.id);
    refresh();
    return { templateId: saved.id, name: template?.name, version: saved.version };
  } catch (error) {
    return failed("restore", error, "Couldn't bring that version back.");
  }
}

/** Makes an earlier version the template's newest one. History is never rewritten: it is a new version, and every old one stays. */
export async function restoreLandingTemplateVersion(versionId: string): Promise<TemplateResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_restored", () => restoreImpl(auth, versionId));
}

// ---- rename and delete -----------------------------------------------------------------------------------

async function detailsImpl(auth: Auth, templateId: string, input: { name: string; description: string }): Promise<TemplateResult> {
  if (!isLandingTemplateId(templateId)) return { error: TEMPLATE_GONE };
  const name = text(input?.name);
  const description = text(input?.description);
  if (!name) return { error: "Give the template a name." };
  if (name.length > TEMPLATE_NAME_MAX) return { error: `Keep the name under ${TEMPLATE_NAME_MAX} characters.` };
  if (description.length > TEMPLATE_DESCRIPTION_MAX) return { error: `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters.` };
  try {
    const template = await createRepos(auth.supabase).landingTemplates.updateDetails(templateId, { name, description }, auth.user.id);
    if (!template) return { error: TEMPLATE_GONE };
    refresh();
    return { templateId: template.id, name: template.name, version: template.current_version };
  } catch (error) {
    if (error instanceof LandingTemplateNameTakenError) return { error: NAME_TAKEN };
    return failed("details", error, "Couldn't save the details.");
  }
}

/** Renames a template or changes its description. It is not a new version. */
export async function updateLandingTemplateDetails(templateId: string, input: { name: string; description: string }): Promise<TemplateResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_renamed", () => detailsImpl(auth, templateId, input));
}

async function deleteImpl(auth: Auth, templateId: string): Promise<TemplateResult> {
  if (!isLandingTemplateId(templateId)) return { error: TEMPLATE_GONE };
  try {
    if (!(await createRepos(auth.supabase).landingTemplates.remove(templateId, auth.user.id))) return { error: TEMPLATE_GONE };
    refresh();
    return {};
  } catch (error) {
    return failed("delete", error, "Couldn't delete the template.");
  }
}

/** Deletes a template (softly: it leaves the lists and frees its name; its versions stay in the database). Pages made from it are not affected. */
export async function deleteLandingTemplate(templateId: string): Promise<TemplateResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_deleted", () => deleteImpl(auth, templateId));
}

// ---- use -------------------------------------------------------------------------------------------------

async function applyImpl(auth: Auth, pageId: string, templateId: string): Promise<{ error?: string; slug?: string }> {
  if (!isLandingPageId(pageId)) return { error: "That page no longer exists." };
  const repos = createRepos(auth.supabase);
  try {
    const draft = await loadTemplateDraft(repos.landingTemplates, templateId);
    if (!draft.ok) return { error: draft.error };
    if (JSON.stringify(draft.data).length > MAX_LANDING_BYTES) return { error: "This template is too large to use." };
    // The draft as it is now is kept in History first (the same version as before a starter), so the replacement can be undone with Bring back.
    const kept = await repos.landingPages.keepDraftBeforeStarter(pageId, auth.user.id);
    if (!kept) return { error: "That page no longer exists." };
    const page = await repos.landingPages.replaceDraftWithStarter(pageId, draft.data, auth.user.id);
    if (!page) return { error: "That page no longer exists." };
    revalidatePath("/admin/pages");
    return { slug: page.slug };
  } catch (error) {
    return failed("apply", error, "Couldn't replace the draft.");
  }
}

/**
 * Replaces a page's draft with a saved template, as "Start over from a starter" does with a built-in one: the old draft is kept in
 * History, the published copy, title, address and search settings are untouched, and nothing goes live.
 */
export async function replaceLandingDraftWithTemplate(pageId: string, templateId: string): Promise<{ error?: string; slug?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_template_applied", () => applyImpl(auth, pageId, templateId));
}
