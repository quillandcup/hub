"use client";

import { useCallback, useId, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";

/**
 * THE confirmation: ask before something that can't be taken back or that others will see (rule and wording:
 * `.claude/rules/confirmations.md`). Never `window.confirm`; `tests/lib/confirm-dialog.test.ts` fails on a new one.
 *
 * - `title` is a question naming the thing ("Delete lesson?"), the body says what happens and whether it can be undone,
 *   and `confirmLabel` names the action ("Delete lesson", never "OK" or "Yes"). `tone="danger"` (red) is for destroying or
 *   discarding; `requireText` makes the person type something (the object's name) first, only for what is wide and can't be
 *   recovered.
 * - `onConfirm` may be async. While it runs the buttons wait; it closes the dialog when it finishes, unless it returns a
 *   string: that is the reason it failed, shown in the dialog, which stays open.
 * - Where a handler used to say `if (!confirm(...)) return;`, use `useConfirm()` below.
 * - It is drawn on `<body>` (a portal), so it never inherits from where it was opened: a table cell's `whitespace-nowrap` or
 *   `text-right` cut a delete confirm off and pushed its title to one side before this.
 */
export type ConfirmSpec = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Text the person must type, exactly (trimmed), before the confirm button works. */
  requireText?: string;
};

type ConfirmResult = string | null | void;

const BUTTON = "rounded px-4 py-2 text-sm font-medium disabled:opacity-50";
const CANCEL = `${BUTTON} border border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800`;
const TONES = {
  default: `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`,
  danger: `${BUTTON} bg-red-600 text-white hover:bg-red-700`,
};

export default function ConfirmDialog({ open, onClose, onConfirm, ...spec }: ConfirmSpec & { open: boolean; onClose: () => void; onConfirm: () => ConfirmResult | Promise<ConfirmResult> }) {
  // Mounted only while open, so every opening starts with nothing typed and no earlier error. Only ever opened by a click,
  // so there is always a document; the check keeps a server render from reaching for one.
  if (!open || typeof document === "undefined") return null;
  return createPortal(<OpenDialog onClose={onClose} onConfirm={onConfirm} {...spec} />, document.body);
}

function OpenDialog({ onClose, onConfirm, title, body, confirmLabel, cancelLabel = "Cancel", tone = "default", requireText }: ConfirmSpec & { onClose: () => void; onConfirm: () => ConfirmResult | Promise<ConfirmResult> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const ready = !requireText || typed.trim() === requireText;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm();
      if (typeof result === "string") setError(result);
      else onClose();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="text-sm">{body}</div>
        {requireText && (
          <div className="text-sm">
            <label htmlFor={inputId}>
              Type <strong>{requireText}</strong> to confirm
            </label>
            <input
              id={inputId}
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {/* Focus starts on Cancel, so a stray Enter never confirms. */}
          <button type="button" autoFocus={!requireText} onClick={onClose} className={CANCEL}>
            {cancelLabel}
          </button>
          <button type="submit" disabled={!ready || pending} className={TONES[tone]}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * `const { ask, dialog } = useConfirm();` then `if (!(await ask({ title, body, confirmLabel }))) return;` where a handler
 * used `window.confirm`, and render `{dialog}` once in the component. Resolves true on confirm, false on Cancel, Escape or
 * a click outside. The dialog closes at once; the caller runs the action and shows its own progress or error.
 */
export function useConfirm() {
  const [asking, setAsking] = useState<{ spec: ConfirmSpec; settle: (ok: boolean) => void } | null>(null);
  const ask = useCallback((spec: ConfirmSpec) => new Promise<boolean>((resolve) => setAsking({ spec, settle: resolve })), []);
  const close = (ok: boolean) => {
    asking?.settle(ok);
    setAsking(null);
  };
  const dialog = asking ? <ConfirmDialog open {...asking.spec} onClose={() => close(false)} onConfirm={() => close(true)} /> : null;
  return { ask, dialog };
}
