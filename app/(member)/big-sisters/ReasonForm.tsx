"use client";

import { useState, useTransition } from "react";
import { saveReasonNote } from "./actions";

/** Shown to a big sister when a trial member didn't continue: what do they think happened? The
 * reason is the only thing staff track by hand in this program, and it's the big sister who knows. */
export default function ReasonForm({
  mentorshipId,
  name,
  initialNote,
}: {
  mentorshipId: string;
  name: string;
  initialNote: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReasonNote(mentorshipId, note);
      if ("error" in result) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4">
      <label htmlFor={`reason-${mentorshipId}`} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        {name} didn&apos;t stay after their trial. What do you think happened?
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
        Only staff see this. It helps us understand what to do better, like price, timing, or it not being the right
        fit.
      </p>
      <textarea
        id={`reason-${mentorshipId}`}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        rows={3}
        maxLength={1000}
        disabled={pending}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || note.trim() === initialNote.trim()}
          className="px-3 py-1.5 text-sm font-medium bg-plum-600 hover:bg-plum-700 text-white rounded-lg disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-xs text-green-700 dark:text-green-400">Saved. Thank you.</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
