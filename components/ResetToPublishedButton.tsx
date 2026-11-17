"use client";

import { RotateCcw } from "lucide-react";

/**
 * THE "reset to published" control, for anything that saves drafts while it is edited and has a published copy: an icon
 * button (`RotateCcw`, not `Undo2`, which means step-by-step undo) whose tooltip is the native `title`, with the same text as
 * its accessible name. The confirm names what is lost, so the button needs no visible label. Show it only while the draft
 * differs from the published copy; the caller does the reset (and reloads whatever holds the draft).
 */
export default function ResetToPublishedButton({
  onReset,
  disabled = false,
  noun = "page",
  className,
}: {
  onReset: () => void;
  disabled?: boolean;
  /** What the draft belongs to, for the confirm text ("page", "course"). */
  noun?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Reset to published"
      title="Reset to published"
      disabled={disabled}
      className={className}
      onClick={() => {
        if (window.confirm(`Throw away your unpublished changes and go back to the published ${noun}? This can't be undone.`)) onReset();
      }}
    >
      <RotateCcw size={16} aria-hidden="true" />
    </button>
  );
}
