import { revalidatePath } from "next/cache";
import type { Repos } from "@/lib/data/repos";
import { writerProfilePath } from "@/lib/writer-profile";

/**
 * Everything that shows a member's milestones is read again after a change: their card, the profile other members see, and the
 * writer profile on the web (rendered on demand, so withdrawing a level or the share tick takes effect on the next read of
 * those pages; the revalidation is for any cached copy: docs/product/FINISHERS.md, "Where it shows").
 */
export async function revalidateMilestoneSurfaces(repos: Repos, memberId: string) {
  revalidatePath("/settings/profile");
  revalidatePath(`/members/${memberId}`);
  const page = await repos.writerProfiles.ofMember(memberId).catch(() => null);
  if (page) revalidatePath(writerProfilePath(page.handle));
}
