"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideChatUnfurl } from "@/app/(member)/chat/actions";
import { track } from "@/lib/analytics/client";
import { pokeChat } from "@/lib/chat/list-events";

/**
 * The X on a preview card, for the author of the message: one click removes the card for everyone (on a message written in the Hub it is
 * taken off the Slack copy too; one written in Slack is left to its author there). Shows on hover or keyboard focus, and always on a device that can't hover.
 * The parent card is `relative group`. Placed as Slack does it:
 * - `gutter` (a page preview or a quoted message): in the left gutter of the message row, beside the card's top, so it is not
 *   stranded at the far side of a card narrower than the column. The row keeps a 3rem gutter (avatar column plus gap) at every width,
 *   and a card starts below the author line, so the X covers neither the avatar nor the time.
 * - `corner` (a picture shown on its own): a small round chip on the picture's top-right corner.
 */
export type RemovePlacement = "gutter" | "corner";

const PLACE: Record<RemovePlacement, { button: string; tip: string; error: string }> = {
  gutter: {
    button: "right-full top-0 mr-1.5 bg-slate-900/70 text-white hover:bg-slate-900 dark:bg-slate-100/80 dark:text-slate-900 dark:hover:bg-slate-100",
    tip: "left-0",
    error: "left-0 top-7",
  },
  corner: {
    button: "-right-2 -top-2 border border-slate-300 bg-white text-slate-900 shadow hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800",
    tip: "right-0",
    error: "right-0 top-5",
  },
};

export default function RemoveUnfurlButton({
  channelId,
  messageId,
  removeKey,
  source,
  placement = "gutter",
}: {
  channelId: string;
  messageId: string;
  removeKey: string;
  source: "hub" | "slack";
  placement?: RemovePlacement;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const place = PLACE[placement];

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label="Remove preview"
        data-track="chat-remove-unfurl"
        data-placement={placement}
        onClick={() =>
          startTransition(async () => {
            const result = await hideChatUnfurl(messageId, removeKey).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
            if (result.ok) {
              track("chat_unfurl_removed", { source, slack: result.slack });
              if (result.slack !== "failed") {
                if (!pokeChat(channelId)) router.refresh();
              } else {
                // Gone here; Slack kept its copy. Say so for a moment before the card goes.
                setError("Removed here. It may still show in Slack.");
                setTimeout(() => (pokeChat(channelId) ? undefined : router.refresh()), 3500);
              }
            } else setError(result.error);
          })
        }
        className={`group/x absolute z-20 inline-flex size-6 items-center justify-center rounded-full text-sm leading-none opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-plum-600 group-hover:opacity-100 disabled:opacity-50 [@media(hover:none)]:opacity-100 ${place.button}`}
      >
        <span aria-hidden="true">×</span>
        <span
          aria-hidden="true"
          data-testid="remove-preview-tip"
          className={`pointer-events-none absolute top-full mt-1 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-xs text-white opacity-0 shadow transition-opacity group-hover/x:opacity-100 group-focus-visible/x:opacity-100 dark:bg-slate-100 dark:text-slate-900 ${place.tip}`}
        >
          Remove preview
        </span>
      </button>
      {error && (
        <span role="alert" className={`absolute z-20 whitespace-nowrap rounded bg-white px-1 text-xs text-red-600 dark:bg-slate-900 dark:text-red-400 ${place.error}`}>
          {error}
        </span>
      )}
    </>
  );
}
