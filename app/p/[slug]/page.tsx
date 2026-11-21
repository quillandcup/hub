import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LandingRender from "@/components/landing/LandingRender";
import { APP_URL } from "@/lib/config";
import { getServiceRepos } from "@/lib/data/server";
import { withLiveData } from "@/lib/landing/live-server";
import { pageOverrides, resolveFaviconAssetId } from "@/lib/landing/style";
import { isValidSlug } from "@/lib/landing/slug";
import { mediaSrc } from "@/lib/media/url";

type Params = { params: Promise<{ slug: string }> };

/**
 * A published landing page (docs/LANDING_PAGES.md), for anyone: no sign-in, no member data. The one read runs with the
 * service role and returns only a page that is published and not deleted, so a draft, a deleted page and an address
 * that was never used are all the same 404. Nothing here sends anything to an analytics provider; the site's consent
 * banner and tracking rules apply as on every page (docs/ANALYTICS.md).
 */
const load = cache(async (slug: string) => (isValidSlug(slug) ? getServiceRepos().landingPages.published(slug) : null));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) return { title: "Not found", robots: { index: false } };
  const title = page.seoTitle || page.title;
  // The favicon: this page's own, or the site's published one. None means the app's icon stays.
  const favicon = resolveFaviconAssetId((await getServiceRepos().landingSiteTemplate.published())?.favicon.assetId, pageOverrides(page.data).favicon);
  const image = page.socialImageAssetId ? [{ url: `${APP_URL}${mediaSrc(page.socialImageAssetId, "event_hero")}` }] : undefined;
  return {
    title,
    description: page.seoDescription ?? undefined,
    ...(favicon ? { icons: { icon: mediaSrc(favicon, "thumb") } } : {}),
    alternates: { canonical: `${APP_URL}/p/${page.slug}` },
    openGraph: { title, description: page.seoDescription ?? undefined, type: "website", url: `${APP_URL}/p/${page.slug}`, images: image },
    twitter: { card: image ? "summary_large_image" : "summary", title, description: page.seoDescription ?? undefined, images: image?.map((i) => i.url) },
  };
}

export default async function PublicLandingPage({ params }: Params) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();
  // The site's design is the PUBLISHED copy, so a draft of it never reaches a visitor: a website page is framed by its header and footer, and every page takes its style from it unless the page has its own.
  const site = await getServiceRepos().landingSiteTemplate.published();
  // Live blocks get their figures here, for this render only (lib/landing/live-data.ts): the stored page is never changed.
  return <LandingRender data={await withLiveData(page.data)} frame={{ pageType: page.pageType, site }} />;
}
