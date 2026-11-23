import { SITE_URL } from "@/lib/config";
import { HOME_SLUG } from "@/lib/landing/slug";

/**
 * Where a published landing page lives for the public: the root host (`siteUrl`) and the bare slug, `/<slug>`. The page with slug
 * `home` is the front page, `/`. `/p/<slug>` is only the route behind it (src/lib/root-routing.ts) and is never shown or linked.
 * Every address shown, copied, canonical or in a sitemap comes from here.
 */
export function landingPagePath(slug: string): string {
  return slug === HOME_SLUG ? "/" : `/${slug}`;
}

/** The page's full public address, on the root host. */
export function landingPageUrl(slug: string): string {
  return `${SITE_URL}${landingPagePath(slug)}`;
}

/** What the editor shows before the slug field: the root host without its scheme, "quillandcup.com/". */
export function landingAddressPrefix(): string {
  return `${SITE_URL.replace(/^https?:\/\//, "")}/`;
}
