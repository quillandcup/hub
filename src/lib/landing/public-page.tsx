import { cache } from "react";
import type { Metadata } from "next";
import LandingRender from "@/components/landing/LandingRender";
import { getServiceRepos } from "@/lib/data/server";
import { withLiveData } from "@/lib/landing/live-server";
import { pageOverrides, resolveFaviconAssetId } from "@/lib/landing/style";
import { HOME_SLUG, isValidSlug } from "@/lib/landing/slug";
import { mediaSrc } from "@/lib/media/url";

/**
 * The public read and render of a landing page, shared by /p/<slug> and by the homepage (`/` on the root host shows the page
 * with slug HOME_SLUG). The one read runs with the service role and returns only a page that is published and not deleted, so a
 * draft, a deleted page and an address never used are all "no page" (docs/product/LANDING_PAGES.md).
 */

/** The landing page the root host's homepage shows (admin: /admin/pages/home); it has no other address (`/home` and `/p/home` go to `/`). */
export { HOME_SLUG };

export type PublishedLandingPage = NonNullable<Awaited<ReturnType<ReturnType<typeof getServiceRepos>["landingPages"]["published"]>>>;

export const loadPublishedLandingPage = cache(async (slug: string) => (isValidSlug(slug) ? getServiceRepos().landingPages.published(slug) : null));

/** Title, description, canonical address, Open Graph and Twitter card from the page's SEO fields; `canonical` is the one address it has. */
export async function landingPageMetadata(page: PublishedLandingPage, canonical: string, imageBase: string): Promise<Metadata> {
  const title = page.seoTitle || page.title;
  // The favicon: this page's own, or the site's published one. None means the app's icon stays.
  const favicon = resolveFaviconAssetId((await getServiceRepos().landingSiteTemplate.published())?.favicon.assetId, pageOverrides(page.data).favicon);
  const image = page.socialImageAssetId ? [{ url: `${imageBase}${mediaSrc(page.socialImageAssetId, "event_hero")}` }] : undefined;
  return {
    title,
    description: page.seoDescription ?? undefined,
    ...(favicon ? { icons: { icon: mediaSrc(favicon, "thumb") } } : {}),
    alternates: { canonical },
    openGraph: { title, description: page.seoDescription ?? undefined, type: "website", url: canonical, images: image },
    twitter: { card: image ? "summary_large_image" : "summary", title, description: page.seoDescription ?? undefined, images: image?.map((i) => i.url) },
  };
}

/** The page as visitors see it. The site's design is the PUBLISHED copy, so a draft of it never reaches a visitor; live blocks get their figures for this render only. */
export async function publicLandingElement(page: PublishedLandingPage) {
  const site = await getServiceRepos().landingSiteTemplate.published();
  return <LandingRender data={await withLiveData(page.data)} frame={{ pageType: page.pageType, site }} structuredData />;
}
