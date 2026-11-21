"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDirectMessage } from "@/app/(member)/chat/dm-actions";

/** Opens (creating the first time) the signed-in member's direct message with `memberId`, in chat. */
export default function MessageMemberButton({ memberId, className }: { memberId: string; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    startTransition(async () => {
      const result = await startDirectMessage(memberId);
      if (result.ok) router.push(`/chat/${result.channelId}`);
      else setError(result.error);
    });
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {pending ? "Opening…" : "Message"}
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
