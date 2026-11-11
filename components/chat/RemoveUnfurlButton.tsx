"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideChatUnfurl } from "@/app/(member)/chat/actions";
import { track } from "@/lib/analytics/client";
import { pokeChat } from "@/lib/chat/list-events";

/**
 * The X in the corner of a preview card, for the author of the message: one click removes the card for everyone (it can't be taken away in
 * Slack from here, so the Hub stops drawing it). Shows on hover or keyboard focus, and always on a device that can't hover. The parent
 * card is `relative group`.
 */
export default function RemoveUnfurlButton({ channelId, messageId, removeKey, source }: { channelId: string; messageId: string; removeKey: string; source: "hub" | "slack" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label="Remove preview"
        title="Remove preview"
        data-track="chat-remove-unfurl"
        onClick={() =>
          startTransition(async () => {
            const result = await hideChatUnfurl(messageId, removeKey).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
            if (result.ok) {
              track("chat_unfurl_removed", { source });
              if (!pokeChat(channelId)) router.refresh();
            } else setError(result.error);
          })
        }
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-sm leading-none text-white opacity-0 transition-opacity hover:bg-slate-900 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 [@media(hover:none)]:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>
      {error && (
        <span role="alert" className="absolute right-8 top-1.5 rounded bg-white px-1 text-xs text-red-600 dark:bg-slate-900 dark:text-red-400">
          {error}
        </span>
      )}
    </>
  );
}
