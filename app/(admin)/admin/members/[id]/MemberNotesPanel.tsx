"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_ADMIN_NOTE_LENGTH } from "@/lib/data/admin-notes";
import { addMemberNote, deleteMemberNote } from "./notes-actions";

/** A staff note as the panel shows it: the author is a display name (null once their account is gone). */
export interface NoteView {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
}

export default function MemberNotesPanel({ memberId, notes, timeZone }: { memberId: string; notes: NoteView[]; timeZone: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });

  const run = (action: () => Promise<{ error: string } | { success: true }>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  };

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6" aria-labelledby="member-notes-heading">
      <h2 id="member-notes-heading" className="text-lg font-bold mb-1">
        Notes
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Staff only. The member never sees these.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addMemberNote(memberId, body), () => setBody(""));
        }}
        className="space-y-2 mb-4"
      >
        <label htmlFor="member-note-body" className="sr-only">
          New note
        </label>
        <textarea
          id="member-note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_ADMIN_NOTE_LENGTH}
          rows={3}
          placeholder="What happened, or what to follow up on"
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || body.trim() === ""}
            className="px-4 py-1.5 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {pending ? "Saving..." : "Add note"}
          </button>
          {error && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No notes yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {notes.map((note) => (
            <li key={note.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm whitespace-pre-wrap break-words">{note.body}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {note.authorName ?? "Former staff"} · <time dateTime={note.createdAt}>{when.format(new Date(note.createdAt))}</time>
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteMemberNote(memberId, note.id))}
                className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
