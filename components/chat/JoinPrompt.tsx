"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinChatChannel } from "@/app/(member)/chat/membership-actions";

/**
 * Where the message box would be for a public channel the member isn't in: posting needs being in it, so
 * offer to join (added in Slack too), after which the box appears.
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
    <div className="shrink-0 border-t border-slate-200 px-6 py-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600 dark:text-slate-400">You&apos;re not in {channelLabel}, so you can read it but not post.</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void join()}
          className="rounded-lg bg-plum-600 px-3 py-1.5 font-medium text-white hover:bg-plum-700 disabled:opacity-60"
        >
          {busy ? "Joining…" : `Join ${channelLabel}`}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
