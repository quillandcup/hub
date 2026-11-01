"use client";

import { useEffect, useRef, useState } from "react";
import MentionTextarea from "@/components/chat/MentionTextarea";
import { fromEditableText, toEditableText, type EditableText } from "@/lib/chat/render";
import { useRouter } from "next/navigation";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { deleteChatMessage, editChatMessage } from "@/app/(member)/chat/actions";
import { isPendingId, MESSAGE_CHANGE_EVENT, pokeChat } from "@/lib/chat/list-events";
import type { ChatMessageView } from "@/lib/chat/load";

/**
 * A message's text, and for its author the way to change it, started from the message's menu (an
 * event): Edit (inline, Enter saves, Escape cancels) and Delete (asks first). Only for a message written in the Hub, by the viewer, that Slack
 * has: the server changes it in Slack as whoever posted it, then in the Hub. The new text (or the
 * tombstone) shows at once; the conversation catches up behind it.
 */
export default function MessageBody({
  message,
  ctx,
  channelId,
  canEdit,
}: {
  message: ChatMessageView & { body: string };
  ctx: ChatTextContext;
  channelId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the member just saved (or deleted), shown until the server's copy catches up.
  const [saved, setSaved] = useState<{ from: string; text: string } | null>(null);
  const [deleted, setDeleted] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // The names the box shows for a Slack-written message's mentions and links, to put back as Slack's markup on save.
  const shownTokens = useRef<EditableText["tokens"]>(new Map());

  const changeable = canEdit && message.mine && !message.system && message.syncStatus === null && !isPendingId(message.id);
  const text = saved && saved.from === message.body ? saved.text : message.body;

  useEffect(() => {
    if (!changeable) return;
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<{ messageId: string; what: "edit" | "delete" }>).detail;
      if (d?.messageId !== message.id) return;
      setError(null);
      if (d.what === "edit") {
        // People and channels are shown by name. A message written in Slack is all Slack markup (links, entities);
        // one written in the Hub is plain text with just those tokens.
        const editable = toEditableText(text, ctx, { plain: message.fromHub });
        shownTokens.current = editable.tokens;
        setDraft(editable.text);
        setMode("edit");
      } else setMode("confirm-delete");
    };
    window.addEventListener(MESSAGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(MESSAGE_CHANGE_EVENT, onChange);
  }, [changeable, message.id, message.fromHub, text, ctx]);

  const catchUp = () => {
    if (!pokeChat(channelId)) router.refresh();
  };

  const save = async () => {
    const typed = draft.trim();
    if (!typed || busy) return;
    const next = fromEditableText(typed, shownTokens.current, { plain: message.fromHub });
    if (next === text) return setMode("view");
    setBusy(true);
    setError(null);
    const result = await editChatMessage(message.id, next).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved({ from: message.body, text: next });
    setMode("view");
    catchUp();
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteChatMessage(message.id).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setBusy(false);
    if (!result.ok) {
      setMode("view");
      return setError(result.error);
    }
    setDeleted(true);
    // Take the whole message out of the feed at once; the server's copy no longer has it.
    const row = document.getElementById(`m-${message.id}`);
    if (row) row.style.display = "none";
    catchUp();
  };

  if (deleted) return null;

  if (mode === "edit") {
    return (
      <div className="mt-1">
        <label className="sr-only" htmlFor={`edit-${message.id}`}>
          Edit message
        </label>
        <MentionTextarea
          id={`edit-${message.id}`}
          channelId={channelId}
          textareaRef={boxRef}
          tokens={shownTokens}
          autoFocus
          value={draft}
          rows={3}
          maxLength={4000}
          onValueChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMode("view");
              setError(null);
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="mt-1 flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={busy || draft.trim() === ""}
            onClick={() => void save()}
            className="rounded-md bg-plum-600 px-2.5 py-1 font-medium text-white hover:bg-plum-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("view");
              setError(null);
            }}
            className="text-slate-600 hover:underline dark:text-slate-400"
          >
            Cancel
          </button>
          <span className="text-slate-500 dark:text-slate-400">Enter to save, Esc to cancel</span>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
        <ChatText body={text} ctx={ctx} />
      </div>
      {changeable && mode === "confirm-delete" && (
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span className="text-slate-600 dark:text-slate-400">Delete this message? It goes from Slack too.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("view")} className="text-slate-600 hover:underline dark:text-slate-400">
            Keep
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  );
}
