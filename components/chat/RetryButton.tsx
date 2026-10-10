"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryChatMessage } from "@/app/(member)/chat/actions";

/** Sends a message Slack didn't take again; shown on the author's own failed messages. */
export default function RetryButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryChatMessage(messageId);
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
        className="text-xs font-medium text-plum-600 hover:underline disabled:opacity-50 dark:text-plum-400"
      >
        {pending ? "Retrying…" : "Retry"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
