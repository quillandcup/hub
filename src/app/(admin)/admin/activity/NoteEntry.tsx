"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_ADMIN_NOTE_LENGTH } from "@/lib/data/admin-notes";
import { deleteMemberNote, editMemberNote } from "@/app/(admin)/admin/members/[id]/notes-actions";
import { describeRow, type ActivityFeedRow } from "@/lib/activity-feed";

/** What the member's own page adds to a note in the timeline: who the signed-in admin is and how long a note stays editable. */
export interface NoteControls {
  memberId: string;
  currentUserId: string | null;
  editMinutes: number;
}

/**
 * A staff note in the activity timeline: its text in full (it is the point of the row), "edited" when
 * its author corrected it, and on the member's page Edit (author, inside the window) and Delete.
 * The database enforces the same rules; the buttons only hide what would be refused.
 */
export default function NoteEntry({ row, controls }: { row: ActivityFeedRow; controls?: NoteControls }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Time is read after mount so the server render and the first client render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const noteId = typeof row.data?.note_id === "string" ? row.data.note_id : null;
  const edited = typeof row.data?.edited_at === "string";
  const canEdit =
    !!controls && !!noteId && now !== null && row.actor_user_id !== null && row.actor_user_id === controls.currentUserId &&
    now < Date.parse(row.occurred_at) + controls.editMinutes * 60_000;

  const run = (action: () => Promise<{ error: string } | { success: true }>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) return setError(result.error);
      onDone?.();
      router.refresh();
    });
  };

  if (editing && controls && noteId) {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => editMemberNote(controls.memberId, noteId, draft), () => setEditing(false));
        }}
      >
        <label htmlFor={`edit-${noteId}`} className="sr-only">
          Edit note
        </label>
        <textarea
          id={`edit-${noteId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_ADMIN_NOTE_LENGTH}
          rows={3}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
        />
        <div className="flex items-center gap-3 text-xs">
          <button type="submit" disabled={pending || draft.trim() === ""} className="px-3 py-1 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg font-medium">
            {pending ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={() => { setEditing(false); setDraft(row.description ?? ""); setError(null); }} className="text-slate-600 dark:text-slate-400 hover:underline">
            Cancel
          </button>
          {error && <span role="alert" className="text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </form>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{describeRow(row)}</p>
      <p className="mt-0.5 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">{row.description}</p>
      {(controls || edited) && (
        <p className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          {edited && <span>edited</span>}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="hover:underline">
              Edit
            </button>
          )}
          {controls && noteId && (
            <button type="button" disabled={pending} onClick={() => run(() => deleteMemberNote(controls.memberId, noteId))} className="hover:text-red-600 dark:hover:text-red-400 hover:underline">
              Delete
            </button>
          )}
          {error && <span role="alert" className="text-red-600 dark:text-red-400">{error}</span>}
        </p>
      )}
    </div>
  );
}
