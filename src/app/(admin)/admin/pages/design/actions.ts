"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { siteVersionSummaries, type SiteVersionSummary } from "@/lib/landing/site-versions";
import { isLandingSiteVersionId } from "@/lib/landing/slug";
import { faviconProblem } from "@/lib/landing/style";
import { normalizeSiteTemplate, siteAssetIds, siteTemplateIssues, type SiteTemplate } from "@/lib/landing/site-template";

/**
 * The Design view's server actions (docs/product/LANDING_PAGES.md, "Site template"). The site template is one document shared by every
 * website page, with a draft and a published copy like a page. `saveSiteDraft` is the autosave: it writes the draft only and is
 * not audited or counted. `publishSiteTemplate` is the one step that changes what visitors see on every published website page,
 * so it checks the document first and is audited as the admin. Every action checks for an admin itself.
 */

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts). The autosave is not counted.
// `versions` is the refreshed History after a publish; `unpublished` says whether a restored or reset draft still differs from what is live.
export type SiteResult = { error?: string; issues?: string[]; savedAt?: string; publishedAt?: string; site?: SiteTemplate; versions?: SiteVersionSummary[]; unpublished?: boolean };

type Auth = Extract<Awaited<ReturnType<typeof requireActionPermission>>, { ok: true }>;

const MAX_BYTES = 100_000;
const tooBig = (data: unknown) => JSON.stringify(data ?? null).length > MAX_BYTES;

function failed(action: string, error: unknown, shown: string): { error: string } {
  // The database's message is for the logs only.
  console.error(`landing site template ${action} failed:`, error instanceof Error ? error.message : String(error));
  return { error: shown };
}

/** Saves the draft as it is edited. Whatever was sent is cleaned the way a stored document is read, so nothing the browser sent is trusted. */
export async function saveSiteDraft(data: unknown): Promise<SiteResult> {
  const auth = await requireActionPermission("pages.edit");
  if (!auth.ok) return { error: auth.error };
  if (tooBig(data)) return { error: "The site design is too large to save." };
  try {
    await createRepos(auth.supabase).landingSiteTemplate.saveDraft(normalizeSiteTemplate(data), auth.user.id);
    return { savedAt: new Date().toISOString() };
  } catch (error) {
    return failed("autosave", error, "Couldn't save. Your changes are still here; trying again.");
  }
}

async function publishImpl(auth: Auth, data: unknown): Promise<SiteResult> {
  if (tooBig(data)) return { error: "The site design is too large to publish." };
  const site = normalizeSiteTemplate(data);
  const issues = [...siteTemplateIssues(site)];
  const repos = createRepos(auth.supabase);
  // The favicon is checked as a whole picture here (its type as well as its size); the picker only knew the size.
  if (site.favicon.assetId) {
    const asset = await repos.media.byId(site.favicon.assetId);
    const problem = asset && !asset.deleted_at ? faviconProblem(asset) : "The favicon picture is no longer in the library.";
    if (problem) issues.push(problem);
  }
  if (issues.length > 0) return { error: "Fix these before publishing.", issues };
  try {
    // What the editor is showing is what goes live: save it, then publish it, so nothing typed a moment ago is left out.
    await repos.landingSiteTemplate.saveDraft(site, auth.user.id);
    if (!(await repos.landingSiteTemplate.publish(auth.user.id))) return { error: "Couldn't publish the site design." };
    // A signed-out visitor is served only assets marked public (docs/product/MEDIA_LIBRARY.md), so the logo is marked now.
    for (const id of siteAssetIds(site)) {
      const asset = await repos.media.byId(id);
      if (asset && !asset.deleted_at && !asset.is_public) await repos.media.edit(id, { is_public: true });
    }
    revalidatePath("/admin/pages", "layout");
    return { publishedAt: new Date().toISOString(), versions: await siteVersionSummaries(repos) };
  } catch (error) {
    return failed("publish", error, "Couldn't publish the site design.");
  }
}

/** Publishes the header and footer shown in the Design view, on every published website page at once. Stops on problems that would stop a visitor. */
export async function publishSiteTemplate(data: unknown): Promise<SiteResult> {
  const auth = await requireActionPermission("pages.publish");
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_site_published", () => publishImpl(auth, data), (r) => ({ ok: !r.error, detail: r.error ? "refused" : undefined }));
}

async function resetImpl(auth: Auth): Promise<SiteResult> {
  try {
    const repo = createRepos(auth.supabase).landingSiteTemplate;
    if (!(await repo.resetDraftToPublished(auth.user.id))) return { error: "There is no published site design to go back to." };
    revalidatePath("/admin/pages", "layout");
    return { site: (await repo.state()).draft };
  } catch (error) {
    return failed("draft reset", error, "Couldn't reset the draft.");
  }
}

/** Throws the draft away and goes back to the published copy. Nothing goes live and nothing public changes. */
export async function resetSiteDraft(): Promise<SiteResult> {
  const auth = await requireActionPermission("pages.edit");
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_site_draft_reset", () => resetImpl(auth), (r) => ({ ok: !r.error }));
}

async function restoreImpl(auth: Auth, versionId: string): Promise<SiteResult> {
  if (!isLandingSiteVersionId(versionId)) return { error: "That version no longer exists." };
  try {
    const repo = createRepos(auth.supabase).landingSiteTemplate;
    if (!(await repo.restoreVersion(versionId, auth.user.id))) return { error: "That version no longer exists." };
    revalidatePath("/admin/pages", "layout");
    const state = await repo.state();
    return { site: state.draft, unpublished: state.published === null || JSON.stringify(state.draft) !== JSON.stringify(state.published) };
  } catch (error) {
    return failed("restore", error, "Couldn't bring that version back.");
  }
}

/** Puts an earlier published version into the draft. Nothing goes live until the site design is published again. */
export async function restoreSiteVersion(versionId: string): Promise<SiteResult> {
  const auth = await requireActionPermission("pages.edit");
  if (!auth.ok) return { error: auth.error };
  return withAction("landing_site_version_restored", () => restoreImpl(auth, versionId), (r) => ({ ok: !r.error }));
}
