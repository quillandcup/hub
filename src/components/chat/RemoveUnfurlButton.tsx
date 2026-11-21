"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideChatUnfurl } from "@/app/(member)/chat/actions";
import { track } from "@/lib/analytics/client";
import RemoveUnfurlDialog from "@/components/chat/RemoveUnfurlDialog";
import type { BlockScope } from "@/lib/chat/link-preview-blocks";
import { pokeChat } from "@/lib/chat/list-events";
import Tooltip from "@/components/Tooltip";

/**
 * The X on a preview card, for the author of the message: it opens "Remove preview?" (RemoveUnfurlDialog), and confirming removes the card for everyone (on a message written in the Hub it is
 * taken off the Slack copy too; one written in Slack is left to its author there). Shows on hover or keyboard focus, and always on a device that can't hover.
 * The parent card is `relative group`. Placed as Slack does it:
 * - `gutter` (a page preview or a quoted message): in the left gutter of the message row, beside the card's top, so it is not
 *   stranded at the far side of a card narrower than the column. The row keeps a 3rem gutter (avatar column plus gap) at every width,
 *   and a card starts below the author line, so the X covers neither the avatar nor the time.
 * - `corner` (a picture shown on its own): a small round chip on the picture's top-right corner.
 */
export type RemovePlacement = "gutter" | "corner";

const PLACE: Record<RemovePlacement, { button: string; error: string }> = {
  gutter: {
    button: "right-full top-0 mr-1.5 bg-slate-900/70 text-white hover:bg-slate-900 dark:bg-slate-100/80 dark:text-slate-900 dark:hover:bg-slate-100",
    error: "left-0 top-7",
  },
  corner: {
    button: "-right-2 -top-2 border border-slate-300 bg-white text-slate-900 shadow hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800",
    error: "right-0 top-5",
  },
};

export default function RemoveUnfurlButton({
  channelId,
  messageId,
  removeKey,
  source,
  placement = "gutter",
  blockable = false,
}: {
  channelId: string;
  messageId: string;
  removeKey: string;
  source: "hub" | "slack";
  placement?: RemovePlacement;
  /** Whether the dialog may offer to block previews from the card's site: for a page preview, not a quoted message or a link to the Hub. */
  blockable?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const place = PLACE[placement];
  // The card's own address is in its key (`url:<address>`); a card without one (`idx:<n>`) can be removed but has nothing to block.
  const address = blockable && removeKey.startsWith("url:") ? removeKey.slice(4) : null;

  const confirm = (scope: BlockScope | null) =>
    startTransition(async () => {
      setDialogError(null);
      const result = await (scope ? hideChatUnfurl(messageId, removeKey, scope) : hideChatUnfurl(messageId, removeKey)).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!result.ok) {
        setDialogError(result.error);
        return;
      }
      setOpen(false);
      track("chat_unfurl_removed", { source, slack: result.slack });
      if (scope) track("chat_preview_block_chosen", { scope, saved: result.blocked === true });
      else if (address) track("chat_preview_block_chosen", { scope: "none", saved: false });
      const notes = [result.blockError, result.slack === "failed" ? "Removed here. It may still show in Slack." : null].filter(Boolean);
      if (notes.length === 0) {
        if (!pokeChat(channelId)) router.refresh();
      } else {
        // Gone here, but not everything worked (Slack kept its copy, or the block was not saved). Say so for a moment before the card goes.
        setError(notes.join(" "));
        setTimeout(() => (pokeChat(channelId) ? undefined : router.refresh()), 3500);
      }
    });

  return (
    <>
      {open && (
        <RemoveUnfurlDialog
          open
          address={address}
          pending={pending}
          error={dialogError}
          onCancel={() => {
            setOpen(false);
            setDialogError(null);
          }}
          onConfirm={confirm}
        />
      )}
      <Tooltip content="Remove preview">
        <button
          type="button"
          disabled={pending}
          aria-label="Remove preview"
          data-track="chat-remove-unfurl"
          data-placement={placement}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className={`absolute z-float inline-flex size-6 items-center justify-center rounded-full text-sm leading-none opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-plum-600 group-hover:opacity-100 disabled:opacity-50 [@media(hover:none)]:opacity-100 ${place.button}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </Tooltip>
      {error && (
        <span role="alert" className={`absolute z-float whitespace-nowrap rounded bg-white px-1 text-xs text-red-600 dark:bg-slate-900 dark:text-red-400 ${place.error}`}>
          {error}
        </span>
      )}
    </>
  );
}
