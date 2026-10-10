"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Emoji } from "@/components/chat/ChatText";
import type { CustomEmoji } from "@/lib/chat/emoji";
import type { ReactionSummary } from "@/lib/chat/load";
import { toggleChatReaction } from "@/app/(member)/chat/actions";

/** The reactions people reach for first, as Slack shortcodes. */
export const QUICK_REACTIONS = ["thumbsup", "heart", "joy", "tada", "pray", "eyes", "white_check_mark", "raised_hands"];

/**
 * A message's reactions as chips, and (when the viewer can react) a way to add one. A chip is a
 * toggle: pressing yours takes it back, pressing someone else's adds the same one. Reactions made
 * in the Hub stay in the Hub for now; Slack's own show here as they always did.
 */
export default function ReactionBar({
  messageId,
  reactions,
  custom,
  canReact,
}: {
  messageId: string;
  reactions: ReactionSummary[];
  custom: Record<string, CustomEmoji>;
  canReact: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (emoji: string) => {
    setError(null);
    setPicking(false);
    startTransition(async () => {
      const result = await toggleChatReaction(messageId, emoji);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  const chipClass = (mine: boolean) =>
    `px-2 py-0.5 rounded-full text-xs border ${
      mine ? "border-plum-300 bg-plum-50 dark:border-plum-700 dark:bg-plum-900/20" : "border-slate-200 dark:border-slate-700"
    }`;

  if (reactions.length === 0 && !canReact) return null;
  return (
    <div className="mt-1.5">
      <ul className="flex flex-wrap items-center gap-1" aria-label="Reactions">
        {reactions.map((r) => (
          <li key={r.emoji}>
            {canReact ? (
              <button
                type="button"
                disabled={pending}
                aria-pressed={r.mine}
                aria-label={`${r.mine ? "Remove your" : "Add"} :${r.emoji}: reaction (${r.count})`}
                onClick={() => toggle(r.emoji)}
                className={`${chipClass(r.mine)} hover:border-plum-400 disabled:opacity-60`}
                title={`:${r.emoji}:`}
              >
                <Emoji name={r.emoji} custom={custom} /> {r.count}
              </button>
            ) : (
              <span className={chipClass(r.mine)} title={`:${r.emoji}:`}>
                <Emoji name={r.emoji} custom={custom} /> {r.count}
              </span>
            )}
          </li>
        ))}
        {canReact && (
          <li className="relative">
            <button
              type="button"
              aria-expanded={picking}
              aria-label="Add reaction"
              onClick={() => setPicking((p) => !p)}
              className="px-2 py-0.5 rounded-full text-xs border border-dashed border-slate-300 text-slate-500 hover:border-plum-400 dark:border-slate-600"
            >
              ＋
            </button>
            {picking && (
              <ul
                aria-label="Pick a reaction"
                className="absolute left-0 z-10 mt-1 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow dark:border-slate-700 dark:bg-slate-900"
              >
                {QUICK_REACTIONS.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      aria-label={`React with :${name}:`}
                      onClick={() => toggle(name)}
                      className="rounded px-1.5 py-0.5 text-base hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Emoji name={name} custom={custom} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
