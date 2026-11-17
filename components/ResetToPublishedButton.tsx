"use client";

import { useConfirm } from "@/components/ConfirmDialog";
import Icon from "@/components/Icon";

/**
 * THE "reset to published" control, for anything that saves drafts while it is edited and has a published copy: an icon
 * button (`<Icon name="reset" />`, not an undo icon, which means step-by-step undo) whose tooltip is the native `title`, with the same text as
 * its accessible name. The confirm dialog (`ConfirmDialog`) names what is lost, so the button needs no visible label. Show it only while the draft
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
  const { ask, dialog } = useConfirm();
  return (
    <>
    <button
      type="button"
      aria-label="Reset to published"
      title="Reset to published"
      disabled={disabled}
      className={className}
      onClick={async () => {
        const ok = await ask({
          title: "Reset to published?",
          body: `Your unpublished changes to this ${noun} are thrown away, and it goes back to the published ${noun}. This can't be undone.`,
          confirmLabel: "Reset to published",
          tone: "danger",
        });
        if (ok) onReset();
      }}
    >
      <Icon name="reset" />
    </button>
    {dialog}
    </>
  );
}
