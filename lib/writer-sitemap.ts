import type { MetadataRoute } from "next";
import type { Repos } from "@/lib/data/repos";
import { ownersWithWriterPages } from "@/lib/writer-pages-access";
import { APP_URL } from "@/lib/config";
import { WRITER_PAGE_PATH, writerPageUrl } from "@/lib/writer-profile";

/** The sitemap ids for this many public pages: at least one (an empty sitemap is valid), then one per page of `pageSize`. */
export function sitemapIds(count: number, pageSize: number): number[] {
  return Array.from({ length: Math.max(1, Math.ceil(count / pageSize)) }, (_, i) => i);
}

/** The address of one of the sitemap files. */
export function sitemapUrl(id: number): string {
  return `${APP_URL}${WRITER_PAGE_PATH}/sitemap/${id}.xml`;
}

/**
 * One sitemap file's entries: the public pages, by address, with when each last changed. Never a page that is off, nor one
 * whose owner does not have the `writer_pages` flag: the owners of this one file's pages are checked together, in a few
 * queries however many there are, so a file can hold fewer than `pageSize` addresses (and `publicCount`, which does not
 * know the flag, can list a file more than needed; an empty sitemap is valid).
 */
export async function writerSitemapEntries(repos: Repos, page: number, pageSize: number): Promise<MetadataRoute.Sitemap> {
  const handles = await repos.writerProfiles.publicHandles(page, pageSize);
  const allowed = await ownersWithWriterPages(repos, handles.map((h) => h.memberId));
  return handles.filter((h) => allowed.has(h.memberId)).map((h) => ({ url: writerPageUrl(h.handle), lastModified: h.updatedAt }));
}
