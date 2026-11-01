"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { MAX_NOTE_LENGTH } from "@/lib/member-notes";

import { withAction } from "@/lib/analytics/server";
export type SaveMemberNoteResult = { success: true; updatedAt: string | null } | { error: string };

/**
 * Save (or, when blank, delete) the signed-in member's private note about another member.
 *
 * Notes are author-only under RLS with no admin branch (see migration 20260928000600), and
 * RLS resolves the author from the session, not the sudo cookie -- so sudo is refused here
 * rather than writing the admin's own note while they're viewing as someone else.
 */
async function saveMemberNoteImpl(subjectMemberId: string, body: string): Promise<SaveMemberNoteResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Private notes aren't available in sudo mode." };

  if (typeof subjectMemberId !== "string" || !subjectMemberId) return { error: "Invalid member" };
  if (subjectMemberId === identity.memberId) return { error: "You can't leave a note about yourself." };
  if (typeof body !== "string") return { error: "Invalid note" };
  if (body.length > MAX_NOTE_LENGTH) return { error: `Notes can be up to ${MAX_NOTE_LENGTH} characters.` };

  const profile = createRepos(await createClient()).memberProfile;

  if (!body.trim()) {
    try {
      await profile.deleteNote(identity.memberId, subjectMemberId);
    } catch (error) {
      console.error("[member-notes] Deleting note failed", { author: identity.memberId, subjectMemberId, error });
      return { error: "Couldn't save your note — please try again." };
    }
    revalidatePath(`/members/${subjectMemberId}`);
    return { success: true, updatedAt: null };
  }

  let updatedAt: string;
  try {
    updatedAt = await profile.saveNote(identity.memberId, subjectMemberId, body);
  } catch (error) {
    console.error("[member-notes] Saving note failed", { author: identity.memberId, subjectMemberId, error });
    return { error: "Couldn't save your note — please try again." };
  }
  revalidatePath(`/members/${subjectMemberId}`);
  return { success: true, updatedAt };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function saveMemberNote(...args: Parameters<typeof saveMemberNoteImpl>): ReturnType<typeof saveMemberNoteImpl> {
  return withAction("member_note_saved", () => saveMemberNoteImpl(...args));
}
