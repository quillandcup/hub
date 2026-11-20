import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import WriterPageView from "@/components/writer/WriterPageView";
import { getServiceRepos } from "@/lib/data/server";
import type { PublicLookup } from "@/lib/data/writer-profiles";
import { memberHasWriterPages } from "@/lib/writer-pages-access";
import { writerPageMetadata } from "@/lib/writer-page-seo";
import { isHandleShaped, normalizeHandle, writerPagePath } from "@/lib/writer-profile";

type Params = { params: Promise<{ handle: string }> };

/**
 * A writer's public page, for anyone: no sign-in (docs/WRITER_PROFILES.md). The one read runs with the service role and
 * returns only what the page's own switches allow, so a page that is off, deleted or never existed is the same 404: nothing
 * says a hidden page exists. A handle the member gave up redirects to the one they use now. An address that cannot be a
 * handle at all is not looked up. A page whose owner does not have the `writer_pages` flag is not served either: the same 404,
 * decided for the owner (a visitor has no flag), without touching the page's data. Nothing here sends anything to an analytics provider beyond the site-wide consent rules.
 */
const load = cache(async (handle: string): Promise<PublicLookup> => {
  if (!isHandleShaped(handle)) return { kind: "none" };
  const repos = getServiceRepos();
  const found = await repos.writerProfiles.publicByHandle(normalizeHandle(handle));
  if (found.kind === "none") return found;
  return (await memberHasWriterPages(repos, found.ownerId)) ? found : { kind: "none" };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const found = await load(handle);
  if (found.kind !== "page") return { title: "Not found", robots: { index: false } };
  return writerPageMetadata(found.profile, { indexed: true });
}

export default async function WriterPage({ params }: Params) {
  const { handle } = await params;
  const found = await load(handle);
  if (found.kind === "none") notFound();
  // A handle they gave up, or the same one in capitals: one address per page.
  if (found.kind === "redirect") permanentRedirect(writerPagePath(found.handle));
  if (found.profile.handle !== handle) permanentRedirect(writerPagePath(found.profile.handle));
  return <WriterPageView profile={found.profile} />;
}
