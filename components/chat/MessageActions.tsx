"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReactionPicker, useToggleReaction } from "@/components/chat/ReactionBar";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { MESSAGE_CHANGE_EVENT } from "@/lib/chat/list-events";

const buttonClass =
  "flex h-8 w-8 items-center justify-center rounded-md text-base text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

/**
 * The bar that appears at the top right of a message while the pointer is over it (or focus is in
 * it), like Slack's: add a reaction, reply in the thread, and a "more" menu. Only what the Hub can
 * do is here: forwarding, to-dos, saving and the rest are not offered. The parent row is a
 * `group`; this shows with `group-hover` and `group-focus-within`.
 */
export default function MessageActions({
  channelId,
  messageId,
  body,
  custom,
  canReact,
  canReply,
  canChange = false,
}: {
  channelId: string;
  messageId: string;
  /** The message's text, when it has any, for "Copy message". */
  body: string | null;
  custom: Record<string, CustomEmoji>;
  canReact: boolean;
  /** Offer "Reply in thread" (not inside a thread, not for a message still being sent). */
  canReply: boolean;
  /** Offer Edit and Delete (the viewer's own Hub message); MessageBody does the work, told by an event. */
  canChange?: boolean;
}) {
  const [open, setOpen] = useState<"react" | "more" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { toggle, pending, error } = useToggleReaction(channelId, messageId);

  // A popover closes on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async (what: string, text: string) => {
    setOpen(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const visible = open ? "flex" : "hidden group-hover:flex group-focus-within:flex";
  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="Message actions"
      className={`absolute -top-3 right-2 z-20 ${visible} items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow dark:border-slate-700 dark:bg-slate-900`}
    >
      {copied && (
        <span role="status" className="px-2 text-xs text-slate-500 dark:text-slate-400">
          {copied} copied
        </span>
      )}
      {canReact && (
        <div className="relative">
          <button
            type="button"
            aria-label="Add reaction…"
            title="Add reaction"
            aria-expanded={open === "react"}
            data-track="chat-hover-add-reaction"
            disabled={pending}
            onClick={() => setOpen(open === "react" ? null : "react")}
            className={buttonClass}
          >
            ☺
          </button>
          {open === "react" && (
            <ReactionPicker
              custom={custom}
              onPick={(name) => toggle(name, () => setOpen(null))}
              className="absolute right-0 top-full z-30 mt-1 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow dark:border-slate-700 dark:bg-slate-900"
            />
          )}
        </div>
      )}
      {canReply && (
        <Link
          href={`/chat/${channelId}?thread=${messageId}`}
          scroll={false}
          aria-label="Reply in thread"
          title="Reply in thread"
          data-track="chat-hover-reply-in-thread"
          className={buttonClass}
        >
          💬
        </Link>
      )}
      <div className="relative">
        <button
          type="button"
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          data-track="chat-hover-more"
          onClick={() => setOpen(open === "more" ? null : "more")}
          className={buttonClass}
        >
          ⋮
        </button>
        {open === "more" && (
          <ul
            role="menu"
            aria-label="More actions"
            className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow dark:border-slate-700 dark:bg-slate-900"
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-track="chat-copy-link"
                onClick={() => void copy("Link", `${window.location.origin}/chat/${channelId}#m-${messageId}`)}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Copy link
              </button>
            </li>
            {canChange && body && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-track="chat-menu-edit"
                  onClick={() => {
                    setOpen(null);
                    window.dispatchEvent(new CustomEvent(MESSAGE_CHANGE_EVENT, { detail: { messageId, what: "edit" } }));
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Edit message
                </button>
              </li>
            )}
            {canChange && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-track="chat-menu-delete"
                  onClick={() => {
                    setOpen(null);
                    window.dispatchEvent(new CustomEvent(MESSAGE_CHANGE_EVENT, { detail: { messageId, what: "delete" } }));
                  }}
                  className="block w-full px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Delete message
                </button>
              </li>
            )}
            {body && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-track="chat-copy-message"
                  onClick={() => void copy("Message", body)}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Copy message
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {error && (
        <span role="alert" className="px-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
