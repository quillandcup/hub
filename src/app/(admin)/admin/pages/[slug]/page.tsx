import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { normalizeLandingData } from "@/lib/landing/data";
import { isValidSlug } from "@/lib/landing/slug";
import { UNKNOWN_EDITOR } from "@/lib/landing/version-notes";
import { editorNames } from "@/lib/landing/version-people";
import { createClient } from "@/lib/supabase/server";
import LandingEditor from "./LandingEditor";

export const metadata: Metadata = { title: "Edit page · Pages" };

/** The editor. Addressed by the page's slug, not its id: an admin URL counts as exposed, and page ids never are (docs/decisions/SHORT_IDS_PLAN.md, Tier 2). */
export default async function EditLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission("pages.edit");
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const repos = createRepos(await createClient());
  const page = await repos.landingPages.bySlug(slug);
  if (!page) notFound();
  const pageType = page.page_type === "website" ? "website" : "landing";
  const [versions, templates] = await Promise.all([repos.landingPages.versions(page.id, 20), repos.landingPages.usableTemplates(pageType)]);
  const names = await editorNames(repos, versions.map((v) => v.published_by));
  const allTemplates = page.kind === "template" ? [] : await repos.landingPages.list("template");

  return (
    // Keyed by the last restore, so bringing a version back opens the restored draft (the editor takes its document once).
    <LandingEditor
      key={page.restored_at ?? "draft"}
      page={{
        id: page.id,
        slug: page.slug,
        title: page.title,
        status: page.status,
        seoTitle: page.seo_title ?? "",
        seoDescription: page.seo_description ?? "",
        socialImageAssetId: page.social_image_asset_id ?? "",
        publishedJson: page.published_data ? JSON.stringify(normalizeLandingData(page.published_data)) : null,
        publicPath: page.kind === "template" ? "" : `/p/${page.slug}`,
        kind: page.kind === "template" ? "template" : "page",
        pageType,
      }}
      site={(await repos.landingSiteTemplate.state()).draft}
      data={normalizeLandingData(page.draft_data)}
      versions={versions.map((v) => ({ id: v.id, title: v.title, createdAt: v.created_at, by: (v.published_by && names.get(v.published_by)) || UNKNOWN_EDITOR, note: v.note, kind: v.kind === "before_import" || v.kind === "before_starter" ? v.kind : "published" }))}
      replaceChoices={[
        // Only a published template is offered, and what is copied is its published copy. A template is never offered to itself.
        ...templates.filter((t) => t.id !== page.id).map((t) => ({ key: t.id, label: t.title, description: "A template you published.", group: "template" as const })),
      ]}
      templates={allTemplates.map((t) => ({ id: t.id, name: t.title, published: t.status === "published" }))}
    />
  );
}
