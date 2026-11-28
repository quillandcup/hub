import type { MetadataRoute } from "next";
import { publicBookshelfUrl } from "@/lib/public-bookshelf";

/**
 * The site's own sitemap, at /sitemap.xml: the public pages that are not one per member (the writers' profiles have their own,
 * at /w/sitemap/<n>.xml, listed beside it in robots.txt). Today that is the public Hedgie Bookshelf; a new public page of this
 * kind is one more line here (docs/product/WRITER_PROFILES.md, "The public Hedgie Bookshelf"). No dates: nothing here says when the
 * shelf last changed without a read, and an honest list without them is better than a guess.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: publicBookshelfUrl() }];
}
