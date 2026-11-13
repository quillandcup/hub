"use client";

import { messagePermalink } from "@/lib/chat/focus";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTimeout } from "@/components/useTimeout";
import EmojiPicker from "@/components/chat/EmojiPicker";
import { useToggleReaction } from "@/components/chat/ReactionBar";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { MARKED_UNREAD_EVENT, MESSAGE_CHANGE_EVENT, emitListEvent, type MarkedUnreadDetail } from "@/lib/chat/list-events";
import { markChatUnread } from "@/app/(member)/chat/actions";
import { messageToClipboard, type Names } from "@/lib/chat/clipboard";

const buttonClass =
  "group/tip relative flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A smiley with a small + at the top right, like Slack's add-reaction. */
function AddReactionIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 11.5A8.5 8.5 0 1 1 12.5 3.1" />
      <path d="M8.5 14a4 4 0 0 0 7 0" />
      <path d="M9 9.5h.01M14.5 10.5h.01" />
      <path d="M18 2v5M15.5 4.5h5" />
    </svg>
  );
}

function ThreadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...iconProps} fill="currentColor" stroke="none">
      <circle cx="12" cy="5.5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="18.5" r="1.75" />
    </svg>
  );
}

/** Styled tooltip for a `group/tip` button; the browser's `title` tooltip looks out of place. Hidden from assistive tech since the button has an aria-label. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow group-hover/tip:block group-focus-visible/tip:block dark:bg-slate-100 dark:text-slate-900"
    >
      {children}
    </span>
  );
}

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
  names = { userNames: {}, channelNames: {} },
  canReact,
  canReply,
  canChange = false,
}: {
  channelId: string;
  messageId: string;
  /** The message's text, when it has any, for "Copy message". */
  body: string | null;
  /** Who and what the body mentions, so "Copy message" can say names instead of ids. */
  names?: Names;
  custom: Record<string, CustomEmoji>;
  canReact: boolean;
  /** Offer "Reply in thread" (not inside a thread, not for a message still being sent). */
  canReply: boolean;
  /** Offer Edit and Delete (the viewer's own Hub message); MessageBody does the work, told by an event. */
  canChange?: boolean;
}) {
  const [open, setOpen] = useState<"react" | "more" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const startCopiedTimer = useTimeout();
  const root = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const { toggle, pending, error } = useToggleReaction(channelId, messageId);

  // A popover closes on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(null);
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

  // The menu is drawn in the body at fixed coordinates, so the message list's overflow and the composer
  // can't clip it: below the button, or above it when there is no room below, and inside the window sideways.
  useLayoutEffect(() => {
    if (open !== "more") return setMenuPos(null);
    const button = moreButton.current?.getBoundingClientRect();
    const box = menu.current?.getBoundingClientRect();
    if (!button || !box) return;
    const gap = 4;
    const below = button.bottom + gap;
    const top = below + box.height > window.innerHeight - 8 && button.top - gap - box.height >= 8 ? button.top - gap - box.height : below;
    const left = Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8));
    setMenuPos({ top, left });
  }, [open]);

  // "Mark unread": the unread line moves above this message at once, and the conversation is left
  // unread when the reader goes (ChatLive and the sidebar listen for the event).
  const [unreadError, setUnreadError] = useState<string | null>(null);
  const markUnread = async () => {
    setOpen(null);
    setUnreadError(null);
    const result = await markChatUnread(channelId, messageId).catch(() => null);
    if (!result?.ok) return setUnreadError(result?.error ?? "Couldn't mark it unread. Try again.");
    emitListEvent({ kind: "unread", channelId, firstUnreadId: messageId });
    window.dispatchEvent(new CustomEvent<MarkedUnreadDetail>(MARKED_UNREAD_EVENT, { detail: { channelId, unread: result.unread } }));
  };

  const copy = async (what: string, text: string, html?: string) => {
    setOpen(null);
    try {
      // The message goes on as readable text and as styled HTML (so a paste into the chat box keeps the formatting), never the stored markup.
      if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) }),
        ]);
      } else await navigator.clipboard.writeText(text);
      setCopied(what);
      startCopiedTimer(() => setCopied(null), 1500);
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
        <span role="status" className="px-2 text-xs text-slate-600 dark:text-slate-400">
          {copied} copied
        </span>
      )}
      {canReact && (
        <div className="relative">
          <button
            type="button"
            aria-label="Add reaction…"
            aria-expanded={open === "react"}
            data-track="chat-hover-add-reaction"
            disabled={pending}
            onClick={() => setOpen(open === "react" ? null : "react")}
            className={buttonClass}
          >
            <AddReactionIcon />
          <Tip>Add reaction</Tip>
          </button>
          {open === "react" && (
            <EmojiPicker custom={custom} onPick={(name) => toggle(name, () => setOpen(null))} onClose={() => setOpen(null)} />
          )}
        </div>
      )}
      {canReply && (
        <Link
          href={`/chat/${channelId}?thread=${messageId}`}
          scroll={false}
          aria-label="Reply in thread"
          data-track="chat-hover-reply-in-thread"
          className={buttonClass}
        >
          <ThreadIcon />
          <Tip>Reply in thread</Tip>
        </Link>
      )}
      <div className="relative">
        <button
          type="button"
          aria-label="More actions"
          ref={moreButton}
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          data-track="chat-hover-more"
          onClick={() => setOpen(open === "more" ? null : "more")}
          className={buttonClass}
        >
          <MoreIcon />
          <Tip>More actions</Tip>
        </button>
        {open === "more" &&
          createPortal(
          <ul
            ref={menu}
            role="menu"
            aria-label="More actions"
            style={{ top: menuPos?.top ?? 0, left: menuPos?.left ?? 0, visibility: menuPos ? "visible" : "hidden" }}
            className="fixed z-50 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow dark:border-slate-700 dark:bg-slate-900"
          >
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
            {canChange && body && <li role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />}
            {canReply && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-track="chat-menu-mark-unread"
                  onClick={() => void markUnread()}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Mark unread
                </button>
              </li>
            )}
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-track="chat-copy-link"
                onClick={() => void copy("Link", `${window.location.origin}${messagePermalink(channelId, messageId)}`)}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Copy link
              </button>
            </li>
            {body && (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-track="chat-copy-message"
                  onClick={() => {
                    const { text, html } = messageToClipboard(body, names);
                    void copy("Message", text, html);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Copy message
                </button>
              </li>
            )}
            {canChange && <li role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />}
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
          </ul>,
          document.body
        )}
      </div>
      {(error || unreadError) && (
        <span role="alert" className="px-2 text-xs text-red-600 dark:text-red-400">
          {error ?? unreadError}
        </span>
      )}
    </div>
  );
}
