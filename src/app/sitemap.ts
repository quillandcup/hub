import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getServiceRepos } from "@/lib/data/server";
import { landingSitemapEntries } from "@/lib/landing/sitemap";
import { isRootHost } from "@/lib/root-routing";

// The published pages change whenever staff publish or take one down, so this is read when asked for, not at build.
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml: the published landing pages, on the root host, where they live. The app host has no public pages to list (it
 * sends them to the root host), so it answers with an empty sitemap, which is valid. A failed read is an error, not an empty
 * list, so a crawler retries instead of dropping the pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isRootHost((await headers()).get("host"))) return [];
  return landingSitemapEntries(getServiceRepos());
}
