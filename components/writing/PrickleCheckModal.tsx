"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { FeelingPicker, NeedPicker, RatingPicker } from "@/components/writing/CheckinFields";
import {
  getCheckModalData,
  saveCheckinHalf,
  type CheckModalData,
  type CheckinHalf,
} from "@/app/(member)/prickles/checkin-actions";
import { logProgress } from "@/app/(member)/projects/actions";
import { MEASURE_LABELS } from "@/lib/writing-projects";
import type { CheckinInput } from "@/lib/prickle-checkins";

interface PrickleCheckModalProps {
  prickleId: string;
  half: CheckinHalf;
  onClose: () => void;
  /** Called after anything was saved, with the check-in as it now stands. */
  onSaved: (prickleId: string, checkin: CheckinInput | null) => void;
  /** Unsaved starting answers (e.g. from Find a Prickle) for a check-in that has no saved answers yet. */
  prefill?: CheckinInput | null;
}

const EMPTY: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

const inputClass =
  "w-28 px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm";

/**
 * The check-in (feelings coming in, what they need) or check-out (how it went as stars, feeling
 * now, and how much they got done on each project) for one prickle, in a modal opened from the
 * attendance history rows. One prickle_checkins row underneath, also answered from the Slack
 * check-in/check-out DMs, which ask the same questions.
 */
export default function PrickleCheckModal({ prickleId, half, onClose, onSaved, prefill = null }: PrickleCheckModalProps) {
  const [data, setData] = useState<CheckModalData | null | undefined>(undefined);
  const [draft, setDraft] = useState<CheckinInput>(EMPTY);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const result = await saveCheckinHalf(
      prickleId,
      half,
      isCheckout
        ? { sessionRating: draft.sessionRating, feelingsAfter: draft.feelingsAfter }
        : { feelingsBefore: draft.feelingsBefore, need: draft.need }
    );
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
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={data ? `${title}: ${data.prickleTitle}` : title} maxWidth="lg">
      {data === undefined && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      {data === null && <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load this prickle.</p>}
      {data && (
        <form onSubmit={handleSave} className="space-y-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {readOnly
              ? "Read-only while browsing as this member."
              : "Optional. Over time it shows which prickles help most when you're feeling a certain way."}
          </p>

          {!isCheckout && (
            <>
              <FeelingPicker
                label={data.hasStarted ? "Coming in, I was feeling…" : "Coming in, I'm feeling…"}
                selected={draft.feelingsBefore}
                onChange={(feelingsBefore) => setDraft((d) => ({ ...d, feelingsBefore }))}
                readOnly={readOnly}
              />
              <NeedPicker
                label={data.hasStarted ? "What I needed most from this session" : "What I need most from this session"}
                value={draft.need}
                onChange={(need) => setDraft((d) => ({ ...d, need }))}
                readOnly={readOnly}
              />
            </>
          )}

          {isCheckout && !data.hasStarted && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Available once the prickle starts.</p>
          )}

          {isCheckout && data.hasStarted && (
            <>
              <RatingPicker
                label="How did it go?"
                value={draft.sessionRating}
                onChange={(sessionRating) => setDraft((d) => ({ ...d, sessionRating }))}
                readOnly={readOnly}
              />
              <FeelingPicker
                label="Feeling now…"
                selected={draft.feelingsAfter}
                onChange={(feelingsAfter) => setDraft((d) => ({ ...d, feelingsAfter }))}
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
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
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
