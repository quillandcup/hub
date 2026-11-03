"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_ADMIN_NOTE_LENGTH } from "@/lib/data/admin-notes";
import { addMemberNote } from "./notes-actions";

/** Adds a staff note to a member: it appears in their timeline, dated now and attributed to the signed-in admin. */
export default function MemberNoteForm({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await addMemberNote(memberId, body);
          if ("error" in result) return setError(result.error);
          setBody("");
          router.refresh();
        });
      }}
      className="space-y-2 mb-6"
    >
      <label htmlFor="member-note-body" className="block text-sm font-medium">
        Add a note
      </label>
      <textarea
        id="member-note-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX_ADMIN_NOTE_LENGTH}
        rows={3}
        placeholder="What happened, or what to follow up on. Only staff see it."
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
  );
}
