"use client";

import { useState, useTransition } from "react";
import { unblockChatPreviews } from "@/app/(member)/chat/actions";
import { track } from "@/lib/analytics/client";
import { describeBlock, type PreviewBlock } from "@/lib/chat/link-preview-blocks";

/**
 * The sites, paths and links a member chose to block previews from when removing a card (Settings, Preferences). Each has a button that
 * lifts it; messages already sent keep what they have, and later ones get previews again.
 */
export default function BlockedPreviewsList({ initial }: { initial: PreviewBlock[] }) {
  const [blocks, setBlocks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lift = (block: PreviewBlock) =>
    startTransition(async () => {
      setError(null);
      const result = await unblockChatPreviews(block).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      track("chat_preview_unblocked", { scope: block.scope });
      setBlocks((all) => all.filter((b) => b !== block));
    });

  return (
    <div>
      {blocks.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Nothing blocked. When you remove a preview from a message, you can choose to block that site.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {blocks.map((block) => (
            <li key={`${block.scope}|${block.host}|${block.pathPrefix ?? ""}|${block.url ?? ""}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 break-all text-slate-900 dark:text-slate-100">
                {describeBlock(block)}
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{block.scope === "site" ? "whole site" : block.scope === "path" ? "everything under" : "this link"}</span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => lift(block)}
                data-track="chat-unblock-previews"
                aria-label={`Stop blocking ${describeBlock(block)}`}
                className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Stop blocking
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
