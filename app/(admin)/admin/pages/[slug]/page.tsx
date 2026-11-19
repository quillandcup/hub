import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { normalizeLandingData } from "@/lib/landing/data";
import { isValidSlug } from "@/lib/landing/slug";
import { LANDING_STARTERS, STARTER_KEYS } from "@/lib/landing/starters";
import { createClient } from "@/lib/supabase/server";
import LandingEditor from "./LandingEditor";

export const metadata: Metadata = { title: "Edit page · Pages" };

/** The editor. Addressed by the page's slug, not its id: an admin URL counts as exposed, and page ids never are (docs/SHORT_IDS_PLAN.md, Tier 2). */
export default async function EditLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdminPage();
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const repos = createRepos(await createClient());
  const page = await repos.landingPages.bySlug(slug);
  if (!page) notFound();
  const versions = await repos.landingPages.versions(page.id, 20);

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
        publicPath: `/p/${page.slug}`,
      }}
      data={normalizeLandingData(page.draft_data)}
      versions={versions.map((v) => ({ id: v.id, title: v.title, createdAt: v.created_at, kind: v.kind === "before_import" || v.kind === "before_starter" ? v.kind : "published" }))}
      starters={STARTER_KEYS.map((key) => ({ key, label: LANDING_STARTERS[key].label, description: LANDING_STARTERS[key].description }))}
    />
  );
}
