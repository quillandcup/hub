import type { MetadataRoute } from "next";
import { WRITER_PROFILES } from "@/lib/config";
import { getServiceRepos } from "@/lib/data/server";
import { sitemapIds, sitemapUrl } from "@/lib/writer-sitemap";

// The list of sitemaps grows with the public pages, so it is read when asked for, not at build.
export const dynamic = "force-dynamic";

/**
 * What crawlers may fetch. The Hub's own pages need a sign-in, so there is nothing for them to read; the pages that are
 * public (landing pages, writer profiles) are open, and the writers' sitemaps are listed (docs/product/WRITER_PROFILES.md).
 * If the count cannot be read, the first sitemap is still listed: it exists whatever the count.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const count = await getServiceRepos()
    .writerProfiles.publicCount()
    .catch(() => 0);
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] },
    sitemap: sitemapIds(count, WRITER_PROFILES.sitemapPageSize).map(sitemapUrl),
  };
}
