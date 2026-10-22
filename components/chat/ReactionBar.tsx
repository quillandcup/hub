"use client";

import { useState, useTransition } from "react";
import EmojiPicker from "@/components/chat/EmojiPicker";
import { useRouter } from "next/navigation";
import { Emoji } from "@/components/chat/ChatText";
import type { CustomEmoji } from "@/lib/chat/emoji";
import type { ReactionSummary } from "@/lib/chat/load";
import { toggleChatReaction } from "@/app/(member)/chat/actions";
import { pokeChat } from "@/lib/chat/list-events";

/** The reactions people reach for first, as Slack shortcodes. */
export const QUICK_REACTIONS = ["thumbsup", "heart", "joy", "tada", "pray", "eyes", "white_check_mark", "raised_hands"];

/** Toggling a reaction on a message, then asking the conversation to bring itself up to date. */
export function useToggleReaction(channelId: string, messageId: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = (emoji: string, done?: () => void) => {
    setError(null);
    done?.();
    startTransition(async () => {
      const result = await toggleChatReaction(messageId, emoji);
      if (result.ok) {
        if (!pokeChat(channelId)) router.refresh();
      } else setError(result.error);
    });
  };
  return { toggle, pending, error };
}

/** "You (click to remove) and Bo reacted with :+1:" for a chip's hover card. Names are plain text (React escapes them). */
export function reactorsSentence(r: ReactionSummary): string {
  const names = [...(r.mine ? ["You (click to remove)"] : []), ...(r.reactors ?? [])];
  const unnamed = r.count - names.length;
  if (unnamed > 0) names.push(`${unnamed} ${names.length ? "more" : "people"}`);
  const list =
    names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} reacted with :${r.emoji}:`;
}

function ReactionHoverCard({ reaction, custom }: { reaction: ReactionSummary; custom: Record<string, CustomEmoji> }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-44 flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white p-3 text-center text-xs text-slate-700 shadow group-hover/chip:flex group-focus-within/chip:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      <span className="text-3xl leading-none">
        <Emoji name={reaction.emoji} custom={custom} />
      </span>
      <span>{reactorsSentence(reaction)}</span>
    </div>
  );
}

/**
 * The quick reactions in a small popover, with a "more" button that swaps it for the full emoji
 * picker; `onPick` gets the shortcode, `onClose` (for the full picker's Escape/outside click) closes it.
 */
export function ReactionPicker({
  custom,
  onPick,
  onClose,
  className,
}: {
  custom: Record<string, CustomEmoji>;
  onPick: (name: string) => void;
  onClose: () => void;
  className: string;
}) {
  const [more, setMore] = useState(false);
  if (more) return <EmojiPicker custom={custom} onPick={onPick} onClose={onClose} />;
  return (
    <ul aria-label="Pick a reaction" className={className}>
      {QUICK_REACTIONS.map((name) => (
        <li key={name}>
          <button
            type="button"
            aria-label={`React with :${name}:`}
            data-track="chat-reaction-quick-pick"
            onClick={() => onPick(name)}
            className="rounded px-1.5 py-0.5 text-base hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Emoji name={name} custom={custom} />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          aria-label="More emoji…"
          title="More emoji"
          data-track="chat-reaction-more-emoji"
          onClick={() => setMore(true)}
          className="rounded px-1.5 py-0.5 text-base font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          +
        </button>
      </li>
    </ul>
  );
}

/**
 * A message's reactions as chips. Adding one is done from the hover bar (MessageActions). A chip is a
 * toggle: pressing yours takes it back, pressing someone else's adds the same one. Reactions made
 * in the Hub stay in the Hub for now; Slack's own show here as they always did.
 */
export default function ReactionBar({
  channelId,
  messageId,
  reactions,
  custom,
  canReact,
}: {
  /** The conversation the message is in: it is asked to bring itself up to date after a change. */
  channelId: string;
  messageId: string;
  reactions: ReactionSummary[];
  custom: Record<string, CustomEmoji>;
  canReact: boolean;
}) {
  const { toggle, pending, error } = useToggleReaction(channelId, messageId);

  const chipClass = (mine: boolean) =>
    `px-2 py-0.5 rounded-full text-xs border ${
      mine ? "border-plum-300 bg-plum-50 dark:border-plum-700 dark:bg-plum-900/20" : "border-slate-200 dark:border-slate-700"
    }`;

  if (reactions.length === 0) return null;
  return (
    <div className="mt-1.5">
      <ul className="flex flex-wrap items-center gap-1" aria-label="Reactions">
        {reactions.map((r) => (
          <li key={r.emoji} className="group/chip relative">
            <ReactionHoverCard reaction={r} custom={custom} />
            {canReact ? (
              <button
                type="button"
                disabled={pending}
                aria-pressed={r.mine}
                aria-label={`${r.mine ? "Remove your" : "Add"} :${r.emoji}: reaction (${r.count})`}
                data-track="chat-reaction-toggle"
                onClick={() => toggle(r.emoji)}
                className={`${chipClass(r.mine)} hover:border-plum-400 disabled:opacity-60`}
              >
                <Emoji name={r.emoji} custom={custom} /> {r.count}
              </button>
            ) : (
              <span className={chipClass(r.mine)}>
                <Emoji name={r.emoji} custom={custom} /> {r.count}
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
