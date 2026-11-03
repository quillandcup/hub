"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { MAX_ADMIN_NOTE_LENGTH } from "@/lib/data/admin-notes";
import { getRepos } from "@/lib/data/server";
import { isId } from "@/lib/ids";

export type NoteActionResult = { error: string } | { success: true };

async function addNoteImpl(userId: string, memberId: string, body: string): Promise<NoteActionResult> {
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  const text = body.trim();
  if (text === "") return { error: "Write something first." };
  if (text.length > MAX_ADMIN_NOTE_LENGTH) return { error: `A note can be at most ${MAX_ADMIN_NOTE_LENGTH} characters.` };
  try {
    await (await getRepos()).adminNotes.add(memberId, text, userId);
  } catch (error) {
    console.error("[admin-notes] add failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save the note." };
  }
  revalidatePath(`/admin/members/${memberId}`, "layout");
  return { success: true };
}

async function deleteNoteImpl(memberId: string, noteId: string): Promise<NoteActionResult> {
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  try {
    if (!(await (await getRepos()).adminNotes.remove(memberId, noteId))) return { error: "That note is already gone." };
  } catch (error) {
    console.error("[admin-notes] delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't delete the note." };
  }
  revalidatePath(`/admin/members/${memberId}`, "layout");
  return { success: true };
}

/** Adds a staff note to a member's profile, dated now and attributed to the signed-in admin. Staff only. */
export async function addMemberNote(memberId: string, body: string): Promise<NoteActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("admin_note_added", () => addNoteImpl(auth.user.id, memberId, body), (r) => ({ ok: "success" in r }));
}

/** Removes a note from a member's profile (kept in the database, hidden everywhere). Staff only. */
export async function deleteMemberNote(memberId: string, noteId: string): Promise<NoteActionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("admin_note_deleted", () => deleteNoteImpl(memberId, noteId), (r) => ({ ok: "success" in r }));
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
