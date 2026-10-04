"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { WRITING_MEASURES, MEASURE_LABELS, type WritingMeasure, type EntryMode } from "@/lib/writing-projects";

// 'prickles' is computed live from attendance (see derivePrickleHabitEntries in
// lib/writing-projects.ts) -- writing_progress_entries.measure's CHECK constraint doesn't allow
// it, so it must never appear as a manually-loggable option here.
const LOGGABLE_MEASURES = WRITING_MEASURES.filter((m) => m !== "prickles");
import { getPricklesOnDate, logProgress, updateEntry, type EntryRow } from "@/app/(member)/projects/actions";
import { defaultPrickleId, type PrickleOption } from "@/lib/prickle-writing";
import { getCheckinForLogging, saveCheckin } from "@/app/(member)/prickles/checkin-actions";
import type { CheckinInput } from "@/lib/prickle-checkins";
import { FeelingPicker, RatingPicker } from "@/components/writing/CheckinFields";

const EMPTY_CHECKIN: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

type Checkout = Pick<CheckinInput, "sessionRating" | "feelingsAfter">;

function checkoutOf(c: CheckinInput | null): Checkout {
  return { sessionRating: c?.sessionRating ?? null, feelingsAfter: c?.feelingsAfter ?? [] };
}

interface LogProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: { id: string; title: string }[];
  defaultProjectId?: string;
  /** Present when editing an existing entry instead of logging a new one. */
  editingEntry?: EntryRow;
  onSaved: () => void;
  /** Preselects this prickle in the "During which prickle?" picker (e.g. logging from the prickle's page). */
  prickleId?: string;
  defaultEntryDate?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LogProgressModal({
  isOpen,
  onClose,
  projects,
  defaultProjectId,
  editingEntry,
  onSaved,
  prickleId,
  defaultEntryDate,
}: LogProgressModalProps) {
  const [projectId, setProjectId] = useState(editingEntry?.projectId ?? defaultProjectId ?? projects[0]?.id ?? "");
  const [entryDate, setEntryDate] = useState(editingEntry?.entryDate ?? defaultEntryDate ?? todayIso());
  const [measure, setMeasure] = useState<WritingMeasure>(editingEntry?.measure ?? "words");
  const [mode, setMode] = useState<EntryMode>(editingEntry?.mode ?? "delta");
  const [amount, setAmount] = useState(editingEntry ? String(editingEntry.amount) : "");
  const [note, setNote] = useState(editingEntry?.note ?? "");
  const [tagsInput, setTagsInput] = useState(editingEntry?.tags.join(", ") ?? "");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "During which prickle?" -- "" means not during a prickle. Options are the prickles on the
  // entry's date; a new entry defaults to the one the member attended that day, if exactly one.
  const initialPrickleId = editingEntry ? editingEntry.prickleId ?? "" : prickleId ?? "";
  const [prickleChoice, setPrickleChoice] = useState(initialPrickleId);
  const [prickleOptions, setPrickleOptions] = useState<PrickleOption[]>([]);
  const [optionsLoadedFor, setOptionsLoadedFor] = useState<string | null>(null);
  // Only a new, not-yet-linked entry gets the default; an edit keeps what was saved.
  const prickleTouched = useRef(!!editingEntry || initialPrickleId !== "");

  useEffect(() => {
    if (!isOpen || !entryDate) return;
    let cancelled = false;
    getPricklesOnDate(entryDate).then((options) => {
      if (cancelled) return;
      setPrickleOptions(options);
      setOptionsLoadedFor(entryDate);
      if (!prickleTouched.current) setPrickleChoice(defaultPrickleId(options) ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, entryDate]);

  // The selected prickle's check-out, so logging from anywhere asks how it went. The check-in
  // lives on the prickle page (linked below). Saved with the entry; hidden in sudo, where nobody
  // records feelings on a member's behalf.
  const [checkinFor, setCheckinFor] = useState<string | null>(null);
  const [savedCheckout, setSavedCheckout] = useState<Checkout>(checkoutOf(null));
  const [checkoutDraft, setCheckoutDraft] = useState<Checkout>(checkoutOf(null));
  const [canCheckIn, setCanCheckIn] = useState(false);

  useEffect(() => {
    // No reset needed when the prickle is cleared or changes: the section only shows once
    // checkinFor matches the current choice.
    if (!isOpen || !prickleChoice) return;
    let cancelled = false;
    getCheckinForLogging(prickleChoice).then(({ checkin, canEdit }) => {
      if (cancelled) return;
      setSavedCheckout(checkoutOf(checkin));
      setCheckoutDraft(checkoutOf(checkin));
      setCanCheckIn(canEdit);
      setCheckinFor(prickleChoice);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, prickleChoice]);

  const showCheckout = canCheckIn && prickleChoice !== "" && checkinFor === prickleChoice;
  const checkoutChanged = showCheckout && JSON.stringify(checkoutDraft) !== JSON.stringify(savedCheckout);
  function updateCheckout(patch: Partial<Checkout>) {
    setCheckoutDraft((c) => ({ ...c, ...patch }));
  }

  // Keep a linked prickle selectable even when it isn't on the chosen date.
  const selectedMissing = prickleChoice !== "" && !prickleOptions.some((o) => o.id === prickleChoice);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (amount.trim() === "" || Number.isNaN(parsedAmount)) {
      setError("Enter a number for the amount");
      return;
    }
    if (!projectId) {
      setError("Choose a project");
      return;
    }

    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

    setIsPending(true);
    // Check-out first: it's an idempotent upsert, so a failure here leaves nothing half-saved
    // (the progress entry isn't, and a retry would duplicate it). Re-read the row first and only
    // replace the check-out answers, so a check-in edited meanwhile (e.g. in the tab the "Edit
    // check-in" link opens) isn't overwritten.
    if (checkoutChanged) {
      const { checkin: latest } = await getCheckinForLogging(prickleChoice);
      const checkinResult = await saveCheckin(prickleChoice, { ...(latest ?? EMPTY_CHECKIN), ...checkoutDraft });
      if ("error" in checkinResult) {
        setIsPending(false);
        setError(checkinResult.error);
        return;
      }
    }
    const result = editingEntry
      ? await updateEntry(editingEntry.id, {
          entryDate,
          measure,
          mode,
          amount: parsedAmount,
          note,
          tags,
          prickleId: prickleChoice || null,
        })
      : await logProgress({
          projectId,
          entryDate,
          measure,
          mode,
          amount: parsedAmount,
          note,
          tags,
          ...(prickleChoice ? { prickleId: prickleChoice } : {}),
        });
    setIsPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingEntry ? "Edit Entry" : "Log Progress"} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!editingEntry && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Measure</label>
            <select
              value={measure}
              onChange={(e) => setMeasure(e.target.value as WritingMeasure)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            >
              {LOGGABLE_MEASURES.map((m) => (
                <option key={m} value={m}>
                  {MEASURE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              max={todayIso()}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="log-progress-prickle"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            During which prickle?
          </label>
          <select
            id="log-progress-prickle"
            value={prickleChoice}
            onChange={(e) => {
              prickleTouched.current = true;
              setPrickleChoice(e.target.value);
            }}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          >
            <option value="">Not during a prickle</option>
            {selectedMissing && (
              <option value={prickleChoice}>{editingEntry?.prickleLabel ?? "The linked prickle"}</option>
            )}
            {prickleOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.attended ? " (you attended)" : ""}
              </option>
            ))}
          </select>
          {optionsLoadedFor === entryDate && prickleOptions.length === 0 && !selectedMissing && (
            <p className="mt-1 text-xs text-slate-400">No prickles on this date.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount</label>
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden flex-shrink-0">
              <button
                type="button"
                onClick={() => setMode("delta")}
                className={`px-3 py-2 text-sm font-medium ${
                  mode === "delta"
                    ? "bg-plum-600 text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
                title="Add to the running total"
              >
                +Add
              </button>
              <button
                type="button"
                onClick={() => setMode("set_total")}
                className={`px-3 py-2 text-sm font-medium ${
                  mode === "set_total"
                    ? "bg-plum-600 text-white"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
                title="Set the running total to this number"
              >
                =Set
              </button>
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === "delta" ? "e.g. 500" : "e.g. 42000"}
              className="flex-1 min-w-0 px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {mode === "delta"
              ? "Adds to your current total -- use this if you know how much you added today."
              : "Replaces your current total -- use this if you only know your new running total."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Note <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={140}
            placeholder="What did you work on?"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Tags <span className="text-slate-400 font-normal">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. editing, chapter 3"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
          />
        </div>

        {showCheckout && (
          <section
            aria-labelledby="log-progress-checkout"
            className="space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="log-progress-checkout" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Check out <span className="text-slate-400 font-normal">(optional)</span>
              </h3>
              {/* New tab, so following it doesn't lose what's typed here. */}
              <Link
                href={`/prickles/${prickleChoice}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-plum-600 dark:text-plum-400 hover:underline"
              >
                Edit check-in ↗
              </Link>
            </div>
            <RatingPicker
              label="How did it go?"
              value={checkoutDraft.sessionRating}
              onChange={(sessionRating) => updateCheckout({ sessionRating })}
            />
            <FeelingPicker
              label="Feeling now…"
              selected={checkoutDraft.feelingsAfter}
              onChange={(feelingsAfter) => updateCheckout({ feelingsAfter })}
              readOnly={false}
            />
          </section>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
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
            {isPending ? "Saving..." : editingEntry ? "Save changes" : "Log progress"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
