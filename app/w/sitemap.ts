import type { MetadataRoute } from "next";
import { getServiceRepos } from "@/lib/data/server";
import { WRITER_PROFILES } from "@/lib/config";
import { sitemapIds, writerSitemapEntries } from "@/lib/writer-sitemap";

// Read at request time: the list changes whenever a member switches their page on or off, and a build has no business reading it.
export const dynamic = "force-dynamic";

/**
 * One sitemap per `sitemapPageSize` public pages, at /w/sitemap/<n>.xml (docs/WRITER_PROFILES.md). Next also calls this while
 * building, where the database may not be reachable: the first sitemap exists whatever the count, so an unreadable count
 * gives that one (as robots.txt does) and never fails the build.
 */
export async function generateSitemaps() {
  const count = await getServiceRepos()
    .writerProfiles.publicCount()
    .catch(() => 0);
  return sitemapIds(count, WRITER_PROFILES.sitemapPageSize).map((id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const page = Number(await props.id);
  return writerSitemapEntries(getServiceRepos(), Number.isInteger(page) && page >= 0 ? page : 0, WRITER_PROFILES.sitemapPageSize);
}
