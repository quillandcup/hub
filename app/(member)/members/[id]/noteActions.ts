"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { MAX_NOTE_LENGTH } from "@/lib/member-notes";

export type SaveMemberNoteResult = { success: true; updatedAt: string | null } | { error: string };

/**
 * Save (or, when blank, delete) the signed-in member's private note about another member.
 *
 * Notes are author-only under RLS with no admin branch (see migration 20260928000600), and
 * RLS resolves the author from the session, not the sudo cookie -- so sudo is refused here
 * rather than writing the admin's own note while they're viewing as someone else.
 */
export async function saveMemberNote(subjectMemberId: string, body: string): Promise<SaveMemberNoteResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Private notes aren't available in sudo mode." };

  if (typeof subjectMemberId !== "string" || !subjectMemberId) return { error: "Invalid member" };
  if (subjectMemberId === identity.memberId) return { error: "You can't leave a note about yourself." };
  if (typeof body !== "string") return { error: "Invalid note" };
  if (body.length > MAX_NOTE_LENGTH) return { error: `Notes can be up to ${MAX_NOTE_LENGTH} characters.` };

  const supabase = await createClient();

  if (!body.trim()) {
    const { error } = await supabase
      .from("member_notes")
      .delete()
      .eq("author_member_id", identity.memberId)
      .eq("subject_member_id", subjectMemberId);
    if (error) {
      console.error("[member-notes] Deleting note failed", { author: identity.memberId, subjectMemberId, error });
      return { error: "Couldn't save your note — please try again." };
    }
    revalidatePath(`/members/${subjectMemberId}`);
    return { success: true, updatedAt: null };
  }

  const { data, error } = await supabase
    .from("member_notes")
    .upsert(
      { author_member_id: identity.memberId, subject_member_id: subjectMemberId, body },
      { onConflict: "author_member_id,subject_member_id" }
    )
    .select("updated_at")
    .single();
  if (error) {
    console.error("[member-notes] Saving note failed", { author: identity.memberId, subjectMemberId, error });
    return { error: "Couldn't save your note — please try again." };
  }
  revalidatePath(`/members/${subjectMemberId}`);
  return { success: true, updatedAt: data?.updated_at ?? null };
}
