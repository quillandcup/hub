import type { Repos } from "@/lib/data/repos";
import { UNKNOWN_EDITOR } from "@/lib/landing/version-notes";
import { editorNames } from "@/lib/landing/version-people";

/** One kept publish of the site design, for History: who made it (a display name, never a user id) and when. */
export type SiteVersionSummary = { id: string; createdAt: string; by: string };

/** The versions kept at publish, newest first, each with the admin's display name (a handful of lookups together). */
export async function siteVersionSummaries(repos: Pick<Repos, "landingSiteTemplate" | "members">): Promise<SiteVersionSummary[]> {
  const versions = await repos.landingSiteTemplate.versions(20);
  const names = await editorNames(repos, versions.map((v) => v.published_by));
  return versions.map((v) => ({ id: v.id, createdAt: v.created_at, by: (v.published_by && names.get(v.published_by)) || UNKNOWN_EDITOR }));
}
