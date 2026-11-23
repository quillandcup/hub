import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SITE_URL } from "@/lib/config";
import { landingPageUrl } from "@/lib/landing/address";
import { HOME_SLUG, publicLandingElement, landingPageMetadata, loadPublishedLandingPage } from "@/lib/landing/public-page";
import { isRootHost } from "@/lib/root-routing";

type Params = { params: Promise<{ slug: string }> };

/**
 * A published landing page (docs/product/LANDING_PAGES.md), for anyone: no sign-in, no member data. The one read runs with the
 * service role and returns only a page that is published and not deleted, so a draft, a deleted page and an address
 * that was never used are all the same 404. Nothing here sends anything to an analytics provider; the site's consent
 * banner and tracking rules apply as on every page (docs/product/ANALYTICS.md).
 *
 * This is the route behind the page's address, not the address: on the root host the page is at /<slug> (the proxy rewrites that
 * to here, and sends /p/<slug> to /<slug>), so its canonical, Open Graph address and social image are /<slug>. The Hub host and
 * previews serve /p/<slug> as it is, which keeps the editor's preview working. The page with slug `home` is the root host's
 * homepage (`/`): its canonical is `/`, and on the root host /p/home redirects there.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublishedLandingPage(slug);
  if (!page) return { title: "Not found", robots: { index: false } };
  return landingPageMetadata(page, landingPageUrl(page.slug), SITE_URL);
}

export default async function PublicLandingPage({ params }: Params) {
  const { slug } = await params;
  const page = await loadPublishedLandingPage(slug);
  if (!page) notFound();
  if (page.slug === HOME_SLUG && isRootHost((await headers()).get("host"))) redirect("/");
  return publicLandingElement(page);
}
