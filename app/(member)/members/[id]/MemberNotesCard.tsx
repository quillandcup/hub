"use client";

import { useState, type FormEvent } from "react";
import { saveMemberNote } from "./noteActions";
import { MAX_NOTE_LENGTH } from "@/lib/member-notes";

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "Notes to self" about the member whose profile this is -- things to follow up on, what they're
 * working on, how you met. Only the author ever sees it (RLS, no admin access).
 */
export default function MemberNotesCard({
  subjectMemberId,
  firstName,
  initialBody,
  initialUpdatedAt,
}: {
  subjectMemberId: string;
  firstName: string;
  initialBody: string;
  initialUpdatedAt: string | null;
}) {
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = body !== savedBody;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);
    setSaving(true);
    const result = await saveMemberNote(subjectMemberId, body);
    setSaving(false);
    if ("error" in result) return setError(result.error);
    const stored = body.trim() ? body : "";
    setBody(stored);
    setSavedBody(stored);
    setUpdatedAt(result.updatedAt);
    setJustSaved(true);
  }

  return (
    <form
      onSubmit={handleSave}
      className="bg-white dark:bg-slate-900 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 mb-6"
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          <label htmlFor="member-note">My notes</label>
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">🔒 Only you can see this</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Things you want to remember or follow up on with {firstName}.
      </p>
      <textarea
        id="member-note"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setJustSaved(false);
        }}
        rows={4}
        maxLength={MAX_NOTE_LENGTH}
        placeholder={`e.g. Met at the Tuesday sprint — ask ${firstName} how the query letter went`}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span role="status" className="text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : justSaved ? (
            <span className="text-green-600 dark:text-green-400">{savedBody ? "Saved." : "Note deleted."}</span>
          ) : updatedAt && !dirty ? (
            <span className="text-slate-400 dark:text-slate-500">Last edited {formatSavedAt(updatedAt)}</span>
          ) : null}
        </span>
        <button
          type="submit"
          disabled={saving || !dirty}
          className="px-3 py-1.5 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </form>
  );
}
