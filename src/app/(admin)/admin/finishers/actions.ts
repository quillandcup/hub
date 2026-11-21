"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { isMilestoneKind } from "@/lib/finishers";
import { parseWork } from "@/lib/finishers-works";
import type { BackfillResult } from "@/lib/data/milestones";

const BASE_PATH = "/admin/finishers";

type Result<T = object> = ({ success: true } & T) | { error: string };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Per published book, proposes both milestones for that work unless it already has one of that kind (the book's project counts as
 * the same work). Rows start as proposals nobody but the member and staff can see. Running it again adds nothing.
 */
export async function proposeMilestonesFromBooks(): Promise<Result<BackfillResult>> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  try {
    const result = await createRepos(auth.supabase).milestones.proposeFromBooks();
    revalidatePath(BASE_PATH);
    return { success: true, ...result };
  } catch (error) {
    console.error("finishers.proposeFromBooks failed", errorMessage(error));
    return { error: "Couldn't propose the milestones. Try again in a moment." };
  }
}

/** The works a member has (their projects and live books, a book with a project counted once), for the hand-add picker. */
export async function loadWorksOfMember(memberId: string): Promise<Result<{ works: Array<{ projectId: string | null; bookId: string | null; title: string }> }>> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!memberId || !isId(memberId, "mbr")) return { error: "Choose a member." };
  try {
    const repos = createRepos(auth.supabase);
    const [projects, books] = await Promise.all([repos.writing.activeProjects(memberId), repos.books.mine(memberId)]);
    const works: Array<{ projectId: string | null; bookId: string | null; title: string }> = projects.map((p) => ({ projectId: p.id, bookId: null, title: p.title }));
    for (const b of books) {
      const linked = works.find((w) => w.projectId !== null && w.projectId === b.project_id);
      if (linked) linked.bookId = b.id;
      else works.push({ projectId: b.project_id ?? null, bookId: b.id, title: b.title });
    }
    return { success: true, works };
  } catch (error) {
    console.error("finishers.loadWorksOfMember failed", errorMessage(error));
    return { error: "Couldn't load that member's works." };
  }
}

/** Staff add one milestone for one work of one member (a project or book of theirs, or a title). It stays a proposal until the member confirms. */
export async function proposeMilestone(input: { memberId: string | null; kind: string; projectId?: string | null; bookId?: string | null; title?: string | null }): Promise<Result<{ added: boolean }>> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!input.memberId || !isId(input.memberId, "mbr")) return { error: "Choose a member." };
  if (!isMilestoneKind(input.kind)) return { error: "Choose which milestone." };
  const work = parseWork(input);
  if ("error" in work) return { error: work.error };
  try {
    const repos = createRepos(auth.supabase);
    // The work must be this member's own.
    if (work.projectId !== null && !(await repos.writing.ownsProject(input.memberId, work.projectId))) return { error: "That project is not this member's." };
    if (work.bookId !== null) {
      const book = (await repos.books.mine(input.memberId)).find((b) => b.id === work.bookId);
      if (!book) return { error: "That book is not this member's." };
      work.projectId = work.projectId ?? book.project_id ?? null;
    }
    const outcome = await repos.milestones.propose({
      memberId: input.memberId,
      kind: input.kind,
      work,
      achievedOn: null,
      createdBy: auth.user.id,
    });
    revalidatePath(BASE_PATH);
    return { success: true, added: outcome === "added" };
  } catch (error) {
    console.error("finishers.propose failed", errorMessage(error));
    return { error: "Couldn't add that milestone. Check the member and try again." };
  }
}

/** Staff take back a proposal the member has not answered. */
export async function withdrawMilestone(id: string): Promise<Result> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!id) return { error: "Missing milestone." };
  try {
    const done = await createRepos(auth.supabase).milestones.withdraw(id);
    revalidatePath(BASE_PATH);
    return done ? { success: true } : { error: "That proposal is gone or the member has already answered it." };
  } catch (error) {
    console.error("finishers.withdraw failed", errorMessage(error));
    return { error: "Couldn't withdraw it. Try again in a moment." };
  }
}
