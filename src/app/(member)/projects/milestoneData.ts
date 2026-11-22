import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import type { Milestone } from "@/lib/data/milestones";
import type { CardBook } from "@/lib/finishers-works";
import type { MilestoneWebState } from "@/components/writing/Milestones";

/** What My Writing needs to show a member's milestones next to their projects (docs/product/FINISHERS.md). */
export type MilestoneContext = {
  milestones: Milestone[];
  /** The member's live Bookshelf books: a book with a project is that project's work. */
  books: CardBook[];
  /** The day the member first joined: a book published before it is on the Bookshelf but is not their Published milestone. */
  firstJoinedAt: string | null;
  /** Whether writer profiles are open to the member (the globe is offered) and whether their profile is on. */
  web: MilestoneWebState;
};

/**
 * Loads the milestone context for the effective member (sudo shows the member's own, look only). A failed read leaves that part
 * empty rather than breaking the page.
 */
export async function loadMilestoneContext(memberId: string): Promise<MilestoneContext> {
  const repos = createRepos(await createClient());
  const [milestones, books, web, firstJoinedAt] = await Promise.all([
    repos.milestones.ofMember(memberId).catch(() => []),
    repos.books.mine(memberId).catch(() => []),
    Promise.all([memberHasWriterProfiles(getServiceRepos(), memberId), repos.writerProfiles.ofMember(memberId)])
      .then(([available, page]) => ({ available, on: page?.isPublic ?? false }))
      .catch(() => ({ available: false, on: false })),
    repos.members.byId(memberId).then((m) => m?.firstJoinedAt ?? null).catch(() => null),
  ]);
  return {
    milestones,
    books: books.map((b) => ({ id: b.id, title: b.title, projectId: b.project_id ?? null, publishedDate: b.published_date })),
    firstJoinedAt,
    web,
  };
}
