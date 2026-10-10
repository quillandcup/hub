"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage } from "@/app/(member)/chat/actions";

/**
 * The box a member writes in, under a conversation or inside a thread. Enter sends, Shift+Enter
 * starts a new line. The page refreshes after a send (Realtime would too, but not for the
 * sender's own message in every case), so the message shows up in place, "Sending…" until Slack has it.
 */
export default function Composer({
  channelId,
  threadRootId,
  placeholder,
}: {
  channelId: string;
  threadRootId?: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await sendChatMessage(channelId, body, threadRootId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      router.refresh();
      boxRef.current?.focus();
    });
  };

  return (
    <form
      className="shrink-0 border-t border-slate-200 px-6 py-3 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor={`composer-${threadRootId ?? channelId}`}>
        {placeholder}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={`composer-${threadRootId ?? channelId}`}
          ref={boxRef}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Not while an input method is composing (Enter picks a candidate then).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={pending || text.trim() === ""}
          className="shrink-0 rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
