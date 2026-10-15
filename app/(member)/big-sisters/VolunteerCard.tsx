"use client";

import { useState, useTransition } from "react";
import { setBigSisterAvailability } from "./actions";

/** "Become a Big Sister": volunteer (with a note for staff) or withdraw. `blockedReason` is why
 * this member can't yet; `readOnly` is sudo. */
export default function VolunteerCard({
  volunteering,
  initialNote,
  blockedReason,
  readOnly,
}: {
  volunteering: boolean;
  initialNote: string;
  blockedReason: string | null;
  readOnly: boolean;
}) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(available: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setBigSisterAvailability(available, note);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
        Be a Big Sister
      </h2>
      {blockedReason && !volunteering ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{blockedReason}</p>
      ) : (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
            {volunteering
              ? "You're on the list. We'll match you with a new member when it's your turn, and you'll get a message when we do."
              : "Happy to show a new member around for their first weeks? Add yourself to the list and we'll match you when it's your turn. You can step off any time."}
          </p>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="bs-note">
            Anything we should know? (optional, only staff see it)
          </label>
          <input
            id="bs-note"
            type="text"
            value={note}
            maxLength={300}
            disabled={readOnly || pending}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. best on weekday mornings"
            className="w-full px-3 py-2 mb-4 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm"
          />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={readOnly || pending}
              onClick={() => save(true)}
              className="px-4 py-2 bg-plum-600 text-white rounded-lg text-sm font-medium hover:bg-plum-700 disabled:opacity-50"
            >
              {volunteering ? "Save note" : "Add me to the list"}
            </button>
            {volunteering && (
              <button
                type="button"
                disabled={readOnly || pending}
                onClick={() => save(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Step off the list
              </button>
            )}
          </div>
          {readOnly && <p className="mt-3 text-xs text-slate-500">Viewing as a member is read-only.</p>}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
