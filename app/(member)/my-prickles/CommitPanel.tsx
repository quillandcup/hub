"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_COMMITMENT_WEEKS,
  MAX_COMMITMENT_WEEKS,
  MIN_COMMITMENT_WEEKS,
  commitmentEndDate,
  defaultCommitmentStartDate,
  slotOccurrenceDates,
  type CommitmentSlotOption,
} from "@/lib/commitments";
import { createCommitment } from "./commitment-actions";

const WEEK_CHOICES = Array.from(
  { length: MAX_COMMITMENT_WEEKS - MIN_COMMITMENT_WEEKS + 1 },
  (_, i) => MIN_COMMITMENT_WEEKS + i
);

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateStr}T00:00:00Z`)
  );
}

/**
 * The "commit to these" panel under All Prickles: the picked slots (removable), how many weeks,
 * and the start date, then one createCommitment call for all of them.
 */
export default function CommitPanel({
  slots,
  onRemove,
  onCommitted,
  onClose,
}: {
  slots: CommitmentSlotOption[];
  onRemove: (key: string) => void;
  onCommitted: () => void;
  onClose: () => void;
}) {
  const [weeks, setWeeks] = useState(DEFAULT_COMMITMENT_WEEKS);
  // null = follow the default for whatever is picked; set once the member edits the date.
  const [startDateOverride, setStartDateOverride] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const defaultStart = useMemo(() => (slots.length > 0 ? defaultCommitmentStartDate(slots, new Date()) : ""), [slots]);
  const startDate = startDateOverride ?? defaultStart;

  const preview = useMemo(() => {
    if (slots.length === 0 || !startDate) return null;
    const dates = slots.flatMap((s) => slotOccurrenceDates(startDate, s.dayOfWeek, weeks)).sort();
    return `${dates.length} ${dates.length === 1 ? "session" : "sessions"}: ${formatDate(dates[0])}${
      dates.length > 1 ? ` – ${formatDate(dates[dates.length - 1])}` : ""
    } (through ${formatDate(commitmentEndDate(startDate, weeks))})`;
  }, [slots, startDate, weeks]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (slots.length === 0) {
      setError("Pick at least one prickle to commit to");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createCommitment({
      slots: slots.map(({ typeId, dayOfWeek, startTimeLocal, timezone }) => ({
        typeId,
        dayOfWeek,
        startTimeLocal,
        timezone,
      })),
      startDate,
      weeks,
    });
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setStartDateOverride(null);
    setWeeks(DEFAULT_COMMITMENT_WEEKS);
    onCommitted();
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Commit to these prickles"
      className="mb-4 rounded-lg border border-plum-200 dark:border-plum-900 bg-plum-50/60 dark:bg-plum-950/30 p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Make a commitment</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tick prickles in the table, or click them in the calendar. Pick as many weekly times as you like.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 flex-shrink-0"
        >
          Close
        </button>
      </div>

      {saved && slots.length === 0 && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Commitment saved. You&apos;ve got this!{" "}
          <Link href="/my-prickles/commitments" className="underline">
            See your commitments →
          </Link>
        </p>
      )}

      {slots.length === 0 ? (
        !saved && <p className="text-sm text-slate-500 dark:text-slate-400">Nothing picked yet.</p>
      ) : (
        <>
          <ul aria-label="Picked prickles" className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 pl-3 pr-1 py-0.5 text-xs"
              >
                <span>{s.label}</span>
                <button
                  type="button"
                  onClick={() => onRemove(s.key)}
                  aria-label={`Remove ${s.label}`}
                  className="rounded-full px-1.5 text-slate-400 hover:text-rose-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-sm">
              <span className="text-slate-700 dark:text-slate-300">For</span>
              <select
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="mt-1 block px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
              >
                {WEEK_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "week" : "weeks"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700 dark:text-slate-300">Starting</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDateOverride(e.target.value)}
                className="mt-1 block px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-plum-600 text-white hover:bg-plum-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : slots.length === 1 ? "Commit to this" : `Commit to these ${slots.length}`}
            </button>
          </div>

          {preview && <p className="text-xs text-slate-500 dark:text-slate-400">{preview}</p>}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
    </form>
  );
}
