import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_URL, WRITER_PROFILES } from "@/lib/config";
import { landingSitemapUrl } from "@/lib/landing/sitemap";
import { getServiceRepos } from "@/lib/data/server";
import { isRootHost } from "@/lib/root-routing";
import { sitemapIds, sitemapUrl } from "@/lib/writer-sitemap";

// The list of sitemaps grows with the public pages, so it is read when asked for, not at build.
export const dynamic = "force-dynamic";

/**
 * What crawlers may fetch. The Hub's own pages need a sign-in, so there is nothing for them to read; the pages that are
 * public (landing pages, writer profiles) live on the public site's root host, which is the one that lists the landing pages'
 * sitemap (/sitemap.xml) and the writers' (docs/product/WRITER_PROFILES.md): a sitemap belongs to the host whose pages it lists. The app host lists none, since it sends
 * those pages to the root host. If the count cannot be read, the first sitemap is still listed: it exists whatever the count.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const rules = { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] };
  if (!isRootHost((await headers()).get("host"))) return { rules };
  const count = await getServiceRepos()
    .writerProfiles.publicCount()
    .catch(() => 0);
  return { rules, sitemap: [landingSitemapUrl(SITE_URL), ...sitemapIds(count, WRITER_PROFILES.sitemapPageSize).map(sitemapUrl)] };
}
