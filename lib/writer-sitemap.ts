import type { MetadataRoute } from "next";
import type { WriterProfileRepository } from "@/lib/data/writer-profiles";
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

/** One sitemap file's entries: the public pages, by address, with when each last changed. Never a page that is off. */
export async function writerSitemapEntries(repo: WriterProfileRepository, page: number, pageSize: number): Promise<MetadataRoute.Sitemap> {
  const handles = await repo.publicHandles(page, pageSize);
  return handles.map((h) => ({ url: writerPageUrl(h.handle), lastModified: h.updatedAt }));
}
