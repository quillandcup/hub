"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage } from "@/app/(member)/chat/actions";
import { PENDING_ID_PREFIX, emitListEvent, optimisticView, pokeChat } from "@/lib/chat/list-events";

/**
 * The box a member writes in, under a conversation or inside a thread. Enter sends, Shift+Enter
 * starts a new line.
 *
 * The box clears and (in a conversation) the message appears in the list the moment Send is pressed,
 * "Sending to Slack…" until Slack has it, instead of waiting for the server action and then for the
 * whole page to re-render, which took seconds. The action's real message replaces the placeholder;
 * a refused or failed send takes it away and puts the text back. Afterwards the conversation is
 * asked to catch up (in the background, and Realtime does too) so what is shown is what the server has.
 */
export default function Composer({
  channelId,
  threadRootId,
  placeholder,
  viewer,
  showSent = true,
}: {
  channelId: string;
  threadRootId?: string;
  placeholder: string;
  /** Who is writing, for the message shown while it is sent. Without it nothing is shown early. */
  viewer?: { memberId: string; name: string; photoUrl: string | null };
  /** Show the sent message in the conversation's list at once (not for threads, whose list is the server's). */
  showSent?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const early = Boolean(viewer) && showSent && !threadRootId;

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setError(null);
    setSending(true);
    setText("");
    const tempId = `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
    if (early) emitListEvent({ kind: "add", channelId, view: optimisticView({ id: tempId, body, viewer: viewer! }) });

    const result = await sendChatMessage(channelId, body, threadRootId).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setSending(false);
    if (!result.ok) {
      if (early) emitListEvent({ kind: "drop", channelId, tempId });
      setText((current) => (current ? `${body}\n${current}` : body));
      setError(result.error);
      return;
    }
    if (early) emitListEvent({ kind: "swap", channelId, tempId, view: optimisticView({ id: result.id, body, viewer: viewer! }) });
    // Bring the conversation up to date: just its newest messages when it is open here, else the page.
    if (!pokeChat(channelId)) router.refresh();
    boxRef.current?.focus();
  };

  return (
    <form
      className="shrink-0 border-t border-slate-200 px-6 py-3 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
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
              void send();
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={sending || text.trim() === ""}
          className="shrink-0 rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
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
