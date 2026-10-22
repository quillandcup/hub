"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReactionPicker, useToggleReaction } from "@/components/chat/ReactionBar";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { MESSAGE_CHANGE_EVENT } from "@/lib/chat/list-events";

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
            <ReactionPicker
              custom={custom}
              onPick={(name) => toggle(name, () => setOpen(null))}
              onClose={() => setOpen(null)}
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
          aria-haspopup="menu"
          aria-expanded={open === "more"}
          data-track="chat-hover-more"
          onClick={() => setOpen(open === "more" ? null : "more")}
          className={buttonClass}
        >
          <MoreIcon />
          <Tip>More actions</Tip>
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
