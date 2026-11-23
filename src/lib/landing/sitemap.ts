import type { MetadataRoute } from "next";
import type { Repos } from "@/lib/data/repos";
import { landingPageUrl } from "@/lib/landing/address";

/**
 * The root host's own sitemap (/sitemap.xml): every published landing page, by its public address (`/<slug>`, `/` for the page
 * `home`), with when it was published or last saved. Never a draft, a taken-down or deleted page, or a template: it lists what
 * `publishedAddresses` returns, the same set the proxy serves at /<slug>. The writers' sitemaps are listed apart (/w/sitemap/<n>.xml,
 * src/lib/writer-sitemap.ts); robots.txt names both. One file holds up to 50,000 addresses, far past the number of pages anyone builds.
 */
export async function landingSitemapEntries(repos: Repos): Promise<MetadataRoute.Sitemap> {
  const pages = await repos.landingPages.publishedAddresses();
  return pages.map((page) => ({ url: landingPageUrl(page.slug), lastModified: page.updatedAt }));
}

/** The address of that file, on the root host. */
export function landingSitemapUrl(siteUrl: string): string {
  return `${siteUrl}/sitemap.xml`;
}
