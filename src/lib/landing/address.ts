import { PUBLIC_PAGES_URL, PUBLIC_SITE_LIVE } from "@/lib/config";
import { HOME_SLUG } from "@/lib/landing/slug";

/**
 * Where a published landing page lives for the public, which depends on the cutover switch (config/app.ts `publicSiteLive`):
 *   - live: the root host and the bare slug, `/<slug>` (`/` for the page `home`). `/p/<slug>` is only the route behind it
 *     (src/lib/root-routing.ts) and is never shown or linked.
 *   - not live (until the cutover): the Hub host serves it at `/p/<slug>`, as it always did, `home` included.
 * Every address shown, copied, canonical or in a sitemap comes from here. The two functions take the state as an argument
 * (defaulting to the committed one) so a test can ask for both.
 */
export function landingPagePath(slug: string, live: boolean = PUBLIC_SITE_LIVE): string {
  if (!live) return `/p/${slug}`;
  return slug === HOME_SLUG ? "/" : `/${slug}`;
}

/** The page's full public address: `PUBLIC_PAGES_URL` (the root host once live, the Hub host before) and its path. */
export function landingPageUrl(slug: string, live: boolean = PUBLIC_SITE_LIVE, origin: string = PUBLIC_PAGES_URL): string {
  return `${origin}${landingPagePath(slug, live)}`;
}

/** What the editor shows before the slug field: "quillandcup.com/", or "hub.quillandcup.com/p/" before the cutover. */
export function landingAddressPrefix(live: boolean = PUBLIC_SITE_LIVE, origin: string = PUBLIC_PAGES_URL): string {
  return `${origin.replace(/^https?:\/\//, "")}${live ? "/" : "/p/"}`;
}
