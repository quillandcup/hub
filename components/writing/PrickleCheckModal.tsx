"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { CheckinHalfFields } from "@/components/writing/CheckinFields";
import {
  getCheckModalData,
  saveCheckinHalf,
  type CheckModalData,
  type CheckinHalf,
} from "@/app/(member)/prickles/checkin-actions";
import { joinCredentials } from "@/lib/prickle-join";
import { logProgress } from "@/app/(member)/projects/actions";
import { MEASURE_LABELS } from "@/lib/writing-projects";
import { EMPTY_CHECKIN as EMPTY, halfOf, type CheckinInput } from "@/lib/prickle-checkins";

interface PrickleCheckModalProps {
  prickleId: string;
  half: CheckinHalf;
  onClose: () => void;
  /** Called after anything was saved, with the check-in as it now stands. */
  onSaved: (prickleId: string, checkin: CheckinInput | null) => void;
  /** Unsaved starting answers (e.g. from Find a Prickle) for a check-in that has no saved answers yet. */
  prefill?: CheckinInput | null;
}

const inputClass =
  "w-28 px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm";

/**
 * The check-in (mood coming in, the feeling named on the wheel, their intention) or check-out (did
 * they get what they came for, mood now, the feeling, and how much they got done on each project) for one prickle, in a modal opened from the
 * attendance history rows. One prickle_checkins row underneath, also answered from the Slack
 * check-in/check-out DMs, which ask the same questions.
 */
export default function PrickleCheckModal({ prickleId, half, onClose, onSaved, prefill = null }: PrickleCheckModalProps) {
  const [data, setData] = useState<CheckModalData | null | undefined>(undefined);
  const [draft, setDraft] = useState<CheckinInput>(EMPTY);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCheckin, setSavedCheckin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCheckModalData(prickleId).then((result) => {
      if (cancelled) return;
      setData(result);
      setDraft(result?.checkin ?? (result?.canEdit ? prefill : null) ?? EMPTY);
    });
    return () => {
      cancelled = true;
    };
    // prefill only seeds the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prickleId]);

  const isCheckout = half === "checkout";
  const title = isCheckout ? "Check out" : "Check in";
  const readOnly = data ? !data.canEdit : true;
  const unlogged = data?.projects.filter((p) => p.logged.length === 0) ?? [];

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError(null);

    const entries = unlogged.flatMap((p) => {
      const raw = (amounts[p.id] ?? "").trim();
      return raw === "" ? [] : [{ project: p, amount: Number(raw) }];
    });
    if (entries.some((en) => !Number.isFinite(en.amount) || en.amount < 0)) {
      setError("Enter a number (0 or more) for each amount, or leave it blank");
      return;
    }

    setIsPending(true);
    // Answers first: an idempotent upsert, so a failure here leaves nothing half-saved (a retried
    // progress entry would duplicate).
    const result = await saveCheckinHalf(prickleId, half, halfOf(draft, half));
    if ("error" in result) {
      setIsPending(false);
      setError(result.error);
      return;
    }
    for (const { project, amount } of entries) {
      const logged = await logProgress({
        projectId: project.id,
        entryDate: data.entryDate,
        measure: project.measure,
        mode: "delta",
        amount,
        prickleId,
      });
      if ("error" in logged) {
        setIsPending(false);
        setError(`${project.title}: ${logged.error}`);
        return;
      }
    }
    setIsPending(false);
    onSaved(prickleId, draft);
    // After a check-in, keep the modal open with the join link so the member can go straight in.
    if (!isCheckout && data.join) setSavedCheckin(true);
    else onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={data ? `${title}: ${data.prickleTitle}` : title} maxWidth="lg">
      {data === undefined && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      {data === null && <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load this prickle.</p>}
      {data && savedCheckin && data.join && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">Checked in. Ready to join?</p>
          {joinCredentials(data.join).map((line) => (
            <p key={line} className="text-sm text-slate-600 dark:text-slate-400">
              {line}
            </p>
          ))}
          <div className="flex justify-end gap-3">
            <button data-track="prickle-check-close"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Close
            </button>
            <a data-track="prickle-check-join-the-prickle"
              href={data.join.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 transition-colors"
            >
              Join the prickle
            </a>
          </div>
        </div>
      )}
      {data && !savedCheckin && (
        <form onSubmit={handleSave} className="space-y-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {readOnly
              ? "Read-only while browsing as this member."
              : "Optional. Over time it shows which prickles help you most, depending on how you're feeling and what you need."}
          </p>

          {!isCheckout && (
            <CheckinHalfFields
              half="checkin"
              value={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              readOnly={readOnly}
              past={data.hasStarted}
            />
          )}

          {isCheckout && !data.hasStarted && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Available once the prickle starts.</p>
          )}

          {isCheckout && data.hasStarted && (
            <>
              <CheckinHalfFields
                half="checkout"
                value={draft}
                onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                readOnly={readOnly}
              />

              {data.projects.length > 0 && (
                <div className="space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4">
                  {data.projects.map((p) =>
                    p.logged.length > 0 ? (
                      <p key={p.id} className="text-sm text-slate-600 dark:text-slate-400">
                        Logged on <span className="font-medium">{p.title}</span>:{" "}
                        {p.logged
                          .map(
                            (l) =>
                              `${l.mode === "set_total" ? "=" : l.amount >= 0 ? "+" : ""}${l.amount.toLocaleString()} ${MEASURE_LABELS[l.measure].toLowerCase()}`
                          )
                          .join(", ")}
                      </p>
                    ) : (
                      <div key={p.id}>
                        <label
                          htmlFor={`progress-${p.id}`}
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          {p.question}
                        </label>
                        <input
                          id={`progress-${p.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={amounts[p.id] ?? ""}
                          onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
                          disabled={readOnly}
                          className={inputClass}
                        />
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!readOnly && (isCheckout ? data.hasStarted : true) && (
            <div className="flex justify-end gap-3">
              <button data-track="prickle-check-cancel"
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button data-track="prickle-check-save"
                type="submit"
                disabled={isPending}
                className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
