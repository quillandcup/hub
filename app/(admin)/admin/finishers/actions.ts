"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { isMilestoneKind } from "@/lib/finishers";

const BASE_PATH = "/admin/finishers";

type Result<T = object> = ({ success: true } & T) | { error: string };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Proposes both milestones for every member with a published book who has no milestone of that kind yet. Rows start as
 * proposals nobody but the member and staff can see. Running it again adds nothing.
 */
export async function proposeMilestonesFromBooks(): Promise<Result<{ added: number }>> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  try {
    const added = await createRepos(auth.supabase).milestones.proposeFromBooks();
    revalidatePath(BASE_PATH);
    return { success: true, added };
  } catch (error) {
    console.error("finishers.proposeFromBooks failed", errorMessage(error));
    return { error: "Couldn't propose the milestones. Try again in a moment." };
  }
}

/** Staff add one milestone for one member. It stays a proposal until the member confirms. */
export async function proposeMilestone(input: { memberId: string | null; kind: string }): Promise<Result<{ added: boolean }>> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!input.memberId || !isId(input.memberId, "mbr")) return { error: "Choose a member." };
  if (!isMilestoneKind(input.kind)) return { error: "Choose which milestone." };
  try {
    const outcome = await createRepos(auth.supabase).milestones.propose({
      memberId: input.memberId,
      kind: input.kind,
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
