import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import WriterProfileView from "@/components/writer/WriterProfileView";
import { getServiceRepos } from "@/lib/data/server";
import type { PublicLookup } from "@/lib/data/writer-profiles";
import { memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { writerProfileMetadata } from "@/lib/writer-profile-seo";
import { isHandleShaped, normalizeHandle, writerProfilePath } from "@/lib/writer-profile";

type Params = { params: Promise<{ handle: string }> };

/**
 * A writer profile, for anyone: no sign-in (docs/product/WRITER_PROFILES.md). The one read runs with the service role and
 * returns only what the page's own switches allow, so a page that is off, deleted or never existed is the same 404: nothing
 * says a hidden page exists. A handle the member gave up redirects to the one they use now. An address that cannot be a
 * handle at all is not looked up. A page whose owner does not have the `writer_profiles` flag is not served either: the same 404,
 * decided for the owner (a visitor has no flag), without touching the page's data. Nothing here sends anything to an analytics provider beyond the site-wide consent rules.
 */
const load = cache(async (handle: string): Promise<PublicLookup> => {
  if (!isHandleShaped(handle)) return { kind: "none" };
  const repos = getServiceRepos();
  const found = await repos.writerProfiles.publicByHandle(normalizeHandle(handle));
  if (found.kind === "none") return found;
  return (await memberHasWriterProfiles(repos, found.ownerId)) ? found : { kind: "none" };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const found = await load(handle);
  if (found.kind !== "page") return { title: "Not found", robots: { index: false } };
  return writerProfileMetadata(found.profile, { indexed: true });
}

export default async function WriterProfile({ params }: Params) {
  const { handle } = await params;
  const found = await load(handle);
  if (found.kind === "none") notFound();
  // A handle they gave up, or the same one in capitals: one address per page.
  if (found.kind === "redirect") permanentRedirect(writerProfilePath(found.handle));
  if (found.profile.handle !== handle) permanentRedirect(writerProfilePath(found.profile.handle));
  // The milestones at the globe: read now, after the checks in `load` (the page is on, the owner has the feature), and again after
  // the member changes one (the milestone actions revalidate this path), so a withdrawn one leaves on the next read of the page.
  const milestones = await getServiceRepos().milestones.shownOnWeb(found.ownerId);
  return <WriterProfileView profile={found.profile} milestones={milestones} />;
}
