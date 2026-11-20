"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { BIO_MAX_LENGTH } from "@/lib/writer-profile";
import { saveWriterPageDetails } from "./writerPageActions";

const INPUT_CLASS = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SAVE_CLASS = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const LINK_BUTTON = "text-xs underline text-plum-700 dark:text-plum-300 hover:text-plum-900 dark:hover:text-plum-100";

/**
 * Under the bio: "Add a different public bio" opens a second box, written for the web page only (`writer_profiles.public_bio`,
 * the same length limit as the bio on the page has always had). While it has text, the writer page uses it instead of the member
 * bio, and the member bio can be shared with members or kept private. "Remove the separate public bio" asks first when it holds
 * text, since removing it deletes that text. Only for a member the `writer_pages` flag is on for (the caller decides).
 */
export default function SeparatePublicBio({
  saved,
  publicNameAliasId,
  onChanged,
}: {
  /** The separate bio as saved ("" when there is none). */
  saved: string;
  /** The page's name choice, sent along so saving the bio never changes it. */
  publicNameAliasId: string | null;
  /** Called after a save or a removal, so the settings reload. */
  onChanged: (message: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(saved !== "");
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    const result = await saveWriterPageDetails({ publicNameAliasId, bio: text });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    await onChanged(text.trim() === "" ? "Separate public bio removed." : "Public bio saved.");
  }

  async function remove(): Promise<string | undefined> {
    const result = await saveWriterPageDetails({ publicNameAliasId, bio: "" });
    if ("error" in result) return result.error;
    setText("");
    setOpen(false);
    await onChanged("Separate public bio removed.");
    return undefined;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-track="settings-profile-add-public-bio" className={LINK_BUTTON}>
        Add a different public bio
      </button>
    );
  }

  // Not a <form>: it sits inside the profile form, and a form cannot hold a form.
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-baseline justify-between">
        <label htmlFor="profile-public-bio" className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Public bio
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {text.trim().length}/{BIO_MAX_LENGTH}
        </span>
      </div>
      <textarea
        id="profile-public-bio"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={BIO_MAX_LENGTH + 100}
        placeholder="A little about you and your writing, for your page on the web. Plain text."
        className={INPUT_CLASS}
      />
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Your writer page shows this bio instead of the one above. The bio above then stays with other members, or only with you.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} data-track="settings-profile-save-public-bio" disabled={busy || text.trim() === ""} className={SAVE_CLASS}>
          Save public bio
        </button>
        <button
          type="button"
          data-track="settings-profile-remove-public-bio"
          onClick={() => (saved.trim() === "" ? (setText(""), setOpen(false)) : setConfirmRemove(true))}
          className={LINK_BUTTON}
        >
          Remove the separate public bio
        </button>
      </div>
      {/* The dialog is a form of its own, and a portal's events bubble to the profile form around this box: keep its submit from saving the profile. */}
      <div onSubmit={(e) => e.stopPropagation()}>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove the separate public bio?"
        body="The text you wrote for your page is deleted and can't be brought back. Your writer page then uses your bio above, if you have opened it to the internet, and otherwise shows no bio."
        confirmLabel="Remove public bio"
        tone="danger"
        onConfirm={remove}
      />
      </div>
    </div>
  );
}
