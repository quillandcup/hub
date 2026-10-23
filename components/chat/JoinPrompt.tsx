"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { joinChatChannel } from "@/app/(member)/chat/membership-actions";

/**
 * Where the message box would be for a public channel the member isn't in, laid out like Slack's "Join
 * channel" card: the channel's name, Details (who is in it) and Join. Posting needs being in it; joining
 * adds them in Slack too, after which the box appears.
 */
export default function JoinPrompt({ channelId, channelLabel }: { channelId: string; channelLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    const result = await joinChatChannel(channelId).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  };

  return (
    <div className="shrink-0 px-6 pb-4 pt-2">
      <section aria-label={`Join ${channelLabel}`} className="rounded-xl border border-slate-200 px-4 py-5 text-center dark:border-slate-700">
        <h2 className="text-lg font-bold">{channelLabel}</h2>
        <div className="mt-3 flex items-center justify-center gap-3">
          <Link
            data-track="chat-join-details"
            href={`/chat/${channelId}/members`}
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Details
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => void join()}
            className="rounded-lg bg-plum-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-60"
          >
            {busy ? "Joining…" : "Join channel"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
