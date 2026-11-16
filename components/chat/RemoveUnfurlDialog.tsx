"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import { blockOptionsFor, type BlockScope } from "@/lib/chat/link-preview-blocks";

/**
 * "Remove preview?", like Slack's: the author confirms taking a card off their message, and may also block previews from the site (or the
 * path, or just that link) in the messages they send from then on. The choice of scope is the member's: nothing is blocked until one is picked,
 * so "Remove and Block" stays off until then. `address` is the card's own address; a card without one (or one that cannot be blocked) offers
 * the plain confirm. The server works the rule out again from the address itself (`hideChatUnfurl`). Shown in a portal so a card's own
 * layout can't clip or move it; its clicks stay out of the card underneath.
 */
export default function RemoveUnfurlDialog({
  open,
  address,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The address the card is for, or null when it has none. */
  address: string | null;
  pending: boolean;
  /** Why the last try failed, shown inside the dialog. */
  error: string | null;
  onCancel: () => void;
  /** `scope` is null for a plain removal. */
  onConfirm: (scope: BlockScope | null) => void;
}) {
  const options = address ? blockOptionsFor(address) : [];
  const [block, setBlock] = useState(true);
  const [scope, setScope] = useState<BlockScope | "">("");
  const checkId = useId();
  const selectId = useId();

  if (!open || typeof document === "undefined") return null;

  const canBlock = options.length > 0;
  const blocking = canBlock && block;
  const ready = !blocking || scope !== "";

  return createPortal(
    <div onClick={(e) => e.stopPropagation()}>
      <Modal isOpen onClose={pending ? () => undefined : onCancel} title="Remove preview?" maxWidth="md">
        <p className="text-sm text-slate-700 dark:text-slate-300">This takes the preview off your message for everyone.</p>
        {canBlock && (
          <div className="mt-4 space-y-3">
            <label htmlFor={checkId} className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
              <input
                id={checkId}
                type="checkbox"
                checked={block}
                disabled={pending}
                onChange={(e) => setBlock(e.target.checked)}
                className="mt-0.5 size-4 rounded border-slate-300 text-plum-600 focus:ring-plum-500 dark:border-slate-600"
              />
              <span>Also block previews from this website in the future</span>
            </label>
            {block && (
              <div>
                <label htmlFor={selectId} className="sr-only">
                  What to block
                </label>
                <select
                  id={selectId}
                  value={scope}
                  disabled={pending}
                  onChange={(e) => setScope(e.target.value as BlockScope | "")}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-plum-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">--Select an option--</option>
                  {options.map((o) => (
                    <option key={o.scope} value={o.scope}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">Only your own messages from now on. You can change this in Settings.</p>
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(blocking && scope !== "" ? scope : null)}
            disabled={pending || !ready}
            data-track="chat-remove-unfurl-confirm"
            className="rounded-md bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {blocking ? "Remove and Block" : "Remove"}
          </button>
        </div>
      </Modal>
    </div>,
    document.body
  );
}
