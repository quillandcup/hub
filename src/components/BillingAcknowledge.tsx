"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Kbd from "@/components/Kbd";
import Modal from "@/components/Modal";
import { acknowledgeBillingRow, revokeBillingAcknowledgement } from "@/app/(admin)/admin/hygiene/billing-reconciliation/actions";
import { ACK_NOTE_MAX, ACK_REASONS, ACK_REASON_HINTS, ACK_REASON_LABELS, changedSinceText, type AckReason, type AckView } from "@/lib/billing-acknowledgements";

const FIELD = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const PRIMARY = "rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const SECONDARY = "rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800";
const LINK = "text-sm text-plum-600 hover:underline dark:text-plum-400";

/** What the decision says, in one place for the table and the member's tab: "Complimentary, by dana@example.test on 2026-11-27", the note, and when the row has changed since. */
export function AckSummary({ ack }: { ack: AckView }) {
  return (
    <div className="space-y-1 text-sm" data-testid="ack-summary">
      <p className="text-slate-800 dark:text-slate-200">
        <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">{ACK_REASON_LABELS[ack.reason]}</span>{" "}
        {ack.by ? `Marked by ${ack.by} on ${ack.day}.` : `Marked on ${ack.day}.`}
      </p>
      {ack.note && <p className="text-slate-700 dark:text-slate-300">{ack.note}</p>}
      {ack.state === "changed" && <p className="font-medium text-orange-700 dark:text-orange-400">{changedSinceText(ack)}</p>}
    </div>
  );
}

function MarkForm({ rowKey, label, onDone, onCancel }: { rowKey: string; label: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState<AckReason>("comp");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeBillingRow({ rowKey, reason, note });
      if (result.ok) onDone();
      else setError(result.error);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {label} leaves the list of rows to look at. It stays here with your reason, and you can undo it. If the row changes later (a payment arrives, the amount moves), it comes back.
      </p>
      <label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value as AckReason)} className={`${FIELD} mt-1`}>
          {ACK_REASONS.map((r) => (
            <option key={r} value={r}>
              {ACK_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">{ACK_REASON_HINTS[reason]}</span>
      </label>
      <label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={ACK_NOTE_MAX} rows={3} className={`${FIELD} mt-1`} placeholder={reason === "other" ? "What is this? A note is needed for Other." : "Anything the next person should know"} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          Cancel
        </button>
        <button type="submit" disabled={pending} aria-keyshortcuts="Control+Enter Meta+Enter" className={`${PRIMARY} inline-flex items-center gap-2`}>
          {pending ? "Saving…" : "Mark it"}
          <Kbd keys={["mod", "enter"]} onAccent />
        </button>
      </div>
    </form>
  );
}

/**
 * What staff decided about one billing reconciliation row, and the controls to change it. Anyone who can see the row sees
 * the decision; only who holds `billing.reconciliation.acknowledge` (`canAcknowledge`, decided on the server with `can()`)
 * gets "Mark as..." and "Undo". Marking needs no confirmation, since it can be undone with one click.
 */
export default function BillingAcknowledge({
  rowKey,
  label,
  ack,
  canAcknowledge,
  onChanged,
}: {
  rowKey: string;
  label: string;
  ack: AckView | null;
  canAcknowledge: boolean;
  /** Called after a mark or an undo went through, for a view that loaded its own data (the member's Transactions tab). The server page is refreshed either way. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = () => {
    router.refresh();
    onChanged?.();
  };

  const undo = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeBillingAcknowledgement({ rowKey });
      if (result.ok) changed();
      else setError(result.error);
    });
  };

  if (!ack && !canAcknowledge) return null;
  return (
    <div className="space-y-2">
      {ack && <AckSummary ack={ack} />}
      {canAcknowledge && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setOpen(true)} className={ack ? LINK : SECONDARY}>
            {ack ? "Mark again as…" : "Mark as…"}
          </button>
          {ack && (
            <button type="button" onClick={undo} disabled={pending} className={LINK}>
              {pending ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Mark this row" maxWidth="md">
        <MarkForm
          rowKey={rowKey}
          label={label}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            changed();
          }}
        />
      </Modal>
    </div>
  );
}
