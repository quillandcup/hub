import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LandingRender from "@/components/landing/LandingRender";
import { getCurrentUser } from "@/lib/auth";
import { getServiceRepos } from "@/lib/data/server";
import { withLiveData } from "@/lib/landing/live-server";
import {
  BOOKSHELF_PATH,
  PUBLIC_BOOKSHELF_DESCRIPTION,
  PUBLIC_BOOKSHELF_TITLE,
  publicBookshelfDocument,
  publicBookshelfUrl,
} from "@/lib/public-bookshelf";

/**
 * The public Hedgie Bookshelf, for anyone: no sign-in, no member data (docs/product/WRITER_PROFILES.md, "The public Hedgie Bookshelf").
 * It answers at `/bookshelf`: the proxy rewrites a signed-out visit there (src/lib/public-bookshelf.ts), so this path is not linked
 * and says in its tags that `/bookshelf` is the page. The books come from the Hedgie Bookshelf block's own loader: only books at
 * the globe, through the service role, cards of title, cover, the name on the book (pen name, else display name, never the legal
 * name) and the link to get it. A signed-in member is sent to the member Bookshelf instead, which also shows the house level and
 * their own books. Nothing here sends anything to an analytics provider beyond the site-wide consent rules.
 */
export const metadata: Metadata = {
  title: PUBLIC_BOOKSHELF_TITLE,
  description: PUBLIC_BOOKSHELF_DESCRIPTION,
  alternates: { canonical: publicBookshelfUrl() },
  openGraph: { title: PUBLIC_BOOKSHELF_TITLE, description: PUBLIC_BOOKSHELF_DESCRIPTION, type: "website", url: publicBookshelfUrl() },
  twitter: { card: "summary", title: PUBLIC_BOOKSHELF_TITLE, description: PUBLIC_BOOKSHELF_DESCRIPTION },
  robots: { index: true, follow: true },
};

export default async function PublicBookshelfPage() {
  if (await getCurrentUser()) redirect(BOOKSHELF_PATH);
  // The site's design is the PUBLISHED copy, as for a landing page: a draft of it never reaches a visitor.
  const site = await getServiceRepos().landingSiteTemplate.published();
  return <LandingRender data={await withLiveData(publicBookshelfDocument())} frame={{ pageType: "website", site }} />;
}
