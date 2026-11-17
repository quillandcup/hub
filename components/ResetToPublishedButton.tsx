"use client";

import Icon from "@/components/Icon";

/**
 * THE "reset to published" control, for anything that saves drafts while it is edited and has a published copy: an icon
 * button (`<Icon name="reset" />`, not an undo icon, which means step-by-step undo) whose tooltip is the native `title`, with the same text as
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
      <Icon name="reset" />
    </button>
  );
}
