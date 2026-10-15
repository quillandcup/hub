"use client";

import { useState, useTransition } from "react";
import { restrictSlackChannel, unrestrictSlackChannel } from "./actions";

/** Restrict / lift-restriction button for one channel row. */
export default function RestrictionToggle({
  channelId,
  channelName,
  restricted,
}: {
  channelId: string;
  channelName: string;
  restricted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const question = restricted
      ? `Let staff read messages in #${channelName} again? This is recorded in the activity log.`
      : `Stop staff reading messages in #${channelName}? This is recorded in the activity log.`;
    if (!window.confirm(question)) return;

    setError(null);
    startTransition(async () => {
      const result = restricted ? await unrestrictSlackChannel(channelId) : await restrictSlackChannel(channelId);
      if (result && "error" in result && result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="px-3 py-1 rounded-lg text-sm border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
      >
        {pending ? "Saving..." : restricted ? "Lift restriction" : "Restrict"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
