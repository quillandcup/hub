"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { WRITING_MEASURES, MEASURE_LABELS, type WritingMeasure, type EntryMode } from "@/lib/writing-projects";

// 'prickles' is computed live from attendance (see derivePrickleHabitEntries in
// lib/writing-projects.ts) -- writing_progress_entries.measure's CHECK constraint doesn't allow
// it, so it must never appear as a manually-loggable option here.
const LOGGABLE_MEASURES = WRITING_MEASURES.filter((m) => m !== "prickles");
import { logProgress, updateEntry, type EntryRow } from "@/app/(member)/writing/actions";

interface LogProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: { id: string; title: string }[];
  defaultProjectId?: string;
  /** Present when editing an existing entry instead of logging a new one. */
  editingEntry?: EntryRow;
  onSaved: () => void;
  /** Attaches the new entry to a prickle (creation only -- see item 7). */
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
    const result = editingEntry
      ? await updateEntry(editingEntry.id, { entryDate, measure, mode, amount: parsedAmount, note, tags })
      : await logProgress({
          projectId,
          entryDate,
          measure,
          mode,
          amount: parsedAmount,
          note,
          tags,
          ...(prickleId ? { prickleId } : {}),
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
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount</label>
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden flex-shrink-0">
              <button
                type="button"
                onClick={() => setMode("delta")}
                className={`px-3 py-2 text-sm font-medium ${
                  mode === "delta"
                    ? "bg-blue-600 text-white"
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
                    ? "bg-blue-600 text-white"
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
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving..." : editingEntry ? "Save changes" : "Log progress"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
